#!/usr/bin/env node
/**
 * scripts/init-secrets.ts — BYOK Key Vault initialiser
 *
 * One-time setup tool that prompts the operator for their API keys, encrypts
 * them with a master password, and writes the sealed blob to
 * config/secrets.enc (mode 0o600, never committed to git).
 *
 * Usage:
 *   pnpm tsx scripts/init-secrets.ts [--out <path>]
 *
 * Options:
 *   --out <path>   Output path (default: config/secrets.enc)
 *   --force        Overwrite existing secrets file without prompting
 *
 * The master password is NEVER printed to stdout or logged.
 * The operator must record it from their own input before proceeding.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  BYOK_KEY_NAMES,
  MASTER_PASSWORD_ENV_VAR,
  type ByokKeys,
  encryptSecrets,
  writeSecretsFile,
} from "../src/config/byok-secrets.js";

// ── CLI arg parsing ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function argValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const OUT_PATH = argValue("--out") ?? path.join("config", "secrets.enc");
const FORCE = args.includes("--force");

// ── readline helpers ───────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

/**
 * Prompt for a secret value without echoing to the terminal.
 * Falls back to a visible prompt if the TTY doesn't support raw mode.
 */
function askSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    if (!process.stdout.isTTY || !stdin.isTTY) {
      // Non-interactive (pipe / CI) — read normally
      rl.question(prompt, resolve);
      return;
    }

    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";

    const handler = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          // Enter — done
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", handler);
          process.stdout.write("\n");
          resolve(value);
          return;
        } else if (ch === "\u0003") {
          // Ctrl-C
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(1);
        } else if (ch === "\u007f" || ch === "\b") {
          // Backspace
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          value += ch;
          process.stdout.write("*");
        }
      }
    };

    stdin.on("data", handler);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n=== Open Assistant — BYOK Key Vault Setup ===\n");
  console.log("This tool encrypts your API keys and writes them to:");
  console.log(`  ${path.resolve(OUT_PATH)}\n`);
  console.log("The master password must be stored in the environment variable:");
  console.log(`  ${MASTER_PASSWORD_ENV_VAR}\n`);

  // ── Guard: existing file ────────────────────────────────────────────────────
  if (fs.existsSync(OUT_PATH) && !FORCE) {
    const answer = await ask(
      `File already exists at ${OUT_PATH}. Overwrite? [y/N] `,
    );
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted.");
      rl.close();
      return;
    }
  }

  // ── Collect API keys ────────────────────────────────────────────────────────
  console.log(
    "Enter your API keys below. Leave blank to skip a provider.\n",
  );

  const keys: ByokKeys = {};

  for (const name of BYOK_KEY_NAMES) {
    const value = await askSecret(`  ${name}: `);
    const trimmed = value.trim();
    if (trimmed) {
      // Type-safe assignment via index signature of ByokKeys (Partial<Record<ByokKeyName,string>>)
      (keys as Record<string, string>)[name] = trimmed;
    }
  }

  const filledCount = Object.keys(keys).length;
  if (filledCount === 0) {
    console.log("\nNo keys entered. Nothing written.");
    rl.close();
    return;
  }

  // ── Master password ─────────────────────────────────────────────────────────
  console.log("");
  let password: string;

  // Allow pre-seeding from env for non-interactive / CI use
  const envPassword = process.env[MASTER_PASSWORD_ENV_VAR];
  if (envPassword) {
    if (envPassword.length < 12) {
      console.error(
        `\n${MASTER_PASSWORD_ENV_VAR} is too short (minimum 12 characters). Aborted.`,
      );
      rl.close();
      process.exit(1);
    }
    console.log(
      `Using master password from ${MASTER_PASSWORD_ENV_VAR} env var.`,
    );
    password = envPassword;
  } else {
    password = await askSecret("  Master password (min 12 chars): ");
    const confirm = await askSecret("  Confirm master password:        ");

    if (password !== confirm) {
      console.error("\nPasswords do not match. Aborted.");
      rl.close();
      process.exit(1);
    }

    if (password.length < 12) {
      console.error("\nPassword too short (minimum 12 characters). Aborted.");
      rl.close();
      process.exit(1);
    }
  }

  rl.close();

  // ── Encrypt & write ─────────────────────────────────────────────────────────
  console.log("\nEncrypting keys…");
  const encrypted = encryptSecrets(keys, password);
  writeSecretsFile(OUT_PATH, encrypted);

  console.log(`\nSealed ${filledCount} key(s) → ${path.resolve(OUT_PATH)}`);
  console.log("\nIMPORTANT — set the master password in your deployment environment:");
  console.log(`  ${MASTER_PASSWORD_ENV_VAR}=<the password you just entered>`);
  console.log("\nThe master password is NOT stored or printed by this script.");
  console.log("Record it in your password manager and deployment secrets now.\n");
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
