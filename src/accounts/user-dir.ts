import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const USER_DATA_SUBDIRS = ["sessions", "cron", "consciousness", "memory"] as const;

export function resolveAccountsDir(stateDir = resolveStateDir()): string {
  return path.join(stateDir, "accounts");
}

export function resolveUserDataDir(userId: string, stateDir = resolveStateDir()): string {
  return path.join(stateDir, "users", userId);
}

export function resolveUserSessionsDir(userId: string, stateDir = resolveStateDir()): string {
  return path.join(resolveUserDataDir(userId, stateDir), "sessions");
}

export function resolveUserSessionStorePath(userId: string, stateDir = resolveStateDir()): string {
  return path.join(resolveUserSessionsDir(userId, stateDir), "sessions.json");
}

export async function ensureUserDataDirs(
  userId: string,
  stateDir = resolveStateDir(),
): Promise<string> {
  const root = resolveUserDataDir(userId, stateDir);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  for (const subdir of USER_DATA_SUBDIRS) {
    await fs.mkdir(path.join(root, subdir), { recursive: true, mode: 0o700 });
  }
  return root;
}
