// =============================================================================
// FROZEN: the legacy SSH secret cipher (issue #48)
// =============================================================================
//
// A byte-for-byte copy of the AES-256-GCM helper (`common/utils/encryption.util.ts`)
// that encrypted `server_profiles.encrypted_password`, `encrypted_private_key` and
// `encrypted_passphrase` until #48 moved the secrets into the platform credential
// store. It exists ONLY for `ssh-secrets-migrate.ts`, which decrypts the legacy
// columns with it once, and for the specs that build legacy fixtures.
//
// DO NOT CHANGE THE FORMAT, THE KEY RULES OR THE ERRORS: the stored ciphertexts
// were written by exactly this code. Nothing else may import it, and it is deleted
// with the legacy columns (the migration that drops them, after production
// verification, #84).
//
// Format: base64(iv):base64(authTag):base64(ciphertext), AES-256-GCM, 12-byte IV,
// 16-byte tag. The key is read from the legacy environment variable (see
// `getEncryptionKey`), accepted either as base64 of 32 bytes or as a raw
// 32-character UTF-8 string.
//
// Nothing here logs: a caller must never print a plaintext or a ciphertext.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns format: base64(iv):base64(authTag):base64(ciphertext)
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts a string encrypted with the encrypt function.
 * Expects format: base64(iv):base64(authTag):base64(ciphertext)
 */
export function decrypt(encrypted: string, key: Buffer): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format: expected iv:authTag:ciphertext');
  }

  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Reads and validates the encryption key from environment variable.
 * The key must be exactly 32 bytes (for AES-256).
 * Accepts either a 32-character string or a base64-encoded string that decodes to 32 bytes.
 */
export function getEncryptionKey(): Buffer {
  const keyStr = process.env.ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  // Try base64 first
  const base64Decoded = Buffer.from(keyStr, 'base64');
  if (base64Decoded.length === 32) {
    return base64Decoded;
  }

  // Try raw UTF-8
  const rawKey = Buffer.from(keyStr, 'utf8');
  if (rawKey.length === 32) {
    return rawKey;
  }

  throw new Error(
    `ENCRYPTION_KEY must be exactly 32 bytes. Got ${rawKey.length} bytes (utf8) or ${base64Decoded.length} bytes (base64).`,
  );
}
