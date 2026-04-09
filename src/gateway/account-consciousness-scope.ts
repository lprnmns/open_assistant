import {
  ensureUserDataDirs,
  resolveUserConsciousnessDbPath,
} from "../accounts/user-dir.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { createProductionBrain } from "../consciousness/brain/brain-factory.js";
import { ensureConsciousnessRuntime, getConsciousnessRuntime } from "../consciousness/runtime.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveGatewayAccountUserId } from "./account-session-scope.js";
import type { GatewayClient } from "./server-methods/types.js";

const ACCOUNT_CONSCIOUSNESS_SCOPE_PREFIX = "account:";

type CreateProductionBrainFn = typeof createProductionBrain;

export function resolveGatewayConsciousnessRuntimeScope(
  client: GatewayClient | null | undefined,
): string | undefined {
  const userId = resolveGatewayAccountUserId(client);
  return userId ? `${ACCOUNT_CONSCIOUSNESS_SCOPE_PREFIX}${userId}` : undefined;
}

export async function ensureGatewayConsciousnessRuntime(params: {
  client: GatewayClient | null | undefined;
  cfg: OpenClawConfig;
  createProductionBrain?: CreateProductionBrainFn;
}): Promise<string | undefined> {
  const userId = resolveGatewayAccountUserId(params.client);
  if (!userId) {
    return undefined;
  }

  const scope = `${ACCOUNT_CONSCIOUSNESS_SCOPE_PREFIX}${userId}`;
  if (getConsciousnessRuntime(scope)) {
    return scope;
  }

  await ensureUserDataDirs(userId);
  const createProductionBrainFn = params.createProductionBrain ?? createProductionBrain;
  await ensureConsciousnessRuntime(scope, async () => ({
    brain: await createProductionBrainFn({
      cfg: params.cfg,
      dbPath: resolveUserConsciousnessDbPath(userId),
      sessionKey: `consciousness-account:${userId}`,
      agentId: resolveDefaultAgentId(params.cfg),
    }),
  }));
  return scope;
}
