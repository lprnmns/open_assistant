import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { issueAccountToken, verifyAccountToken } from "./token.js";

const tempDirs: string[] = [];

async function makeStateDir() {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-account-token-"));
  tempDirs.push(stateDir);
  return stateDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("account tokens", () => {
  it("issues and verifies signed account tokens", async () => {
    const stateDir = await makeStateDir();
    const token = await issueAccountToken({
      userId: "user-123",
      nowMs: 1_700_000_000_000,
      stateDir,
    });

    expect(token.startsWith("acct_")).toBe(true);
    await expect(
      verifyAccountToken({
        token,
        nowMs: 1_700_000_001_000,
        stateDir,
      }),
    ).resolves.toEqual({
      ok: true,
      userId: "user-123",
      issuedAtMs: 1_700_000_000_000,
      expiresAtMs: 1_702_592_000_000,
    });
  });

  it("rejects tampered account tokens", async () => {
    const stateDir = await makeStateDir();
    const token = await issueAccountToken({
      userId: "user-123",
      stateDir,
      nowMs: 1_700_000_000_000,
    });
    const tampered = `${token}x`;

    await expect(verifyAccountToken({ token: tampered, stateDir })).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects expired account tokens", async () => {
    const stateDir = await makeStateDir();
    const token = await issueAccountToken({
      userId: "user-123",
      ttlMs: 500,
      nowMs: 1_700_000_000_000,
      stateDir,
    });

    await expect(
      verifyAccountToken({
        token,
        nowMs: 1_700_000_001_000,
        stateDir,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
