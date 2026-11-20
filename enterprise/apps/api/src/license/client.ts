import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { domainToASCII } from 'node:url';
import { StateStore } from './store.js';
import { bootstrapSigningMessage, canonicalJson, decodeCanonicalBase64Url, licenseReceiptPayloadSchema, componentCatalogPayloadSchema, signedEnvelopeSchema, type SignedEnvelope, type LicenseReceiptPayload } from './contracts.js';

export type Product = { product: string; name?: string; version: string; appKey: string | null; licenseApi: string; receiptKeyId: string; receiptPublicKeySha256: string; receiptPublicKey: string | null;
  componentType?: 'framework' | 'app' | 'plugin'; deliveryKind?: 'archive' | 'docker';
  archiveReleaseKeys?: Record<string, { publicKey: string; sha256: string; role:'framework_update'|'component_update' }>;
  dockerReleaseKeys?: Record<string, { publicKey: string; sha256: string }> };
export function resolveRuntimeProduct(product:Product,packageVersion:string,components?:Record<string,{type:string;version:string}>):Product {
  if(!components)return {...product,version:packageVersion};
  const framework=components[product.appKey??''];
  if(!framework||framework.type!=='framework'||framework.version!==packageVersion||product.version!==framework.version)throw Error('RUNTIME_PRODUCT_VERSION_MISMATCH');
  return {...product,version:framework.version};
}
export function loadProduct(): Product {
  const product=JSON.parse(process.env.QICORE_PRODUCT||readFileSync(new URL('../../../../config/license-product.json',import.meta.url),'utf8'));
  if(product.product==='qicore-local-development'&&(!process.env.QICORE_DEV_WORKSPACE||process.env.NODE_ENV!=='development'))throw Error('DEVELOPMENT_PRODUCT_FORBIDDEN');
  const version=JSON.parse(readFileSync(new URL('../../../../package.json',import.meta.url),'utf8')).version;
  return resolveRuntimeProduct(product,version,process.env.QICORE_COMPONENTS?JSON.parse(process.env.QICORE_COMPONENTS):undefined);
}
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export function normalizeDomain(value: string) {
  const trimmed = value.trim(), name = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  if (!name || /[\s/:?#@\\]/.test(name)) throw new Error('INVALID_DOMAIN');
  if (['localhost', '127.0.0.1'].includes(name.toLowerCase())) return name.toLowerCase();
  const domain = domainToASCII(name).toLowerCase(), parts = domain.split('.');
  if (domain.length > 253 || parts.length < 2 || parts.some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
    || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(parts.at(-1)!)) throw new Error('INVALID_DOMAIN');
  return domain;
}
export function validateProduct(product: Product) {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(product.product) || !product.appKey || !/^[a-z][a-z0-9_]{1,63}$/.test(product.appKey)) throw new Error('APPKEY_REQUIRED');
  if (product.componentType && !['framework','app','plugin'].includes(product.componentType)) throw new Error('INVALID_COMPONENT_TYPE');
  if (!/^\d+\.\d+\.\d+$/.test(product.version)) throw new Error('INVALID_PRODUCT_VERSION');
  if (!product.receiptPublicKey) throw new Error('TRUST_KEY_REQUIRED');
  const der = Buffer.from(product.receiptPublicKey, 'base64');
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519' || der.length !== 44 || !key.export({ format: 'der', type: 'spki' }).equals(der)
    || hash(der.subarray(-32)) !== product.receiptPublicKeySha256) throw new Error('TRUST_KEY_MISMATCH');
  const url = new URL(product.licenseApi);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/v1/') throw new Error('INVALID_LICENSE_URL');
  return key;
}
type Identity = { privateKey: string; publicKey: string; instanceId: string };
type ReceiptRecord = { envelope: SignedEnvelope; revision: number; issuedAt: string; lastSeenAt: number };
export function authorizationFailureCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const exact = ['APPKEY_REQUIRED', 'TRUST_KEY_REQUIRED', 'TRUST_KEY_MISMATCH', 'INVALID_PRODUCT_VERSION', 'INVALID_LICENSE_URL',
    'INVALID_CHALLENGE', 'CLOCK_ROLLBACK', 'STALE_RECEIPT', 'RECEIPT_IDENTITY_MISMATCH', 'RECEIPT_BINDING_MISMATCH', 'RECEIPT_TIME_INVALID'];
  if (exact.includes(code)) return code;
  if (code === 'LICENSE_NETWORK_ERROR') return 'LICENSE_NETWORK_ERROR';
  return 'SIGNATURE_INVALID';
}

