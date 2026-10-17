// PIN and token hashing (and the main admin lockout policy) for the stationFleet edge function.
// Format shared with src/main/pinHash.ts: `pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>`
// (PBKDF2-HMAC-SHA256, 16-byte salt, 32-byte key, lowercase hex). WebCrypto and
// TextEncoder only, so Deno and Node 24 (--experimental-strip-types) both load it.

export const PIN_HASH_PREFIX = "pbkdf2-sha256";
export const PIN_HASH_ITERATIONS = 10_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
// A stored hash must never be able to stall the function.
const MAX_ITERATIONS = 1_000_000;
const PIN_PATTERN = /^\d{4,12}$/;
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/i;

export const OWNER_LOCK_MINUTES = 10;
export const OWNER_MAX_LOCK_MINUTES = 24 * 60;

/** Main admin lockout length: 10 min for the first lockout, doubling each time, at most 24 h. */
export function lockoutMinutes(lockoutCount: number): number {
  const doublings = Math.max(0, Math.floor(lockoutCount) - 1);
  return Math.min(OWNER_LOCK_MINUTES * 2 ** doublings, OWNER_MAX_LOCK_MINUTES);
}

/** Moderator and main admin PINs are 4-12 ASCII digits. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_PATTERN.test(pin);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** `count` cryptographically random bytes as lowercase hex. */
export function randomHex(count: number): string {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

/** Compares two strings without returning early on the first difference. */
export function constantTimeEqual(left: string, right: string): boolean {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function derive(pin: string, salt: Uint8Array, iterations: number, length: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  // Copy into an ArrayBuffer-backed view, which is what WebCrypto's BufferSource type requires.
  const params = { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations };
  const bits = await crypto.subtle.deriveBits(params, key, length * 8);
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPin(pin: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derive(pin, salt, PIN_HASH_ITERATIONS, KEY_BYTES);
  return `${PIN_HASH_PREFIX}$${PIN_HASH_ITERATIONS}$${bytesToHex(salt)}$${hash}`;
}

/** Constant-time check of `pin` against a stored hash; malformed hashes never match. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (typeof pin !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PIN_HASH_PREFIX) return false;
  const [, iterationText, saltHex, hashHex] = parts;
  if (!/^\d{1,7}$/.test(iterationText)) return false;
  const iterations = Number(iterationText);
  if (iterations < 1 || iterations > MAX_ITERATIONS) return false;
  if (!HEX_PATTERN.test(saltHex) || !HEX_PATTERN.test(hashHex)) return false;
  const expectedLength = hashHex.length / 2;
  if (expectedLength < 16 || expectedLength > 64) return false;
  try {
    const actual = await derive(pin, hexToBytes(saltHex), iterations, expectedLength);
    return constantTimeEqual(actual, hashHex.toLowerCase());
  } catch {
    return false;
  }
}
