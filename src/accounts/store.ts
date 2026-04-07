import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "./password.js";
import { resolveAccountsDir, ensureUserDataDirs } from "./user-dir.js";
import type { CreateAccountInput, StoredAccount } from "./types.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): { email: string; emailNormalized: string } {
  const trimmed = email.trim();
  const normalized = normalizeEmail(trimmed);
  if (!trimmed || !normalized.includes("@")) {
    throw new Error("email is required");
  }
  return { email: trimmed, emailNormalized: normalized };
}

function resolveAccountFilePath(accountsDir: string, accountId: string): string {
  return path.join(accountsDir, `${accountId}.json`);
}

async function writeAccountFile(pathname: string, value: StoredAccount): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true, mode: 0o700 });
  const tempPath = `${pathname}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, pathname);
}

async function readAccountFile(pathname: string): Promise<StoredAccount> {
  const raw = await fs.readFile(pathname, "utf8");
  return JSON.parse(raw) as StoredAccount;
}

async function listAccountFiles(accountsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(accountsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(accountsDir, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function createAccountStore(params?: { stateDir?: string }) {
  const accountsDir = resolveAccountsDir(params?.stateDir);

  async function listAccounts(): Promise<StoredAccount[]> {
    const files = await listAccountFiles(accountsDir);
    const accounts = await Promise.all(files.map((file) => readAccountFile(file)));
    return accounts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async function findByEmail(email: string): Promise<StoredAccount | null> {
    const target = normalizeEmail(email);
    if (!target) {
      return null;
    }
    const accounts = await listAccounts();
    return accounts.find((account) => account.emailNormalized === target) ?? null;
  }

  async function findById(accountId: string): Promise<StoredAccount | null> {
    try {
      return await readAccountFile(resolveAccountFilePath(accountsDir, accountId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async function createAccount(input: CreateAccountInput): Promise<StoredAccount> {
    const { email, emailNormalized } = validateEmail(input.email);
    const existing = await findByEmail(emailNormalized);
    if (existing) {
      throw new Error("account already exists");
    }

    const id = input.id?.trim() || randomUUID();
    const account: StoredAccount = {
      id,
      email,
      emailNormalized,
      hashedPassword: await hashPassword(input.password),
      ...(input.inviteCode?.trim() ? { inviteCode: input.inviteCode.trim() } : {}),
      ...(input.providerConfig ? { providerConfig: input.providerConfig } : {}),
      createdAt: input.createdAt?.trim() || new Date().toISOString(),
    };

    await writeAccountFile(resolveAccountFilePath(accountsDir, id), account);
    await ensureUserDataDirs(id, params?.stateDir);
    return account;
  }

  async function validatePassword(
    email: string,
    password: string,
  ): Promise<StoredAccount | null> {
    const account = await findByEmail(email);
    if (!account) {
      return null;
    }
    return (await verifyPassword(password, account.hashedPassword)) ? account : null;
  }

  return {
    listAccounts,
    findByEmail,
    findById,
    createAccount,
    validatePassword,
    accountsDir,
  };
}
