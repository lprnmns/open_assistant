/**
 * src/commands/cost.ts — `openclaw cost` CLI command
 *
 * Shows BYOK LLM spend from the local cost store, broken down by source
 * (chat / consciousness / extraction / sleep).
 *
 * Usage:
 *   openclaw cost today          # today's spend (default)
 *   openclaw cost today --json   # machine-readable JSON output
 */

import type { Command } from "commander";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { queryToday } from "../llm/cost-store.js";

const COST_DB_FILENAME = "llm-costs.db";

function costDbPath(stateDir: string = resolveStateDir()): string {
  return path.join(stateDir, COST_DB_FILENAME);
}

type CostCommandOptions = {
  json?: boolean;
  stateDir?: string;
};

// ── Formatters ────────────────────────────────────────────────────────────────

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatTable(
  data: ReturnType<typeof queryToday>,
  jsonMode: boolean,
): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }

  const sources = ["chat", "consciousness", "extraction", "sleep"] as const;
  const rows = sources.map((s) => ({
    source: s,
    calls: data[s].calls,
    tokens: data[s].totalTokens,
    cost: data[s].costUsd,
  }));

  const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
  const totalCalls = rows.reduce((sum, r) => sum + r.calls, 0);
  const totalTokens = rows.reduce((sum, r) => sum + r.tokens, 0);

  const colWidths = { source: 14, calls: 6, tokens: 10, cost: 10 };

  function pad(s: string, width: number): string {
    return s.padEnd(width);
  }
  function rpad(s: string, width: number): string {
    return s.padStart(width);
  }

  const header =
    pad("SOURCE", colWidths.source) +
    rpad("CALLS", colWidths.calls) +
    rpad("TOKENS", colWidths.tokens) +
    rpad("COST (USD)", colWidths.cost);
  const separator = "-".repeat(header.length);

  console.log("\nBYOK LLM Cost — Today (UTC)\n");
  console.log(header);
  console.log(separator);

  for (const row of rows) {
    if (row.calls === 0) continue;
    console.log(
      pad(row.source, colWidths.source) +
        rpad(String(row.calls), colWidths.calls) +
        rpad(String(row.tokens), colWidths.tokens) +
        rpad(formatUsd(row.cost), colWidths.cost),
    );
  }

  console.log(separator);
  console.log(
    pad("TOTAL", colWidths.source) +
      rpad(String(totalCalls), colWidths.calls) +
      rpad(String(totalTokens), colWidths.tokens) +
      rpad(formatUsd(totalCost), colWidths.cost),
  );
  console.log();

  if (totalCalls === 0) {
    console.log("No LLM calls recorded today.");
  }
}

// ── Command handler ───────────────────────────────────────────────────────────

async function runCostToday(opts: CostCommandOptions): Promise<void> {
  const dbPath = costDbPath(opts.stateDir);
  const data = queryToday(dbPath);
  formatTable(data, opts.json ?? false);
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerCostCli(program: Command): void {
  const cost = program
    .command("cost")
    .description("Show BYOK LLM spending from the local cost store")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  openclaw cost today          Show today's spend by source\n" +
        "  openclaw cost today --json   Machine-readable JSON output\n",
    );

  cost
    .command("today")
    .description("Show today's LLM spend broken down by source (UTC day)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: CostCommandOptions) => {
      await runCostToday(opts);
    });

  // Default action when no subcommand is given: run `today`
  cost.action(async (opts: CostCommandOptions) => {
    await runCostToday(opts);
  });
}
