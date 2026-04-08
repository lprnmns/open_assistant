import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { resolveUserSessionStorePath } from "../accounts/user-dir.js";
import type { GatewayClient } from "./server-methods/types.js";

export function resolveGatewayAccountUserId(
  client: GatewayClient | null | undefined,
): string | undefined {
  const userId = client?.internal?.accountUserId?.trim();
  return userId || undefined;
}

export function resolveGatewaySessionScopedConfig(
  client: GatewayClient | null | undefined,
  baseCfg: OpenClawConfig = loadConfig(),
): OpenClawConfig {
  const accountUserId = resolveGatewayAccountUserId(client);
  if (!accountUserId) {
    return baseCfg;
  }
  return {
    ...baseCfg,
    session: {
      ...(baseCfg.session ?? {}),
      store: resolveUserSessionStorePath(accountUserId),
    },
  };
}
