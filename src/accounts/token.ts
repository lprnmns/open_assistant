import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAccountsDir } from "./user-dir.js";

const ACCOUNT_TOKEN_PREFIX = "acct";
const ACCOUNT_TOKEN_SECRET_FILE = "token-secret";
const DEFAULT_ACCOUNT_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

type AccountTokenPayload = {
  sub: string;
  iat: number;
  exp: number;
};

type VerifyAccountTokenResult =
  | { ok: true; userId: string; issuedAtMs: number; expiresAtMs: number }
  | { ok: false; reason: "invalid" | "expired" };

function toBase64Url(value: Buffer | string): string {
  return Buffer.isBuffer(value) ? value.toString("base64url") : Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function resolveAccountTokenSecretPath(stateDir?: string): string {
  return path.join(resolveAccountsDir(stateDir), ACCOUNT_TOKEN_SECRET_FILE);
}

async function loadOrCreateAccountTokenSecret(stateDir?: string): Promise<Buffer> {
  const secretPath = resolveAccountTokenSecretPath(stateDir);
  try {
    const existing = await fs.readFile(secretPath, "utf8");
    const trimmed = existing.trim();
    if (trimmed) {
      return fromBase64Url(trimmed);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const nextSecret = randomBytes(32);
  await fs.mkdir(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(secretPath, `${toBase64Url(nextSecret)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return nextSecret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const existing = await fs.readFile(secretPath, "utf8");
    return fromBase64Url(existing.trim());
  }
}

function signPayload(payloadB64: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function parseTokenPayload(token: string): { payloadB64: string; signature: string } | null {
  const trimmed = token.trim();
  if (!trimmed.startsWith(`${ACCOUNT_TOKEN_PREFIX}_`)) {
    return null;
  }
  const body = trimmed.slice(ACCOUNT_TOKEN_PREFIX.length + 1);
  const [payloadB64, signature] = body.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }
  return { payloadB64, signature };
}

export async function issueAccountToken(params: {
  userId: string;
  ttlMs?: number;
  nowMs?: number;
  stateDir?: string;
}): Promise<string> {
  const userId = params.userId.trim();
  if (!userId) {
    throw new Error("userId is required");
  }
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = params.ttlMs ?? DEFAULT_ACCOUNT_TOKEN_TTL_MS;
  const payload: AccountTokenPayload = {
    sub: userId,
    iat: nowMs,
    exp: nowMs + ttlMs,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const secret = await loadOrCreateAccountTokenSecret(params.stateDir);
  const signature = signPayload(payloadB64, secret);
  return `${ACCOUNT_TOKEN_PREFIX}_${payloadB64}.${signature}`;
}

export async function verifyAccountToken(params: {
  token: string;
  nowMs?: number;
  stateDir?: string;
}): Promise<VerifyAccountTokenResult> {
  const parsed = parseTokenPayload(params.token);
  if (!parsed) {
    return { ok: false, reason: "invalid" };
  }
  let payload: AccountTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(parsed.payloadB64).toString("utf8")) as AccountTokenPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof payload?.sub !== "string" || !payload.sub.trim()) {
    return { ok: false, reason: "invalid" };
  }
  if (!Number.isFinite(payload?.iat) || !Number.isFinite(payload?.exp)) {
    return { ok: false, reason: "invalid" };
  }
  const secret = await loadOrCreateAccountTokenSecret(params.stateDir);
  const expected = signPayload(parsed.payloadB64, secret);
  const actualBytes = Buffer.from(parsed.signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.byteLength !== expectedBytes.byteLength) {
    return { ok: false, reason: "invalid" };
  }
  if (!timingSafeEqual(actualBytes, expectedBytes)) {
    return { ok: false, reason: "invalid" };
  }
  const nowMs = params.nowMs ?? Date.now();
  if (payload.exp <= nowMs) {
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    userId: payload.sub,
    issuedAtMs: payload.iat,
    expiresAtMs: payload.exp,
  };
}
