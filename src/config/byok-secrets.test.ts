import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BYOK_KEY_NAMES,
  MASTER_PASSWORD_ENV_VAR,
  type ByokKeys,
  decryptSecrets,
  encryptSecrets,
  loadAndInjectByokSecrets,
  redactLogLine,
  writeSecretsFile,
} from "./byok-secrets.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_PASSWORD = "correct-horse-battery-staple";
const TEST_KEYS: ByokKeys = {
  OPENAI_API_KEY: "sk-proj-testOpenAiKey1234567890abcdefABCDEF",
  ANTHROPIC_API_KEY: "sk-ant-testAnthropicKey1234567890abcdefABCDEF",
};

function tmpFile(): string {
  return path.join(os.tmpdir(), `byok-test-${crypto.randomBytes(8).toString("hex")}.enc`);
}

// ── encrypt / decrypt ─────────────────────────────────────────────────────────

describe("encryptSecrets / decryptSecrets", () => {
  it("round-trips keys through encrypt→decrypt", () => {
    const enc = encryptSecrets(TEST_KEYS, TEST_PASSWORD);
    const result = decryptSecrets(enc, TEST_PASSWORD);
    expect(result).toEqual(TEST_KEYS);
  });

  it("produces different ciphertext on every call (random salt+iv)", () => {
    const enc1 = encryptSecrets(TEST_KEYS, TEST_PASSWORD);
    const enc2 = encryptSecrets(TEST_KEYS, TEST_PASSWORD);
    expect(enc1.salt).not.toBe(enc2.salt);
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.data).not.toBe(enc2.data);
  });

  it("throws on wrong password", () => {
    const enc = encryptSecrets(TEST_KEYS, TEST_PASSWORD);
    expect(() => decryptSecrets(enc, "wrong-password")).toThrow();
  });

  it("throws on tampered ciphertext", () => {
    const enc = encryptSecrets(TEST_KEYS, TEST_PASSWORD);
    const tampered = { ...enc, data: enc.data.slice(0, -2) + "ff" };
    expect(() => decryptSecrets(tampered, TEST_PASSWORD)).toThrow();
  });

  it("throws on unsupported version", () => {
    const enc = encryptSecrets(TEST_KEYS, TEST_PASSWORD);
    expect(() => decryptSecrets({ ...enc, v: 99 }, TEST_PASSWORD)).toThrow(/version/);
  });

  it("throws on empty password", () => {
    expect(() => encryptSecrets(TEST_KEYS, "")).toThrow();
  });

  it("handles partial keys (not all providers required)", () => {
    const partial: ByokKeys = { OPENAI_API_KEY: "sk-proj-onlyOpenAI1234567890abcdefABCDEF" };
    const enc = encryptSecrets(partial, TEST_PASSWORD);
    const result = decryptSecrets(enc, TEST_PASSWORD);
    expect(result.OPENAI_API_KEY).toBe(partial.OPENAI_API_KEY);
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("ciphertext does not contain plaintext key material", () => {
    const enc = encryptSecrets(TEST_KEYS, TEST_PASSWORD);
    const blob = JSON.stringify(enc);
    // Keys must not appear in the encrypted blob
    for (const key of Object.values(TEST_KEYS)) {
      if (key) expect(blob).not.toContain(key);
    }
  });
});

// ── file I/O + boot injection ─────────────────────────────────────────────────

describe("loadAndInjectByokSecrets", () => {
  let tmpPath: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpPath = tmpFile();
  });

  afterEach(() => {
    // Restore env
    for (const name of BYOK_KEY_NAMES) {
      if (originalEnv[name] !== undefined) {
        process.env[name] = originalEnv[name];
      } else {
        delete process.env[name];
      }
    }
    delete process.env[MASTER_PASSWORD_ENV_VAR];
    // Clean up temp file
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  });

  it("injects decrypted keys into process.env", () => {
    writeSecretsFile(tmpPath, encryptSecrets(TEST_KEYS, TEST_PASSWORD));
    process.env[MASTER_PASSWORD_ENV_VAR] = TEST_PASSWORD;
    // Ensure they are not set beforehand
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const injected = loadAndInjectByokSecrets(tmpPath);

    expect(injected).toContain("OPENAI_API_KEY");
    expect(injected).toContain("ANTHROPIC_API_KEY");
    expect(process.env.OPENAI_API_KEY).toBe(TEST_KEYS.OPENAI_API_KEY);
    expect(process.env.ANTHROPIC_API_KEY).toBe(TEST_KEYS.ANTHROPIC_API_KEY);
  });

  it("returns empty array when secrets file does not exist", () => {
    const result = loadAndInjectByokSecrets("/nonexistent/path/secrets.enc");
    expect(result).toEqual([]);
  });

  it("throws when file exists but master password env var is missing", () => {
    writeSecretsFile(tmpPath, encryptSecrets(TEST_KEYS, TEST_PASSWORD));
    delete process.env[MASTER_PASSWORD_ENV_VAR];
    expect(() => loadAndInjectByokSecrets(tmpPath)).toThrow(MASTER_PASSWORD_ENV_VAR);
  });

  it("does not overwrite a key already present in process.env", () => {
    const existing = "sk-proj-alreadySetByEnv1234567890abcdefABCDEF";
    process.env.OPENAI_API_KEY = existing;
    writeSecretsFile(tmpPath, encryptSecrets(TEST_KEYS, TEST_PASSWORD));
    process.env[MASTER_PASSWORD_ENV_VAR] = TEST_PASSWORD;

    loadAndInjectByokSecrets(tmpPath);

    // Pre-existing env value must win
    expect(process.env.OPENAI_API_KEY).toBe(existing);
  });

  it("does not include already-present env keys in returned injected list", () => {
    // OPENAI_API_KEY is already in env — vault has both keys
    const existing = "sk-proj-alreadySetByEnv1234567890abcdefABCDEF";
    process.env.OPENAI_API_KEY = existing;
    delete process.env.ANTHROPIC_API_KEY;
    writeSecretsFile(tmpPath, encryptSecrets(TEST_KEYS, TEST_PASSWORD));
    process.env[MASTER_PASSWORD_ENV_VAR] = TEST_PASSWORD;

    const injected = loadAndInjectByokSecrets(tmpPath);

    // OPENAI_API_KEY was skipped (already present), so it must NOT appear in injected
    expect(injected).not.toContain("OPENAI_API_KEY");
    // ANTHROPIC_API_KEY was absent — it was actually injected
    expect(injected).toContain("ANTHROPIC_API_KEY");
  });

  it("file has mode 0o600 (owner-read-write only)", () => {
    writeSecretsFile(tmpPath, encryptSecrets(TEST_KEYS, TEST_PASSWORD));
    // On POSIX systems, verify file permissions
    if (process.platform !== "win32") {
      const stat = fs.statSync(tmpPath);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});

// ── log redaction ─────────────────────────────────────────────────────────────

describe("redactLogLine", () => {
  it("redacts OpenAI project key pattern", () => {
    const line = `Calling API with key=sk-proj-abcdefghijklmnopqrst1234567890`;
    expect(redactLogLine(line)).toContain("[REDACTED]");
    expect(redactLogLine(line)).not.toContain("sk-proj-");
  });

  it("redacts Anthropic key pattern", () => {
    const line = `api_key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz`;
    expect(redactLogLine(line)).toContain("[REDACTED]");
    expect(redactLogLine(line)).not.toContain("sk-ant-");
  });

  it("redacts Google API key pattern", () => {
    const line = `gemini key=AIzaSyAbcdefghijklmnopqrstuvwxyz12345678`;
    expect(redactLogLine(line)).toContain("[REDACTED]");
    expect(redactLogLine(line)).not.toContain("AIza");
  });

  it("leaves non-key strings untouched", () => {
    const line = "normal log message with no secrets";
    expect(redactLogLine(line)).toBe(line);
  });

  it("redacts multiple keys in a single line", () => {
    const line = `openai=sk-proj-key1234567890abcdefABCDEFGH anthropic=sk-ant-key1234567890abcdefABCDEFGH`;
    const redacted = redactLogLine(line);
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBe(2);
  });

  it("redacts OpenRouter key pattern (sk-or-v1-)", () => {
    // Use a synthetic key of the same format — never a real credential
    const syntheticKey = "sk-or-v1-" + "a".repeat(64);
    const line = `openrouter key=${syntheticKey} used`;
    const redacted = redactLogLine(line);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain("sk-or-v1-");
    expect(redacted).not.toContain("a".repeat(64));
  });

  it("OpenRouter key is not partially redacted by the broad sk- pattern (most-specific wins)", () => {
    // sk-or-v1- must be caught by the OpenRouter pattern, not the broad sk- pattern,
    // so the entire key is consumed as one [REDACTED] token.
    const syntheticKey = "sk-or-v1-" + "b".repeat(64);
    const line = `key=${syntheticKey}`;
    const redacted = redactLogLine(line);
    // Must be exactly one [REDACTED] — not split into two
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBe(1);
  });

  it("redact regression — line with all four provider key formats", () => {
    const line = [
      "or=sk-or-v1-" + "c".repeat(64),
      "ant=sk-ant-api03-" + "d".repeat(40),
      "oai=sk-proj-" + "e".repeat(30),
      "goog=AIzaSy" + "f".repeat(35),
    ].join(" ");
    const redacted = redactLogLine(line);
    expect(redacted).not.toMatch(/sk-or-v1-/);
    expect(redacted).not.toMatch(/sk-ant-/);
    expect(redacted).not.toMatch(/sk-proj-/);
    expect(redacted).not.toMatch(/AIzaSy/);
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBe(4);
  });
});
