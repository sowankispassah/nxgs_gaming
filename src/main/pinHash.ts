import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

// Shared with supabase/functions/stationFleet/pin.ts:
// `pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>` (PBKDF2-HMAC-SHA256,
// 16-byte salt, 32-byte key, lowercase hex). Only node:crypto is imported so
// verification scripts can load this file with --experimental-strip-types.
export const PIN_HASH_PREFIX = 'pbkdf2-sha256';
export const PIN_HASH_ITERATIONS = 10_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
// A stored hash must never be able to stall the main process.
const MAX_ITERATIONS = 1_000_000;
const HEX = /^(?:[0-9a-f]{2})+$/i;

/** Moderator and main admin PINs are 4-12 ASCII digits. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4,12}$/.test(pin);
}

export function hashPin(pin: string, iterations = PIN_HASH_ITERATIONS): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = pbkdf2Sync(pin, salt, iterations, KEY_BYTES, 'sha256');
  return `${PIN_HASH_PREFIX}$${iterations}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time check of `pin` against a stored hash; malformed hashes never match. */
export function verifyPinHash(pin: string, stored: string): boolean {
  if (typeof pin !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== PIN_HASH_PREFIX) return false;
  const [, iterationText, saltHex, hashHex] = parts;
  if (!/^\d{1,7}$/.test(iterationText)) return false;
  const iterations = Number(iterationText);
  if (iterations < 1 || iterations > MAX_ITERATIONS) return false;
  if (!HEX.test(saltHex) || !HEX.test(hashHex)) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length < 16 || expected.length > 64) return false;
  try {
    const actual = pbkdf2Sync(pin, Buffer.from(saltHex, 'hex'), iterations, expected.length, 'sha256');
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
