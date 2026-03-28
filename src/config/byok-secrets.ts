/**
 * BYOK Secrets — At-Rest Encryption for API Keys
 *
 * Keys are stored encrypted on disk (config/secrets.enc) using AES-256-GCM.
 * At boot, they are decrypted using a master password from the environment,
 * injected into process.env for LiteLLM, then the plaintext reference is
 * discarded — it lives only in process.env for the container's lifetime.
 *
 * Key material never appears in logs (redactLogLine handles this).
 *
 * Encryption scheme:
 *   PBKDF2(password, salt, 310_000 iter, 32 bytes, sha256) → aes-256-gcm key
 *   Encrypted file format: JSON { v, salt, iv, tag, data } — all hex-encoded.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ── Constants ─────────────────────────────────────────────────────────────────

const FILE_VERSION = 1;
const PBKDF2_ITERATIONS = 310_000;
const PBKDF2_KEYLEN = 32; // 256 bits
const PBKDF2_DIGEST = "sha256";
const SALT_BYTES = 32;
const IV_BYTES = 12; // 96-bit IV for GCM

/** Env var that holds the master decryption password. */
export const MASTER_PASSWORD_ENV_VAR = "BYOK_MASTER_PASSWORD";

/** Known BYOK key names injected into process.env. */
export const BYOK_KEY_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
] as const;

export type ByokKeyName = (typeof BYOK_KEY_NAMES)[number];

/** Partial record — only keys the user has provided. */
export type ByokKeys = Partial<Record<ByokKeyName, string>>;

// ── Log redaction patterns ────────────────────────────────────────────────────

/**
 * Patterns that match known API key formats.
 * Used by redactLogLine to prevent key leakage in logs.
 */
const REDACT_PATTERNS: RegExp[] = [
  /sk-proj-[A-Za-z0-9_-]{20,}/g, // OpenAI project keys
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI legacy keys
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic keys
  /AIza[A-Za-z0-9_-]{35}/g, // Google API keys (Gemini)
];

/**
 * Replace any known API key patterns in a log string with [REDACTED].
 * Call this before writing any string to a log sink.
 */
export function redactLogLine(value: string): string {
  let result = value;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

// ── Encryption / Decryption ───────────────────────────────────────────────────

type EncryptedSecrets = {
  v: number;
  salt: string; // hex
  iv: string; // hex
  tag: string; // hex — GCM auth tag
  data: string; // hex — ciphertext
};

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
}

/** Encrypt a ByokKeys object with the given password. */
export function encryptSecrets(keys: ByokKeys, password: string): EncryptedSecrets {
  if (!password) throw new Error("Master password must not be empty.");

  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(keys);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: FILE_VERSION,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };
}

/** Decrypt an EncryptedSecrets object. Throws on wrong password or tampered data. */
export function decryptSecrets(encrypted: EncryptedSecrets, password: string): ByokKeys {
  if (encrypted.v !== FILE_VERSION) {
    throw new Error(`Unsupported secrets file version: ${encrypted.v}`);
  }
  if (!password) throw new Error("Master password must not be empty.");

  const salt = Buffer.from(encrypted.salt, "hex");
  const iv = Buffer.from(encrypted.iv, "hex");
  const tag = Buffer.from(encrypted.tag, "hex");
  const data = Buffer.from(encrypted.data, "hex");
  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as ByokKeys;
  } catch {
    throw new Error(
      "Failed to decrypt secrets — wrong master password or file has been tampered with.",
    );
  }
}

// ── File I/O ──────────────────────────────────────────────────────────────────

/** Write encrypted secrets to disk. The file must not already exist unless force=true. */
export function writeSecretsFile(filePath: string, encrypted: EncryptedSecrets): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(encrypted, null, 2), { encoding: "utf8", mode: 0o600 });
}

/** Read and parse the encrypted secrets file. */
function readSecretsFile(filePath: string): EncryptedSecrets {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`Cannot read secrets file at ${filePath}: ${String(err)}`);
  }
  try {
    return JSON.parse(raw) as EncryptedSecrets;
  } catch {
    throw new Error(`Secrets file at ${filePath} is not valid JSON.`);
  }
}

// ── Boot injection ────────────────────────────────────────────────────────────

/**
 * Load the encrypted secrets file, decrypt it, and inject keys into process.env.
 *
 * - Master password is read from process.env[MASTER_PASSWORD_ENV_VAR].
 * - If the secrets file does not exist, logs a warning and skips (keys can
 *   still be provided directly via environment variables).
 * - Returns the list of key names that were injected so callers can verify.
 *
 * IMPORTANT: This must be called once at gateway boot, before any LLM call.
 */
export function loadAndInjectByokSecrets(secretsFilePath: string): ByokKeyName[] {
  // If the file doesn't exist, fall back to env vars already set.
  if (!fs.existsSync(secretsFilePath)) {
    return [];
  }

  const password = process.env[MASTER_PASSWORD_ENV_VAR];
  if (!password) {
    throw new Error(
      `Secrets file found at ${secretsFilePath} but ${MASTER_PASSWORD_ENV_VAR} is not set. ` +
        `Set this env var to the master password used when running scripts/init-secrets.`,
    );
  }

  const encrypted = readSecretsFile(secretsFilePath);
  const keys = decryptSecrets(encrypted, password);
  const injected: ByokKeyName[] = [];

  for (const name of BYOK_KEY_NAMES) {
    const value = keys[name];
    if (value) {
      // Only inject if not already present (process env takes precedence)
      if (!process.env[name]) {
        process.env[name] = value;
      }
      injected.push(name);
    }
  }

  return injected;
}
