import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createAccountStore } from "../accounts/store.js";
import { verifyAccountToken } from "../accounts/token.js";
import { createAuthRateLimiter } from "./auth-rate-limit.js";
import { handleAccountAuthHttpRequest } from "./account-auth-http.js";

let currentServer: ReturnType<typeof createServer> | null = null;
const tempStateDirs: string[] = [];
const previousInviteCodes = process.env.OPENCLAW_ACCOUNT_INVITE_CODES;

afterEach(async () => {
  delete process.env.OPENCLAW_ACCOUNT_INVITE_CODES;
  if (previousInviteCodes !== undefined) {
    process.env.OPENCLAW_ACCOUNT_INVITE_CODES = previousInviteCodes;
  }
  if (currentServer) {
    await new Promise<void>((resolve) => currentServer?.close(() => resolve()));
    currentServer = null;
  }
  await Promise.all(
    tempStateDirs.splice(0).map((stateDir) => fs.rm(stateDir, { recursive: true, force: true })),
  );
});

async function makeStateDir(): Promise<string> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-account-auth-"));
  tempStateDirs.push(stateDir);
  return stateDir;
}

async function listenAuthServer(params: {
  stateDir: string;
  rateLimiter?: ReturnType<typeof createAuthRateLimiter>;
}): Promise<number> {
  currentServer = createServer((req, res) => {
    void handleAccountAuthHttpRequest(req, res, params).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end("not found");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    currentServer?.once("error", reject);
    currentServer?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = currentServer.address();
  if (!address || typeof address === "string") {
    throw new Error("auth server address missing");
  }
  return address.port;
}

async function postJson(port: number, pathname: string, body: Record<string, unknown>) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("account auth http", () => {
  test("registers an account and returns a signed token", async () => {
    const stateDir = await makeStateDir();
    const port = await listenAuthServer({ stateDir });

    const response = await postJson(port, "/auth/register", {
      email: "manas@example.com",
      password: "super-secure-password",
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      token: string;
      account: { id: string; email: string; providerConfig?: Record<string, unknown> };
    };
    expect(payload.ok).toBe(true);
    expect(payload.token.startsWith("acct_")).toBe(true);
    expect(payload.account.email).toBe("manas@example.com");
    expect(payload.account.providerConfig).toEqual({ managed: true });

    const store = createAccountStore({ stateDir });
    const account = await store.findByEmail("manas@example.com");
    expect(account?.id).toBe(payload.account.id);
    expect(account?.providerConfig).toEqual({ managed: true });

    await expect(verifyAccountToken({ token: payload.token, stateDir })).resolves.toMatchObject({
      ok: true,
      userId: payload.account.id,
    });
  });

  test("returns conflict when registering a duplicate email", async () => {
    const stateDir = await makeStateDir();
    const store = createAccountStore({ stateDir });
    await store.createAccount({
      email: "manas@example.com",
      password: "super-secure-password",
    });
    const port = await listenAuthServer({ stateDir });

    const response = await postJson(port, "/auth/register", {
      email: "MANAS@example.com",
      password: "another-secure-password",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { type: "conflict" },
    });
    await expect(store.listAccounts()).resolves.toHaveLength(1);
  });

  test("logs in with valid credentials and returns a signed token", async () => {
    const stateDir = await makeStateDir();
    const store = createAccountStore({ stateDir });
    const account = await store.createAccount({
      email: "manas@example.com",
      password: "super-secure-password",
    });
    const port = await listenAuthServer({ stateDir });

    const response = await postJson(port, "/auth/login", {
      email: "manas@example.com",
      password: "super-secure-password",
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      token: string;
      account: { id: string; email: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.account.id).toBe(account.id);
    await expect(verifyAccountToken({ token: payload.token, stateDir })).resolves.toMatchObject({
      ok: true,
      userId: account.id,
    });
  });

  test("rejects invalid login credentials", async () => {
    const stateDir = await makeStateDir();
    const store = createAccountStore({ stateDir });
    await store.createAccount({
      email: "manas@example.com",
      password: "super-secure-password",
    });
    const port = await listenAuthServer({ stateDir });

    const response = await postJson(port, "/auth/login", {
      email: "manas@example.com",
      password: "wrong-password",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { type: "invalid_credentials" },
    });
  });

  test("requires a valid invite code when invite-only mode is enabled", async () => {
    process.env.OPENCLAW_ACCOUNT_INVITE_CODES = "invite-123";
    const stateDir = await makeStateDir();
    const port = await listenAuthServer({ stateDir });

    const rejected = await postJson(port, "/auth/register", {
      email: "manas@example.com",
      password: "super-secure-password",
      inviteCode: "wrong-code",
    });
    expect(rejected.status).toBe(403);

    const accepted = await postJson(port, "/auth/register", {
      email: "manas@example.com",
      password: "super-secure-password",
      inviteCode: "invite-123",
    });
    expect(accepted.status).toBe(200);
  });

  test("rate limits repeated failed login attempts", async () => {
    const stateDir = await makeStateDir();
    const store = createAccountStore({ stateDir });
    await store.createAccount({
      email: "manas@example.com",
      password: "super-secure-password",
    });
    const rateLimiter = createAuthRateLimiter({
      maxAttempts: 1,
      lockoutMs: 60_000,
      windowMs: 60_000,
      exemptLoopback: false,
      pruneIntervalMs: 0,
    });
    const port = await listenAuthServer({ stateDir, rateLimiter });

    const first = await postJson(port, "/auth/login", {
      email: "manas@example.com",
      password: "wrong-password",
    });
    expect(first.status).toBe(401);

    const second = await postJson(port, "/auth/login", {
      email: "manas@example.com",
      password: "wrong-password",
    });
    expect(second.status).toBe(429);
  });
});
