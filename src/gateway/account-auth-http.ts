import type { IncomingMessage, ServerResponse } from "node:http";
import { createAccountStore } from "../accounts/store.js";
import { issueAccountToken } from "../accounts/token.js";
import type { AccountProviderConfig, StoredAccount } from "../accounts/types.js";
import {
  AUTH_RATE_LIMIT_SCOPE_ACCOUNT_AUTH,
  type AuthRateLimiter,
} from "./auth-rate-limit.js";
import {
  readJsonBodyOrError,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
  sendRateLimited,
} from "./http-common.js";
import { resolveRequestClientIp } from "./net.js";

const ACCOUNT_AUTH_BODY_MAX_BYTES = 16 * 1024;
const MIN_PASSWORD_LENGTH = 8;
const DEFAULT_PROVIDER_CONFIG = { managed: true } satisfies AccountProviderConfig;

type RegisterRequestBody = {
  email: string;
  password: string;
  inviteCode?: string;
  providerConfig?: AccountProviderConfig;
};

type LoginRequestBody = {
  email: string;
  password: string;
};

function serializeAccount(account: StoredAccount) {
  return {
    id: account.id,
    email: account.email,
    createdAt: account.createdAt,
    ...(account.providerConfig ? { providerConfig: account.providerConfig } : {}),
  };
}

function parseOptionalInviteCode(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("inviteCode must be a string");
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseProviderConfig(value: unknown): AccountProviderConfig | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("providerConfig must be an object");
  }
  return value as AccountProviderConfig;
}

function parseEmail(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("email is required");
  }
  return value.trim();
}

function parsePassword(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("password is required");
  }
  const trimmed = value.trim();
  if (trimmed.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return trimmed;
}

function parseRegisterBody(body: unknown): RegisterRequestBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("request body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  return {
    email: parseEmail(record.email),
    password: parsePassword(record.password),
    inviteCode: parseOptionalInviteCode(record.inviteCode),
    providerConfig: parseProviderConfig(record.providerConfig),
  };
}

function parseLoginBody(body: unknown): LoginRequestBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("request body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  return {
    email: parseEmail(record.email),
    password: parsePassword(record.password),
  };
}

function resolveInviteCodes(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw =
    env.OPENCLAW_ACCOUNT_INVITE_CODES?.trim() || env.OPENCLAW_INVITE_CODE?.trim() || "";
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function resolveClientIp(params: {
  req: IncomingMessage;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
}): string | undefined {
  return (
    resolveRequestClientIp(
      params.req,
      params.trustedProxies,
      params.allowRealIpFallback,
    ) ?? params.req.socket?.remoteAddress
  );
}

function checkRateLimit(params: {
  rateLimiter?: AuthRateLimiter;
  clientIp: string | undefined;
  res: ServerResponse;
}): boolean {
  if (!params.rateLimiter) {
    return true;
  }
  const rate = params.rateLimiter.check(params.clientIp, AUTH_RATE_LIMIT_SCOPE_ACCOUNT_AUTH);
  if (rate.allowed) {
    return true;
  }
  sendRateLimited(params.res, rate.retryAfterMs);
  return false;
}

function recordFailure(rateLimiter: AuthRateLimiter | undefined, clientIp: string | undefined) {
  rateLimiter?.recordFailure(clientIp, AUTH_RATE_LIMIT_SCOPE_ACCOUNT_AUTH);
}

function resetFailures(rateLimiter: AuthRateLimiter | undefined, clientIp: string | undefined) {
  rateLimiter?.reset(clientIp, AUTH_RATE_LIMIT_SCOPE_ACCOUNT_AUTH);
}

async function handleRegisterRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    stateDir?: string;
    rateLimiter?: AuthRateLimiter;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
  },
): Promise<boolean> {
  const body = await readJsonBodyOrError(req, res, ACCOUNT_AUTH_BODY_MAX_BYTES);
  if (body === undefined) {
    return true;
  }

  let input: RegisterRequestBody;
  try {
    input = parseRegisterBody(body);
  } catch (error) {
    sendInvalidRequest(res, error instanceof Error ? error.message : String(error));
    return true;
  }

  const clientIp = resolveClientIp({
    req,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
  });
  if (!checkRateLimit({ rateLimiter: opts.rateLimiter, clientIp, res })) {
    return true;
  }

  const inviteCodes = resolveInviteCodes();
  if (inviteCodes.size > 0 && (!input.inviteCode || !inviteCodes.has(input.inviteCode))) {
    recordFailure(opts.rateLimiter, clientIp);
    sendJson(res, 403, {
      error: {
        message: "A valid invite code is required.",
        type: "forbidden",
      },
    });
    return true;
  }

  const accountStore = createAccountStore({ stateDir: opts.stateDir });
  let account: StoredAccount;
  try {
    account = await accountStore.createAccount({
      email: input.email,
      password: input.password,
      inviteCode: input.inviteCode,
      providerConfig: input.providerConfig ?? DEFAULT_PROVIDER_CONFIG,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /account already exists/i.test(error.message)
    ) {
      recordFailure(opts.rateLimiter, clientIp);
      sendJson(res, 409, {
        error: {
          message: "An account with that email already exists.",
          type: "conflict",
        },
      });
      return true;
    }
    throw error;
  }

  resetFailures(opts.rateLimiter, clientIp);
  const token = await issueAccountToken({
    userId: account.id,
    stateDir: opts.stateDir,
  });
  sendJson(res, 200, {
    ok: true,
    token,
    account: serializeAccount(account),
  });
  return true;
}

async function handleLoginRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    stateDir?: string;
    rateLimiter?: AuthRateLimiter;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
  },
): Promise<boolean> {
  const body = await readJsonBodyOrError(req, res, ACCOUNT_AUTH_BODY_MAX_BYTES);
  if (body === undefined) {
    return true;
  }

  let input: LoginRequestBody;
  try {
    input = parseLoginBody(body);
  } catch (error) {
    sendInvalidRequest(res, error instanceof Error ? error.message : String(error));
    return true;
  }

  const clientIp = resolveClientIp({
    req,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
  });
  if (!checkRateLimit({ rateLimiter: opts.rateLimiter, clientIp, res })) {
    return true;
  }

  const accountStore = createAccountStore({ stateDir: opts.stateDir });
  const account = await accountStore.validatePassword(input.email, input.password);
  if (!account) {
    recordFailure(opts.rateLimiter, clientIp);
    sendJson(res, 401, {
      error: {
        message: "Invalid email or password.",
        type: "invalid_credentials",
      },
    });
    return true;
  }

  resetFailures(opts.rateLimiter, clientIp);
  const token = await issueAccountToken({
    userId: account.id,
    stateDir: opts.stateDir,
  });
  sendJson(res, 200, {
    ok: true,
    token,
    account: serializeAccount(account),
  });
  return true;
}

export async function handleAccountAuthHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts?: {
    stateDir?: string;
    rateLimiter?: AuthRateLimiter;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/auth/register") {
    if (req.method !== "POST") {
      sendMethodNotAllowed(res);
      return true;
    }
    return handleRegisterRequest(req, res, opts ?? {});
  }
  if (url.pathname === "/auth/login") {
    if (req.method !== "POST") {
      sendMethodNotAllowed(res);
      return true;
    }
    return handleLoginRequest(req, res, opts ?? {});
  }
  return false;
}
