#!/usr/bin/env -S node --import tsx

import { pathToFileURL } from "node:url";
import { resolveDefaultAgentId } from "../src/agents/agent-scope.js";
import { loadConfig } from "../src/config/config.js";
import { callGateway } from "../src/gateway/call.js";
import type { DoctorExecApprovalStatusPayload } from "../src/gateway/server-methods/doctor.js";
import {
  checkExecApprovalRoutes,
  type ExecApprovalRouteCheckResult,
  type ExecApprovalRouteRuntimeProbe,
} from "../src/infra/exec-approval-route-check.js";

type ParsedArgs = {
  json: boolean;
  help: boolean;
  timeoutMs: number;
  agentId?: string;
  sessionKey?: string;
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    json: false,
    help: false,
    timeoutMs: 4_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) {
      continue;
    }
    if (current === "--json") {
      parsed.json = true;
      continue;
    }
    if (current === "--help" || current === "-h") {
      parsed.help = true;
      continue;
    }
    if (!current.startsWith("--")) {
      throw new Error(`Unknown argument: ${current}`);
    }
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    index += 1;
    switch (key) {
      case "agent-id":
        parsed.agentId = next;
        break;
      case "session-key":
        parsed.sessionKey = next;
        break;
      case "channel":
        parsed.channel = next;
        break;
      case "to":
        parsed.to = next;
        break;
      case "account-id":
        parsed.accountId = next;
        break;
      case "thread-id":
        parsed.threadId = next;
        break;
      case "timeout-ms": {
        const value = Number.parseInt(next, 10);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`Invalid --timeout-ms value: ${next}`);
        }
        parsed.timeoutMs = value;
        break;
      }
      default:
        throw new Error(`Unknown argument: --${key}`);
    }
  }

  return parsed;
}

function printHelp(): void {
  console.log(`Usage: pnpm tsx scripts/check-approval-routes.ts [options]

Options:
  --agent-id <id>        Agent id to evaluate (default: configured default agent)
  --session-key <key>    Session key for session-mode forwarding probes
  --channel <id>         Originating channel id (for example: telegram, discord, web)
  --to <target>          Originating destination id
  --account-id <id>      Originating account id
  --thread-id <id>       Originating thread id
  --timeout-ms <ms>      Gateway runtime probe timeout in milliseconds
  --json                 Print JSON instead of a human report
  -h, --help             Show this help text
`);
}

async function probeRuntimeExecApprovalClients(
  timeoutMs: number,
): Promise<ExecApprovalRouteRuntimeProbe> {
  const cfg = loadConfig();
  try {
    const payload = await callGateway<DoctorExecApprovalStatusPayload>({
      method: "doctor.exec-approval.status",
      config: cfg,
      timeoutMs,
    });
    return {
      checked: true,
      hasExecApprovalClients: payload.hasExecApprovalClients,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      checked: false,
      error: `Gateway runtime probe unavailable: ${message}`,
    };
  }
}

function renderReport(report: ExecApprovalRouteCheckResult): string {
  const lines = [
    "OpenClaw exec approval route check",
    `status: ${report.ready ? "READY" : "BLOCKED"}`,
    `summary: ${report.summary}`,
    "",
    "runtime",
    `  checked: ${report.runtime.checked ? "yes" : "no"}`,
    `  approval-clients: ${
      report.runtime.hasExecApprovalClients === true
        ? "connected"
        : report.runtime.checked
          ? "none"
          : "unverified"
    }`,
    report.runtime.error ? `  note: ${report.runtime.error}` : "",
    "",
    "request",
    `  agent-id: ${report.agentId}`,
    `  session-key: ${report.sessionKey}`,
    "",
    "surface",
    `  initiating-surface: ${report.initiatingSurface.kind}`,
    `  channel: ${report.initiatingSurface.channel ?? "auto"}`,
    `  approver-dm-route: ${report.approverDmRouteConfigured ? "configured" : "missing"}`,
    "",
    "forwarding",
    `  approvals.exec.enabled: ${report.forwarding.enabled ? "true" : "false"}`,
    `  mode: ${report.forwarding.mode}`,
    `  explicit-targets: ${report.forwarding.explicitTargetCount}`,
    `  route-ready-for-this-request: ${report.forwarding.routeReady ? "yes" : "no"}`,
  ].filter(Boolean);

  if (report.notes.length > 0) {
    lines.push("", "notes");
    for (const note of report.notes) {
      lines.push(`  - ${note}`);
    }
  }

  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    printHelp();
    return 2;
  }

  if (args.help) {
    printHelp();
    return 0;
  }

  const cfg = loadConfig();
  const runtime = await probeRuntimeExecApprovalClients(args.timeoutMs);
  const report = await checkExecApprovalRoutes({
    cfg,
    agentId: args.agentId ?? resolveDefaultAgentId(cfg),
    sessionKey: args.sessionKey,
    turnSourceChannel: args.channel,
    turnSourceTo: args.to,
    turnSourceAccountId: args.accountId,
    turnSourceThreadId: args.threadId,
    runtime,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderReport(report));
  }

  return report.ready ? 0 : 1;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint !== null && import.meta.url === entrypoint) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
