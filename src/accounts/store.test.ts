import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountStore } from "./store.js";

const tempDirs: string[] = [];

async function makeStore() {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-accounts-"));
  tempDirs.push(stateDir);
  return {
    stateDir,
    store: createAccountStore({ stateDir }),
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("createAccountStore", () => {
  it("creates accounts and initializes per-user directories", async () => {
    const { stateDir, store } = await makeStore();
    const account = await store.createAccount({
      email: "manas@example.com",
      password: "super-secure-password",
      inviteCode: "invite-123",
      providerConfig: { managed: true },
    });

    expect(account.email).toBe("manas@example.com");
    expect(account.emailNormalized).toBe("manas@example.com");
    expect(account.hashedPassword).toMatch(/^scrypt-v1\$/);
    expect(account.hashedPassword).not.toContain("super-secure-password");

    const persisted = await store.findById(account.id);
    expect(persisted?.inviteCode).toBe("invite-123");
    expect(persisted?.providerConfig).toEqual({ managed: true });

    const userDir = path.join(stateDir, "users", account.id);
    await expect(fs.stat(path.join(userDir, "sessions"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(userDir, "cron"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(userDir, "consciousness"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(userDir, "memory"))).resolves.toBeTruthy();
  });

  it("finds accounts by email case-insensitively and validates passwords", async () => {
    const { store } = await makeStore();
    const account = await store.createAccount({
      email: "Manas@Example.com",
      password: "another-secure-password",
    });

    expect((await store.findByEmail("manas@example.com"))?.id).toBe(account.id);
    expect((await store.validatePassword("manas@example.com", "another-secure-password"))?.id).toBe(
      account.id,
    );
    await expect(store.validatePassword("manas@example.com", "wrong-password")).resolves.toBeNull();
  });

  it("rejects duplicate emails", async () => {
    const { store } = await makeStore();
    await store.createAccount({
      email: "manas@example.com",
      password: "super-secure-password",
    });

    await expect(
      store.createAccount({
        email: "MANAS@example.com",
        password: "second-secure-password",
      }),
    ).rejects.toThrow(/already exists/i);
  });
});
