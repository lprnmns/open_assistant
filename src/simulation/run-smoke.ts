#!/usr/bin/env tsx
/**
 * src/simulation/run-smoke.ts — Maintainer CLI for runtime smoke scenarios
 *
 * Usage:
 *   pnpm tsx src/simulation/run-smoke.ts
 *
 * Runs all four runtime smoke scenarios and prints a pass/fail matrix.
 * Exit code 0 = all pass, 1 = at least one failure.
 *
 * ─────────────────────────────────────────────────────────────────────
 * SCOPE NOTE — Deterministic vs Live
 * ─────────────────────────────────────────────────────────────────────
 *
 * These scenarios are DETERMINISTIC SMOKE TESTS. They prove that the
 * system's decision pipelines produce correct outputs for controlled
 * inputs — without hitting a live LLM, external API, or database.
 *
 * What they prove:
 *   - Silence:       watchdog wake → tick() with injected llmCall →
 *                    SEND_MESSAGE decision → dispatchDecision() routes
 *                    content to the correct activeChannelId.
 *   - Act-First:     reversibility scoring → auto/confirm/blocked
 *                    decisions → humanApproved unlock for low-score
 *                    tools.  HTTP 409 approval_required response is
 *                    proven by separate gateway tests, not here.
 *   - Chrono-Spatial: temporal resolver parses "gecen hafta" →
 *                    UTC range → recall pipeline filters notes by
 *                    createdAt → no semantic-only fallback.
 *   - Cognitive Load: message signals → executive mode detection →
 *                    system prompt includes no-emoji + no-fluff rules.
 *
 * What they do NOT prove:
 *   - The tone, empathy, or exact wording of a live LLM response.
 *   - Network reliability of the LiteLLM proxy or provider APIs.
 *   - End-to-end message delivery through Telegram/Discord/etc.
 *   - Redis/DB persistence of interaction tracker state.
 *
 * For live integration tests, use the full gateway test suite with
 * a running LiteLLM proxy and real provider keys.
 */

import { runAllRuntimeSmokeScenarios, type SmokeScenarioReport } from "./scenarios.js";

const STATUS_ICON: Record<string, string> = {
  pass: "[PASS]",
  partial: "[PART]",
  fail: "[FAIL]",
};

function printReport(report: SmokeScenarioReport): void {
  const icon = STATUS_ICON[report.status] ?? "[????]";
  console.log(`\n${icon} ${report.id}`);
  console.log(`  ${report.summary}`);
  for (const check of report.checks) {
    const mark = check.passed ? "  + " : "  - ";
    console.log(`${mark}${check.label}: ${check.detail}`);
  }
}

async function main(): Promise<void> {
  console.log("Runtime Smoke Scenarios");
  console.log("=======================");

  const reports = await runAllRuntimeSmokeScenarios();

  for (const report of reports) {
    printReport(report);
  }

  console.log("\n--- Matrix ---");
  for (const report of reports) {
    const icon = STATUS_ICON[report.status] ?? "????";
    console.log(`  ${icon} ${report.id}`);
  }

  const allPass = reports.every((r) => r.status === "pass");
  console.log(`\nOverall: ${allPass ? "ALL PASS" : "HAS FAILURES"}`);
  process.exitCode = allPass ? 0 : 1;
}

void main();
