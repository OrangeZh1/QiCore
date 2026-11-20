import {createCipheriv,createPublicKey,diffieHellman,generateKeyPairSync,hkdfSync,randomBytes} from 'node:crypto';
import {canonicalJson} from '../license/contracts.js';
export function sealMiniUploadKey(privateKey, workerPublicKey, context) {
  const raw = Buffer.from(workerPublicKey, 'base64url');
  if (raw.length !== 32 || raw.toString('base64url') !== workerPublicKey) throw new Error('MINI_WORKER_KEY_INVALID');
  const recipient = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]), format: 'der', type: 'spki' });
  const ephemeral = generateKeyPairSync('x25519'), shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const salt = randomBytes(32), iv = randomBytes(12), key = Buffer.from(hkdfSync('sha256', shared, salt, 'qiadmin-mini-program-key-v1', 32));
  const plaintext = Buffer.from(privateKey);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(canonicalJson({ protocol: 'qiadmin-mini-program-key-v2', ...context })));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { version: 1, algorithm: 'X25519-HKDF-SHA256+A256GCM', ephemeralPublicKey: ephemeral.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url'),
      salt: salt.toString('base64url'), iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
  } finally { plaintext.fill(0); shared.fill(0); key.fill(0); }
}
export function qrCode(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  for (const [key, item] of Object.entries(value)) {
    if (/qrcode|qr_code|qrcodeimage/i.test(key) && typeof item === 'string') {
      const text = item.replace(/^data:image\/(?:png|jpeg);base64,/, '');
      if (text.length <= 700000 && /^[A-Za-z0-9+/]+=*$/.test(text)) {
        const bytes = Buffer.from(text, 'base64');
        const mime = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png' : bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'jpeg' : null;
        if (mime) return `data:image/${mime};base64,` + text;
      }
    }
    const nested = qrCode(item, depth + 1); if (nested) return nested;
  }
  return null;
}
