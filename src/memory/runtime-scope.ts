import os from "node:os";
import path from "node:path";
import { resolveUserMemoryDir } from "../accounts/user-dir.js";
import { resolveStateDir } from "../config/paths.js";

const ACCOUNT_MEMORY_RUNTIME_SCOPE_PREFIX = "account:";

function sanitizeScopePathSegment(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const trimmed = normalized.replace(/^-+|-+$/g, "");
  return trimmed || "scope";
}

export function resolveMemoryRuntimeRootDir(
  runtimeScope: string | undefined,
  stateDir = resolveStateDir(process.env, os.homedir),
): string | undefined {
  const scope = runtimeScope?.trim();
  if (!scope) {
    return undefined;
  }

  if (scope.startsWith(ACCOUNT_MEMORY_RUNTIME_SCOPE_PREFIX)) {
    const userId = scope.slice(ACCOUNT_MEMORY_RUNTIME_SCOPE_PREFIX.length).trim();
    if (!userId) {
      return undefined;
    }
    return resolveUserMemoryDir(userId, stateDir);
  }

  return path.join(stateDir, "memory", "scopes", sanitizeScopePathSegment(scope));
}

export function resolveScopedMemoryStorePath(params: {
  agentId: string;
  runtimeScope?: string;
  stateDir?: string;
}): string | undefined {
  const rootDir = resolveMemoryRuntimeRootDir(params.runtimeScope, params.stateDir);
  if (!rootDir) {
    return undefined;
  }
  return path.join(rootDir, `${sanitizeScopePathSegment(params.agentId)}.sqlite`);
}

export function resolveScopedQmdDir(params: {
  agentId: string;
  runtimeScope?: string;
  stateDir?: string;
}): string | undefined {
  const rootDir = resolveMemoryRuntimeRootDir(params.runtimeScope, params.stateDir);
  if (!rootDir) {
    return undefined;
  }
  return path.join(rootDir, "qmd", sanitizeScopePathSegment(params.agentId));
}
