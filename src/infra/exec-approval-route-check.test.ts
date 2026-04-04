import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { buildAgentMainSessionKey } from "../routing/session-key.js";
import { checkExecApprovalRoutes } from "./exec-approval-route-check.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-approval-route-"));
}

function writeSessionStore(rootDir: string, sessionKey: string): string {
  const storePath = path.join(rootDir, "agents", "main", "sessions", "sessions.json");
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(
    storePath,
    JSON.stringify(
      {
        [sessionKey]: {
          sessionId: "main",
          updatedAt: 1,
          lastChannel: "telegram",
          lastTo: "12345",
          lastAccountId: "default",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return storePath;
}

afterEach(() => {
  process.env.OPENCLAW_STATE_DIR = "";
});

describe("checkExecApprovalRoutes", () => {
  it("treats explicit forwarding targets as a ready approval route", async () => {
    const result = await checkExecApprovalRoutes({
      cfg: {
        approvals: {
          exec: {
            enabled: true,
            mode: "targets",
            targets: [{ channel: "telegram", to: "12345" }],
          },
        },
      } as OpenClawConfig,
      runtime: {
        checked: true,
        hasExecApprovalClients: false,
      },
    });

    expect(result.ready).toBe(true);
    expect(result.forwarding.routeReady).toBe(true);
    expect(result.forwarding.explicitTargetCount).toBe(1);
  });

  it("treats connected operator approval clients as ready even without forwarding", async () => {
    const result = await checkExecApprovalRoutes({
      cfg: {} as OpenClawConfig,
      runtime: {
        checked: true,
        hasExecApprovalClients: true,
      },
    });

    expect(result.ready).toBe(true);
    expect(result.forwarding.routeReady).toBe(false);
    expect(result.summary).toContain("Connected operator approval client");
  });

  it("resolves a real session-mode forwarding route from the session store", async () => {
    const rootDir = makeTempDir();
    const sessionKey = buildAgentMainSessionKey({ agentId: "main" });
    const storePath = writeSessionStore(rootDir, sessionKey);
    const result = await checkExecApprovalRoutes({
      cfg: {
        session: {
          store: path.join(rootDir, "agents", "{agentId}", "sessions", "sessions.json"),
        },
        approvals: {
          exec: {
            enabled: true,
            mode: "session",
          },
        },
      } as OpenClawConfig,
      sessionKey,
      runtime: {
        checked: true,
        hasExecApprovalClients: false,
      },
    });

    expect(storePath).toContain("sessions.json");
    expect(result.ready).toBe(true);
    expect(result.forwarding.routeReady).toBe(true);
  });

  it("reports blocked when neither runtime clients nor forwarding are available", async () => {
    const result = await checkExecApprovalRoutes({
      cfg: {} as OpenClawConfig,
      runtime: {
        checked: true,
        hasExecApprovalClients: false,
      },
    });

    expect(result.ready).toBe(false);
    expect(result.forwarding.routeReady).toBe(false);
    expect(result.summary).toContain("No connected operator approval client");
  });
});
