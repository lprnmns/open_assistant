import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const PASSWORD_HASH_VERSION = "scrypt-v1";
const PASSWORD_HASH_KEYLEN = 64;
const PASSWORD_MIN_LENGTH = 8;

function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function validatePasswordInput(password: string): string {
  const normalized = normalizePassword(password);
  if (normalized.trim().length < PASSWORD_MIN_LENGTH) {
    throw new Error(`password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  return normalized;
}

export async function hashPassword(password: string): Promise<string> {
  const normalized = validatePasswordInput(password);
  const salt = randomBytes(16);
  const derived = (await scrypt(normalized, salt, PASSWORD_HASH_KEYLEN)) as Buffer;
  return `${PASSWORD_HASH_VERSION}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const normalized = normalizePassword(password);
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== PASSWORD_HASH_VERSION) {
    return false;
  }
  const salt = parts[1];
  const expected = parts[2];
  if (!salt || !expected) {
    return false;
  }
  const derived = (await scrypt(normalized, fromBase64Url(salt), PASSWORD_HASH_KEYLEN)) as Buffer;
  const expectedBytes = fromBase64Url(expected);
  if (derived.byteLength !== expectedBytes.byteLength) {
    return false;
  }
  return timingSafeEqual(derived, expectedBytes);
}