export type DomainChallengePublisher=(response:{token:string},expiresAt:number)=>Promise<()=>void|Promise<void>>;
export class LicenseClient {
  private challenge?: { token: string; domain: string; expiresAt: number };
  private catalog?: SignedEnvelope;
  private catalogPending?: Promise<SignedEnvelope>;
  constructor(readonly store: StateStore, readonly product: Product, readonly domain: string,
    readonly transport: typeof fetch = fetch, private readonly readOnly = false,private readonly publishChallenge?:DomainChallengePublisher) {}
  identity(create = false): Identity | null {
    let identity = this.store.read<Identity>('identity.json');
    if (!identity && create) {
      const pair = generateKeyPairSync('ed25519'), raw = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
      identity = { privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), publicKey: raw.toString('base64url'), instanceId: hash(raw) };
      this.store.write('identity.json', identity);
    }
    if (identity) {
      const raw = createPublicKey(createPrivateKey(identity.privateKey)).export({ format: 'der', type: 'spki' }).subarray(-32);
      if (hash(raw) !== identity.instanceId || raw.toString('base64url') !== identity.publicKey) throw new Error('IDENTITY_CORRUPT');
    }
    return identity;
  }
  verifyEnvelope(input: unknown) {
    const key = validateProduct(this.product), envelope = signedEnvelopeSchema.parse(input);
    const payload = Buffer.from(decodeCanonicalBase64Url(envelope.payload)), signature = Buffer.from(decodeCanonicalBase64Url(envelope.signature));
    if (envelope.key_id !== this.product.receiptKeyId || signature.length !== 64 || !verify(null, payload, key, signature)) throw new Error('SIGNATURE_INVALID');
    const object = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
    if (canonicalJson(object) !== payload.toString('utf8') || object.key_id !== envelope.key_id) throw new Error('NON_CANONICAL_RECEIPT');
    return object;
  }
  verifyReceipt(input: unknown, now = Date.now()) {
    const payload = licenseReceiptPayloadSchema.parse(this.verifyEnvelope(input)), identity = this.identity();
    if (!identity || payload.product_id !== this.product.appKey || payload.instance_id !== identity.instanceId
      || payload.instance_public_key_sha256 !== identity.instanceId) throw new Error('RECEIPT_IDENTITY_MISMATCH');
    const issued = Date.parse(payload.issued_at);
    if (issued > now + 300_000 || Date.parse(payload.online_valid_until) > issued + 24 * 3600_000
      || Date.parse(payload.grace_until) > issued + 72 * 3600_000) throw new Error('RECEIPT_TIME_INVALID');
    if (payload.decision === 'allow' && (payload.mode !== 'none' && (payload.authorized_domain !== this.domain || payload.domain_matched !== true)
      || payload.mode === 'domain_ip' && payload.server_ip_matched !== true)) throw new Error('RECEIPT_BINDING_MISMATCH');
    return payload;
  }
  acceptReceipt(input: unknown, now = Date.now()) {
    const payload = this.verifyReceipt(input, now), previous = this.store.read<ReceiptRecord>('receipt.json');
    if (previous && now + 300_000 < previous.lastSeenAt) throw new Error('CLOCK_ROLLBACK');
    if (previous && (payload.revision < previous.revision || Date.parse(payload.issued_at) < Date.parse(previous.issuedAt))) throw new Error('STALE_RECEIPT');
    if (previous && payload.issued_at === previous.issuedAt && payload.decision === 'allow'
      && this.verifyReceipt(previous.envelope, now).decision === 'deny') throw new Error('STALE_RECEIPT');
    this.store.write('receipt.json', { envelope: signedEnvelopeSchema.parse(input), revision: payload.revision, issuedAt: payload.issued_at, lastSeenAt: now });
    return this.status(now);
  }
  status(now = Date.now(), persistWatermark = !this.readOnly): { state: string; reason: string; updatesEligible: boolean; receipt?: LicenseReceiptPayload } {
    const record = this.store.read<ReceiptRecord>('receipt.json');
    if (!record) return { state: 'unlicensed', reason: 'NO_RECEIPT', updatesEligible: false };
    const receipt = this.verifyReceipt(record.envelope, now);
    if (now + 300_000 < record.lastSeenAt) return { state: 'locked', reason: 'CLOCK_ROLLBACK', updatesEligible: false };
    if (persistWatermark && now - record.lastSeenAt > 60_000) this.store.write('receipt.json', { ...record, lastSeenAt: now });
    if (receipt.decision === 'deny') return { state: 'locked', reason: receipt.reason_code, updatesEligible: false, receipt };
    const entitlement = receipt.entitlements.find(item => item.packageKey === this.product.appKey && (!this.product.componentType || item.type === this.product.componentType));
    if (!entitlement) return { state: 'unlicensed', reason: 'PRODUCT_NOT_ENTITLED', updatesEligible: false, receipt };
    if (entitlement.useExpiresAt && Date.parse(entitlement.useExpiresAt) <= now) {
      return { state: 'locked', reason: 'LICENSE_EXPIRED', updatesEligible: false, receipt };
    }
    if (Date.parse(receipt.grace_until) <= now) return { state:'locked', reason:'OFFLINE_GRACE_EXPIRED', updatesEligible:false, receipt };
    const online = now < Date.parse(receipt.online_valid_until);
    return { state: online ? 'active' : 'grace', reason: online ? 'AUTHORIZED' : 'OFFLINE_GRACE', receipt,
      updatesEligible: online && entitlement.onlineUpdateEnabled && (!entitlement.updatesExpiresAt || Date.parse(entitlement.updatesExpiresAt) > now) };
  }
  componentStatus(packageKey: string, type: 'framework' | 'app' | 'plugin', now = Date.now()) {
    const framework = this.status(now);
    if (!['active','grace'].includes(framework.state)) return framework;
    const entitlement = framework.receipt!.entitlements.find(item => item.packageKey === packageKey && item.type === type);
    if (!entitlement) return { ...framework, state: 'unlicensed', reason: 'PRODUCT_NOT_ENTITLED', updatesEligible: false };
    if (entitlement.useExpiresAt && Date.parse(entitlement.useExpiresAt) <= now) return { ...framework, state: 'locked', reason: 'ENTITLEMENT_EXPIRED', updatesEligible: false };
    return { ...framework, updatesEligible: framework.state === 'active' && entitlement.onlineUpdateEnabled && (!entitlement.updatesExpiresAt || Date.parse(entitlement.updatesExpiresAt) > now) };
  }
  verifyCatalog(input: unknown, now = Date.now()) {
    const catalog = componentCatalogPayloadSchema.parse(this.verifyEnvelope(input)), status = this.status(now);
    if (status.state !== 'active' || catalog.productId !== this.product.appKey
      || catalog.instanceId !== this.identity()?.instanceId || catalog.licenseId !== status.receipt?.license_id
      || catalog.revision !== status.receipt.revision) throw Error('CATALOG_IDENTITY_MISMATCH');
    if (Date.parse(catalog.issuedAt) > now + 300_000 || Date.parse(catalog.validUntil) <= now) throw Error('CATALOG_EXPIRED');
    if (catalog.catalogRevision !== hash(canonicalJson(catalog.components))) throw Error('CATALOG_CONTENT_MISMATCH');
    return catalog;
  }
  async componentCatalog() {
    // Revalidate identity, expiry and current receipt revision even for an in-memory cache hit.
    if (this.catalog) { try { return this.verifyCatalog(this.catalog); } catch { this.catalog = undefined; } }
    if (this.status().state !== 'active') throw Error('CATALOG_AUTHORIZATION_REQUIRED');
    if (!this.catalogPending) this.catalogPending = this.machine('license/components/catalog', {
      protocol: 'license-api-v2', productId: this.product.appKey,
    }).then(response => { this.verifyCatalog(response.catalog); return signedEnvelopeSchema.parse(response.catalog); })
      .finally(() => { this.catalogPending = undefined; });
    const envelope = await this.catalogPending;
    const catalog = this.verifyCatalog(envelope);
    this.catalog = envelope;
    return catalog;
  }
  private async post(path: string, body: unknown): Promise<any> {
    let response: Response;
    try { response = await this.transport(new URL(path, this.product.licenseApi), { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }); }
    catch { throw new Error('LICENSE_NETWORK_ERROR'); }
    let text: string;
    try {
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
      if (!reader) throw new Error('LICENSE_NETWORK_ERROR');
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > (path==='updates/plan'?64:4) * 1024 * 1024) { await reader.cancel(); throw new Error('LICENSE_RESPONSE_TOO_LARGE'); }
        chunks.push(chunk.value);
      }
      text = Buffer.concat(chunks).toString('utf8');
    } catch (error) {
      if (error instanceof Error && error.message === 'LICENSE_RESPONSE_TOO_LARGE') throw error;
      throw new Error('LICENSE_NETWORK_ERROR');
    }
    const result = JSON.parse(text);
    if (!response.ok) {
      const message = typeof result?.message === 'string' ? result.message : '';
      if (response.status === 409 && result?.code === 'SCOPED_UPDATE_DEPENDENCY_CONFLICT') throw new Error('SCOPED_UPDATE_DEPENDENCY_CONFLICT');
      if (response.status === 409 && message === 'No compatible full application release is available for this operation') throw new Error('APPLICATION_RELEASE_UNAVAILABLE');
      if (message === 'Report installation completion before requesting updates') throw new Error('INSTALLATION_REPORT_REQUIRED');
      if (result?.code === 'INSTALLED_RELEASE_METADATA_REQUIRED') throw new Error('INSTALLED_RELEASE_METADATA_REQUIRED');
      if (result?.code === 'RELEASE_PUBLISHING_DISABLED' || message === 'Release publishing is disabled') throw new Error('RELEASE_PUBLISHING_DISABLED');
      if (response.status === 403 && message === 'Product or update entitlement is unavailable') throw new Error('UPDATE_NOT_ELIGIBLE');
      throw new Error('LICENSE_NETWORK_ERROR');
    }
    return result;
  }
  async machine(path: string, payload: Record<string, unknown>) {
    validateProduct(this.product);
    const identity = this.identity(); if (!identity) throw new Error('NO_IDENTITY');
    const timestamp = new Date().toISOString(), nonce = randomBytes(24).toString('base64url');
    const message = `${identity.instanceId}\n${timestamp}\n${nonce}\n${hash(canonicalJson(payload))}`;
    return this.post(path, { instanceId: identity.instanceId, timestamp, nonce, payload,
      signature: sign(null, Buffer.from(message), identity.privateKey).toString('base64url') });
  }
  // Bootstrap creates remote instance state: call only after a formal local attempt exists.
  async activate() {
    validateProduct(this.product);
    this.store.write('activation-attempt.json',{productId:this.product.appKey,domain:this.domain,startedAt:new Date().toISOString(),status:'started'});
    const identity = this.identity(true)!;
    const body = { protocol: 'license-api-v2' as const, appKey: this.product.appKey!, domain: this.domain,
      instancePublicKey: identity.publicKey, timestamp: new Date().toISOString(), nonce: randomBytes(24).toString('base64url') };
    let response = await this.post('license/bootstrap', { ...body, signature: sign(null, Buffer.from(bootstrapSigningMessage(body)), identity.privateKey).toString('base64url') });
    if (response.instanceId !== identity.instanceId) throw new Error('INSTANCE_MISMATCH');
    if (response.status === 'binding_required') {
      const challenge = response.challenge;
      if (!challenge || challenge.domain !== this.domain || challenge.path !== '/.well-known/qilicense-challenge'
        || !/^[A-Za-z0-9_-]{16,128}$/.test(challenge.token) || !Number.isFinite(Date.parse(challenge.expiresAt))
        || Date.parse(challenge.expiresAt) <= Date.now() || Date.parse(challenge.expiresAt) > Date.now() + 600_000 + 300_000) throw new Error('INVALID_CHALLENGE');
      this.challenge = { token: challenge.token, domain: challenge.domain, expiresAt: Date.parse(challenge.expiresAt) };
      let unpublish:(()=>void|Promise<void>)|undefined;
      try {
        unpublish=await this.publishChallenge?.({token:challenge.token},this.challenge.expiresAt);
        response = await this.machine('license/binding/challenge', { protocol: 'license-api-v2', appKey: this.product.appKey, domain: this.domain, token: challenge.token,
          ...(response.requestId ? { requestId: response.requestId, targetIp: challenge.targetIp ?? null } : {}) });
      } finally { this.challenge = undefined;await unpublish?.(); }
    }
    const accepted=this.acceptReceipt(response.receipt);
    this.store.write('activation-attempt.json',{productId:this.product.appKey,domain:this.domain,completedAt:new Date().toISOString(),status:accepted.state,reason:accepted.reason});
    return accepted;
  }
  challengeResponse(token: string, host: string) {
    return this.challenge && this.challenge.expiresAt > Date.now() && this.challenge.token === token
      && host === this.challenge.domain ? { token: this.challenge.token } : null;
  }
  async renew() {
    validateProduct(this.product);
    const response = await this.machine('license/renew', { protocol: 'license-api-v2', appKey: this.product.appKey, domain: this.domain, includeCompanyName: true });
    return this.acceptReceipt(response.receipt);
  }
}
