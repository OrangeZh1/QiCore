import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, decodeCanonicalBase64Url, signedEnvelopeSchema } from './contracts.js';
import { dockerPlanRequestSchema, dockerReleaseSchema } from './docker-contract.js';
import { LicenseClient } from './client.js';

// Exact response fields from QiLicense DockerDeliveryService.plan; no invented OCI extension.
const planSchema = z.object({ schema: z.literal('qilicense-docker-plan-v1'), key_id: z.string(), productId: z.string(),
  domain: z.string().optional(),
  licenseId: z.string().min(1), instanceId: z.string().regex(/^[a-f0-9]{64}$/), fromVersion: z.string(),
  issuedAt: z.iso.datetime({ precision: 3 }), expiresAt: z.iso.datetime({ precision: 3 }), planId: z.string().uuid().optional(),
  release: signedEnvelopeSchema.nullable() }).strict();
export async function checkDockerPlan(client: LicenseClient, currentVersion = client.product.version): Promise<{
  plan: z.infer<typeof planSchema>; release: z.infer<typeof dockerReleaseSchema> | null; credentials: { username: string; password: string } | null;
}> {
  const status = client.status();
  if (!status.receipt || status.state !== 'active' || currentVersion !== '0.0.0' && !status.updatesEligible) throw new Error('UPDATE_NOT_ELIGIBLE');
  const response = await client.machine('license/docker/plan', dockerPlanRequestSchema.parse({ schema: 'qilicense-docker-plan-request-v1',
    capability: 'docker-compose-v1', productId: client.product.appKey, domain: client.domain, currentVersion, platform: 'linux/amd64' }));
  const plan = planSchema.parse(client.verifyEnvelope(response.signedPlan));
  const now = Date.now();
  if (plan.productId !== client.product.appKey || plan.instanceId !== client.identity()!.instanceId || plan.licenseId !== status.receipt.license_id
    || plan.domain !== undefined && plan.domain !== client.domain
    || plan.fromVersion !== currentVersion || Date.parse(plan.issuedAt) > now + 300_000 || Date.parse(plan.expiresAt) <= now
    || Date.parse(plan.expiresAt) <= Date.parse(plan.issuedAt) || Date.parse(plan.expiresAt) - Date.parse(plan.issuedAt) > 600_000) throw new Error('DOCKER_PLAN_MISMATCH');
  if (!plan.release) {
    if (response.available !== false || plan.planId !== undefined) throw new Error('DOCKER_PLAN_MISMATCH');
    return { plan, release: null, credentials: null };
  }
  if (!plan.planId || response.available !== true) throw new Error('DOCKER_PLAN_MISMATCH');
  const anchor = client.product.dockerReleaseKeys?.[plan.release.key_id];
  if (!anchor) throw new Error('RELEASE_TRUST_REQUIRED');
  const der = Buffer.from(anchor.publicKey, 'base64'), key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519' || der.length !== 44 || createHash('sha256').update(der.subarray(-32)).digest('hex') !== anchor.sha256
    || anchor.sha256 === client.product.receiptPublicKeySha256) throw new Error('RELEASE_TRUST_INVALID');
  const bytes = Buffer.from(decodeCanonicalBase64Url(plan.release.payload)), signature = Buffer.from(decodeCanonicalBase64Url(plan.release.signature));
  if (signature.length !== 64 || !verify(null, bytes, key, signature)) throw new Error('RELEASE_SIGNATURE_INVALID');
  const release = dockerReleaseSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (canonicalJson(release) !== bytes.toString('utf8') || release.productId !== client.product.appKey || release.fromVersion !== currentVersion
    || release.apiImage !== release.adminImage) throw new Error('RELEASE_PRODUCT_MISMATCH');
  const a = currentVersion.split('.').map(Number), b = release.version.split('.').map(Number);
  const changed = a.findIndex((value, index) => value !== b[index]);
  if (changed < 0 || b[changed]! < a[changed]!) throw new Error('RELEASE_VERSION_INVALID');
  const credentials = response.pullCredentials;
  if (!credentials || credentials.username !== client.identity()!.instanceId || typeof credentials.password !== 'string'
    || !new RegExp('^' + plan.planId + '\\.[A-Za-z0-9_-]{43}$').test(credentials.password)) throw new Error('PULL_CREDENTIALS_INVALID');
  return { plan, release, credentials: { username: String(credentials.username), password: String(credentials.password) } };
}
