import type { IncomingMessage } from "node:http";
import {
  AUTH_RATE_LIMIT_SCOPE_ACCOUNT_AUTH,
  AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN,
  AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
  type AuthRateLimiter,
  type RateLimitCheckResult,
} from "../../auth-rate-limit.js";
import {
  authorizeHttpGatewayConnect,
  authorizeWsControlUiGatewayConnect,
  type GatewayAuthResult,
  type ResolvedGatewayAuth,
} from "../../auth.js";

type HandshakeConnectAuth = {
  token?: string;
  accountToken?: string;
  bootstrapToken?: string;
  deviceToken?: string;
  password?: string;
};

export type DeviceTokenCandidateSource = "explicit-device-token" | "shared-token-fallback";

export type ConnectAuthState = {
  authResult: GatewayAuthResult;
  authOk: boolean;
  authMethod: GatewayAuthResult["method"];
  accountUserId?: string;
  sharedAuthOk: boolean;
  sharedAuthProvided: boolean;
  bootstrapTokenCandidate?: string;
  deviceTokenCandidate?: string;
  deviceTokenCandidateSource?: DeviceTokenCandidateSource;
};

type VerifyDeviceTokenResult = { ok: boolean };
type VerifyBootstrapTokenResult = { ok: boolean; reason?: string };
type VerifyAccountTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "account_token_invalid" | "account_token_expired" };

export type ConnectAuthDecision = {
  authResult: GatewayAuthResult;
  authOk: boolean;
  authMethod: GatewayAuthResult["method"];
  accountUserId?: string;
};

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveSharedConnectAuth(
  connectAuth: HandshakeConnectAuth | null | undefined,
): { token?: string; password?: string } | undefined {
  const token = trimToUndefined(connectAuth?.token);
  const password = trimToUndefined(connectAuth?.password);
  if (!token && !password) {
    return undefined;
  }
  return { token, password };
}

function resolveAccountTokenCandidate(
  connectAuth: HandshakeConnectAuth | null | undefined,
): string | undefined {
  return trimToUndefined(connectAuth?.accountToken);
}

function resolveDeviceTokenCandidate(connectAuth: HandshakeConnectAuth | null | undefined): {
  token?: string;
  source?: DeviceTokenCandidateSource;
} {
  const explicitDeviceToken = trimToUndefined(connectAuth?.deviceToken);
  if (explicitDeviceToken) {
    return { token: explicitDeviceToken, source: "explicit-device-token" };
  }
  const fallbackToken = trimToUndefined(connectAuth?.token);
  if (!fallbackToken) {
    return {};
  }
  return { token: fallbackToken, source: "shared-token-fallback" };
}

function resolveBootstrapTokenCandidate(
  connectAuth: HandshakeConnectAuth | null | undefined,
): string | undefined {
  return trimToUndefined(connectAuth?.bootstrapToken);
}

export async function resolveConnectAuthState(params: {
  resolvedAuth: ResolvedGatewayAuth;
  connectAuth: HandshakeConnectAuth | null | undefined;
  hasDeviceIdentity: boolean;
  req: IncomingMessage;
  trustedProxies: string[];
  allowRealIpFallback: boolean;
  rateLimiter?: AuthRateLimiter;
  clientIp?: string;
  verifyAccountToken: (token: string) => Promise<VerifyAccountTokenResult>;
}): Promise<ConnectAuthState> {
  const sharedConnectAuth = resolveSharedConnectAuth(params.connectAuth);
  const sharedAuthProvided = Boolean(sharedConnectAuth);
  const accountTokenCandidate = resolveAccountTokenCandidate(params.connectAuth);
  const bootstrapTokenCandidate = params.hasDeviceIdentity
    ? resolveBootstrapTokenCandidate(params.connectAuth)
    : undefined;
  const { token: deviceTokenCandidate, source: deviceTokenCandidateSource } =
    params.hasDeviceIdentity ? resolveDeviceTokenCandidate(params.connectAuth) : {};
  const hasDeviceTokenCandidate = Boolean(deviceTokenCandidate);
  let accountUserId: string | undefined;

  if (accountTokenCandidate) {
    const accountRateCheck = params.rateLimiter?.check(
      params.clientIp,
      AUTH_RATE_LIMIT_SCOPE_ACCOUNT_AUTH,
    );
    if (accountRateCheck && !accountRateCheck.allowed) {
      return {
        authResult: {
          ok: false,
          reason: "rate_limited",
          rateLimited: true,
          retryAfterMs: accountRateCheck.retryAfterMs,
        },
        authOk: false,
        authMethod: "account-token",
        sharedAuthOk: false,
        sharedAuthProvided: true,
        bootstrapTokenCandidate,
        deviceTokenCandidate,
        deviceTokenCandidateSource,
      };
    }

    const accountResult = await params.verifyAccountToken(accountTokenCandidate);
    if (accountResult.ok) {
      params.rateLimiter?.reset(params.clientIp, AUTH_RATE_LIMIT_SCOPE_ACCOUNT_AUTH);
      accountUserId = accountResult.userId;
      return {
        authResult: {
          ok: true,
          method: "account-token",
          user: accountUserId,
        },
        authOk: true,
        authMethod: "account-token",
        accountUserId,
        sharedAuthOk: true,
        sharedAuthProvided: true,
        bootstrapTokenCandidate,
        deviceTokenCandidate,
        deviceTokenCandidateSource,
      };
    }

    params.rateLimiter?.recordFailure(params.clientIp, AUTH_RATE_LIMIT_SCOPE_ACCOUNT_AUTH);
    return {
      authResult: {
        ok: false,
        reason: accountResult.reason,
      },
      authOk: false,
      authMethod: "account-token",
      sharedAuthOk: false,
      sharedAuthProvided: true,
      bootstrapTokenCandidate,
      deviceTokenCandidate,
      deviceTokenCandidateSource,
    };
  }

  let authResult: GatewayAuthResult = await authorizeWsControlUiGatewayConnect({
    auth: params.resolvedAuth,
    connectAuth: sharedConnectAuth,
    req: params.req,
    trustedProxies: params.trustedProxies,
    allowRealIpFallback: params.allowRealIpFallback,
    rateLimiter: hasDeviceTokenCandidate ? undefined : params.rateLimiter,
    clientIp: params.clientIp,
    rateLimitScope: AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
  });

  if (
    hasDeviceTokenCandidate &&
    authResult.ok &&
    params.rateLimiter &&
    (authResult.method === "token" || authResult.method === "password")
  ) {
    const sharedRateCheck: RateLimitCheckResult = params.rateLimiter.check(
      params.clientIp,
      AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
    );
    if (!sharedRateCheck.allowed) {
      authResult = {
        ok: false,
        reason: "rate_limited",
        rateLimited: true,
        retryAfterMs: sharedRateCheck.retryAfterMs,
      };
    } else {
      params.rateLimiter.reset(params.clientIp, AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET);
    }
  }

  const sharedAuthResult =
    sharedConnectAuth &&
    (await authorizeHttpGatewayConnect({
      auth: { ...params.resolvedAuth, allowTailscale: false },
      connectAuth: sharedConnectAuth,
      req: params.req,
      trustedProxies: params.trustedProxies,
      allowRealIpFallback: params.allowRealIpFallback,
      // Shared-auth probe only; rate-limit side effects are handled in the
      // primary auth flow (or deferred for device-token candidates).
      rateLimitScope: AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
    }));
  // Trusted-proxy auth is semantically shared: the proxy vouches for identity,
  // no per-device credential needed. Include it so operator connections
  // can skip device identity via roleCanSkipDeviceIdentity().
  const sharedAuthOk =
    (sharedAuthResult?.ok === true &&
      (sharedAuthResult.method === "token" || sharedAuthResult.method === "password")) ||
    (authResult.ok &&
      (authResult.method === "trusted-proxy" || authResult.method === "account-token"));

  return {
    authResult,
    authOk: authResult.ok,
    authMethod:
      authResult.method ?? (params.resolvedAuth.mode === "password" ? "password" : "token"),
    accountUserId,
    sharedAuthOk,
    sharedAuthProvided,
    bootstrapTokenCandidate,
    deviceTokenCandidate,
    deviceTokenCandidateSource,
  };
}

