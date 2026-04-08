import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureUserDataDirs,
  resolveUserConsciousnessDbPath,
  resolveUserConsciousnessDir,
  resolveUserConsciousnessStatePath,
  resolveUserCronDir,
  resolveUserCronStorePath,
  resolveUserDataDir,
  resolveUserMemoryDir,
  resolveUserSessionStorePath,
  resolveUserSessionsDir,
} from "./user-dir.js";

const tempDirs: string[] = [];

async function makeStateDir() {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-user-dir-"));
  tempDirs.push(stateDir);
  return stateDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("user-dir helpers", () => {
  it("resolves canonical per-user paths", async () => {
    const stateDir = await makeStateDir();
    const root = path.join(stateDir, "users", "user-123");

    expect(resolveUserDataDir("user-123", stateDir)).toBe(root);
    expect(resolveUserSessionsDir("user-123", stateDir)).toBe(path.join(root, "sessions"));
    expect(resolveUserSessionStorePath("user-123", stateDir)).toBe(
      path.join(root, "sessions", "sessions.json"),
    );
    expect(resolveUserCronDir("user-123", stateDir)).toBe(path.join(root, "cron"));
    expect(resolveUserCronStorePath("user-123", stateDir)).toBe(path.join(root, "cron", "jobs.json"));
    expect(resolveUserConsciousnessDir("user-123", stateDir)).toBe(
      path.join(root, "consciousness"),
    );
    expect(resolveUserConsciousnessDbPath("user-123", stateDir)).toBe(
      path.join(root, "consciousness", "consciousness.db"),
    );
    expect(resolveUserConsciousnessStatePath("user-123", stateDir)).toBe(
      path.join(root, "consciousness", "consciousness-state.json"),
    );
    expect(resolveUserMemoryDir("user-123", stateDir)).toBe(path.join(root, "memory"));
  });

  it("creates the directory tree expected by scoped stores", async () => {
    const stateDir = await makeStateDir();
    await ensureUserDataDirs("user-123", stateDir);

    await expect(fs.stat(resolveUserSessionsDir("user-123", stateDir))).resolves.toBeTruthy();
    await expect(fs.stat(resolveUserCronDir("user-123", stateDir))).resolves.toBeTruthy();
    await expect(fs.stat(resolveUserConsciousnessDir("user-123", stateDir))).resolves.toBeTruthy();
    await expect(fs.stat(resolveUserMemoryDir("user-123", stateDir))).resolves.toBeTruthy();
  });
});
