import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { serverEnv } from '@/lib/env';

/**
 * Envelope encryption for PrestaShop webservice keys.
 *
 * Keys are stored as `v1.<iv>.<authTag>.<ciphertext>`, all base64url. AES-256-GCM
 * gives us confidentiality plus tamper detection: a modified ciphertext fails the
 * auth tag check on decrypt instead of yielding garbage.
 *
 * The plaintext key never leaves the server — it is read only by the sync engine
 * when it needs to call a shop, and the database column is unreadable to every
 * end-user role (see supabase/migrations, shop_credentials).
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_LENGTH = 12;

function encryptionKey(): Buffer {
  return Buffer.from(serverEnv().CREDENTIALS_ENCRYPTION_KEY, 'base64');
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new Error('Cannot encrypt an empty secret.');

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Stored credential is malformed or was written by an incompatible version.');
  }

  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * A short, non-reversible label so the UI can show which key is stored
 * ("ends in 4F2A") without ever revealing the key itself.
 */
export function fingerprintSecret(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex').slice(0, 12);
}

/** Constant-time comparison for shared secrets such as the cron token. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