export async function resolveConnectAuthDecision(params: {
  state: ConnectAuthState;
  hasDeviceIdentity: boolean;
  deviceId?: string;
  publicKey?: string;
  role: string;
  scopes: string[];
  rateLimiter?: AuthRateLimiter;
  clientIp?: string;
  verifyBootstrapToken: (params: {
    deviceId: string;
    publicKey: string;
    token: string;
    role: string;
    scopes: string[];
  }) => Promise<VerifyBootstrapTokenResult>;
  verifyDeviceToken: (params: {
    deviceId: string;
    token: string;
    role: string;
    scopes: string[];
  }) => Promise<VerifyDeviceTokenResult>;
}): Promise<ConnectAuthDecision> {
  let authResult = params.state.authResult;
  let authOk = params.state.authOk;
  let authMethod = params.state.authMethod;
  const accountUserId = params.state.accountUserId;

  if (authMethod === "account-token") {
    return { authResult, authOk, authMethod, accountUserId };
  }

  const bootstrapTokenCandidate = params.state.bootstrapTokenCandidate;
  if (
    params.hasDeviceIdentity &&
    params.deviceId &&
    params.publicKey &&
    !authOk &&
    bootstrapTokenCandidate
  ) {
    const tokenCheck = await params.verifyBootstrapToken({
      deviceId: params.deviceId,
      publicKey: params.publicKey,
      token: bootstrapTokenCandidate,
      role: params.role,
      scopes: params.scopes,
    });
    if (tokenCheck.ok) {
      authOk = true;
      authMethod = "bootstrap-token";
    } else {
      authResult = { ok: false, reason: tokenCheck.reason ?? "bootstrap_token_invalid" };
    }
  }

  const deviceTokenCandidate = params.state.deviceTokenCandidate;
  if (!params.hasDeviceIdentity || !params.deviceId || authOk || !deviceTokenCandidate) {
    return { authResult, authOk, authMethod, accountUserId };
  }

  if (params.rateLimiter) {
    const deviceRateCheck = params.rateLimiter.check(
      params.clientIp,
      AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN,
    );
    if (!deviceRateCheck.allowed) {
      authResult = {
        ok: false,
        reason: "rate_limited",
        rateLimited: true,
        retryAfterMs: deviceRateCheck.retryAfterMs,
      };
    }
  }
  if (!authResult.rateLimited) {
    const tokenCheck = await params.verifyDeviceToken({
      deviceId: params.deviceId,
      token: deviceTokenCandidate,
      role: params.role,
      scopes: params.scopes,
    });
    if (tokenCheck.ok) {
      authOk = true;
      authMethod = "device-token";
      params.rateLimiter?.reset(params.clientIp, AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN);
    } else {
      authResult = {
        ok: false,
        reason:
          params.state.deviceTokenCandidateSource === "explicit-device-token"
            ? "device_token_mismatch"
            : (authResult.reason ?? "device_token_mismatch"),
      };
      params.rateLimiter?.recordFailure(params.clientIp, AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN);
    }
  }

  return { authResult, authOk, authMethod, accountUserId };
}
