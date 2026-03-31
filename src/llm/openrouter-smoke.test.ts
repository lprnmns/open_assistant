/**
 * src/llm/openrouter-smoke.test.ts — OpenRouter live smoke tests (opt-in)
 *
 * Makes REAL HTTP calls through the LiteLLM proxy → OpenRouter.
 * Skipped by default; only runs when OPEN_ASSISTANT_LIVE_SMOKE=1.
 *
 * Required environment:
 *   OPEN_ASSISTANT_LIVE_SMOKE=1        — opt-in flag
 *   OPENROUTER_API_KEY=sk-or-v1-...    — real OpenRouter key (kept in env only)
 *   LITELLM_MASTER_KEY=...             — LiteLLM proxy master key
 *   LITELLM_PROXY_URL=...              — proxy base URL (default http://localhost:4000)
 *
 * Optional:
 *   OPEN_ASSISTANT_LIVE_DEBUG=1        — verbose debug output (secrets masked)
 *
 * To run (from repo root):
 *   OPEN_ASSISTANT_LIVE_SMOKE=1 \
 *   OPENROUTER_API_KEY=<your-key> \
 *   LITELLM_MASTER_KEY=<proxy-key> \
 *   pnpm test -- src/llm/openrouter-smoke.test.ts --reporter=verbose
 *
 * SECURITY: never pass the key as a command-line argument that may appear in
 * process listings; always use environment variables.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proxyCall } from "./proxy-client.js";
import { tick, makeInitialConsciousnessState } from "../consciousness/loop.js";
import { ConsciousnessScheduler } from "../consciousness/scheduler.js";
import { redactLogLine } from "../config/byok-secrets.js";
import { makeEventBuffer, addEvent, listBySurface } from "../consciousness/events/buffer.js";
import type { BufferedEvent } from "../consciousness/events/buffer.js";
import type { WorldSnapshot } from "../consciousness/types.js";
import { DEFAULT_CONSCIOUSNESS_CONFIG } from "../consciousness/types.js";

// ── Opt-in guard ───────────────────────────────────────────────────────────────

const isLive = !!process.env.OPEN_ASSISTANT_LIVE_SMOKE;
const isDebug = !!process.env.OPEN_ASSISTANT_LIVE_DEBUG;

// ── Debug helper — secrets always masked ──────────────────────────────────────

function debugLog(label: string, value: unknown): void {
  if (!isDebug) return;
  let raw: string;
  if (typeof value === "string") {
    raw = value;
  } else if (value !== null && typeof value === "object") {
    raw = JSON.stringify(value, null, 2);
  } else {
    raw = String(value);
  }
  // redactLogLine ensures no key material survives into log output
  console.log(`[SMOKE:${label}]`, redactLogLine(raw));
}

// ── Env setup — ensure only OpenRouter key is active ──────────────────────────

const SAVED_ENV: Partial<Record<string, string>> = {};

function isolateToOpenRouter(): void {
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
    SAVED_ENV[k] = process.env[k];
    delete process.env[k];
  }
  // OPENROUTER_API_KEY must already be in process.env (user-provided)
}

function restoreEnv(): void {
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
    if (SAVED_ENV[k] !== undefined) {
      process.env[k] = SAVED_ENV[k];
    } else {
      delete process.env[k];
    }
  }
}

// ── Snapshot builder ───────────────────────────────────────────────────────────

const NOW = Date.now();

function makeWakeSnap(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    capturedAt: NOW,
    lastUserInteractionAt: NOW - 60_000,
    pendingNoteCount: 0,
    firedTriggerIds: ["smoke-trigger"],   // ensures Watchdog always wakes
    dueCronExpressions: [],
    externalWorldEvents: [],
    activeChannelId: "smoke-channel",
    lastTickAt: undefined,
    effectiveSilenceThresholdMs: DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs,
    ...overrides,
  };
}

// ── Smoke 1: Low-level proxy smoke ────────────────────────────────────────────
//
// Validates the full path: proxyCall() → LiteLLM → OpenRouter
// Single short prompt; verifies non-empty text, model echoed, usage present.

describe("LIVE SMOKE 1 — low-level proxyCall via OpenRouter", () => {
  beforeEach(isolateToOpenRouter);
  afterEach(restoreEnv);

  it.skipIf(!isLive)("returns non-empty content, model, and usage from OpenRouter", async () => {
    debugLog("env/provider", "OpenRouter only (Anthropic/OpenAI/Google isolated)");
    debugLog("env/proxy_url", process.env.LITELLM_PROXY_URL ?? "http://localhost:4000");
    // Key presence check — value is never logged
    debugLog("env/key_present", !!process.env.OPENROUTER_API_KEY ? "YES" : "NO");

    const result = await proxyCall({
      source: "consciousness",
      messages: [
        { role: "system", content: "You are a helpful assistant. Be very brief." },
        { role: "user", content: "Reply with exactly: SMOKE_OK" },
      ],
      maxTokens: 32,
      temperature: 0,
    });

    debugLog("result/model", result.model);
    debugLog("result/content", result.content);
    debugLog("result/usage", result.usage);

    expect(result.content).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.model).toBeTruthy();
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBe(
      result.usage.promptTokens + result.usage.completionTokens,
    );
  }, 30_000); // 30s timeout for live network call
});

// ── Smoke 2: Consciousness tick live smoke ────────────────────────────────────
//
// Validates tick() → proxyCall() → OpenRouter.
// Verifies TickResult shape, no crash, eventBuffer field present.

describe("LIVE SMOKE 2 — consciousness tick() via OpenRouter", () => {
  beforeEach(isolateToOpenRouter);
  afterEach(restoreEnv);

  it.skipIf(!isLive)("tick() returns a valid TickResult with action and eventBuffer", async () => {
    const snap = makeWakeSnap();
    const state = makeInitialConsciousnessState();

    debugLog("tick/snap/firedTriggerIds", snap.firedTriggerIds);

    const result = await tick(snap, state);

    debugLog("tick/watchdogResult/wake", result.watchdogResult.wake);
    debugLog("tick/decision/action", result.decision?.action ?? "undefined");
    debugLog("tick/state/phase", result.state.phase);
    debugLog("tick/state/llmCallCount", result.state.llmCallCount);
    debugLog("tick/nextDelayMs", result.nextDelayMs);
    debugLog("tick/eventBuffer/ownerCount",
      listBySurface(result.eventBuffer, "owner_active_channel").length);
    debugLog("tick/eventBuffer/thirdCount",
      listBySurface(result.eventBuffer, "third_party_contact").length);

    // Watchdog must wake (firedTriggerIds is set)
    expect(result.watchdogResult.wake).toBe(true);

    // LLM was called
    expect(result.state.llmCallCount).toBe(1);

    // Decision must be one of the valid actions
    expect(["SEND_MESSAGE", "TAKE_NOTE", "STAY_SILENT", "ENTER_SLEEP"]).toContain(
      result.decision?.action,
    );

    // TickResult shape
    expect(typeof result.nextDelayMs).toBe("number");
    expect(result.nextDelayMs).toBeGreaterThan(0);

    // eventBuffer must be present and well-formed
    expect(result.eventBuffer).toBeDefined();
    expect(Array.isArray(result.eventBuffer.events)).toBe(true);

    // State is sane
    expect(result.state.tickCount).toBe(1);
    expect(["IDLE", "SLEEPING"]).toContain(result.state.phase);
  }, 30_000);
});

// ── Smoke 3: Scheduler short live smoke ──────────────────────────────────────
//
// Validates the full scheduler chain: pushEvent → inject → tick → drain.
// Runs 2 real ticks with small interval.
// Captures fetch call bodies (via spy-without-mock) to verify:
//   - Tick 1 body contains the pushed owner event
//   - If tick 1 acted (SEND_MESSAGE/TAKE_NOTE), tick 2 body must NOT contain it
//   - If tick 1 stayed silent, event persists to tick 2 (both bodies contain it)

describe("LIVE SMOKE 3 — scheduler tick chain via OpenRouter", () => {
  beforeEach(isolateToOpenRouter);
  afterEach(restoreEnv);

  it.skipIf(!isLive)(
    "2 real ticks complete without crash; owner event inject/drain semantics hold",
    async () => {
      const TICK_INTERVAL = 500; // ms — keep smoke fast

      // Spy on fetch WITHOUT replacing implementation (pass-through, real calls)
      const capturedBodies: string[] = [];
      const originalFetch = globalThis.fetch;

      const tickResults: { action: string | undefined; ownerCount: number }[] = [];
      let tickCount = 0;

      // Use a unique summary token that will appear verbatim in the prompt.
      // The prompt renders: "[timestamp] source: summary" — the id is not shown.
      const SMOKE_EVENT_TOKEN = "SMOKE_EVENT_MARKER_e1";
      const ownerEvent: BufferedEvent = {
        id: "smoke-owner-e1",
        surface: "owner_active_channel",
        source: "smoke-channel",
        summary: SMOKE_EVENT_TOKEN,
        receivedAt: Date.now(),
      };

      let scheduler: ConsciousnessScheduler | undefined;

      try {
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.body && typeof init.body === "string") {
            // Redact before storing — guard against accidental key capture
            capturedBodies.push(redactLogLine(init.body));
          }
          return originalFetch(input, init);
        };

        scheduler = new ConsciousnessScheduler({
          config: {
            minTickIntervalMs: TICK_INTERVAL,
            maxTickIntervalMs: TICK_INTERVAL * 2,
            watchdogIntervalMs: TICK_INTERVAL / 2,
            baseSilenceThresholdMs: DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs,
            maxSilenceThresholdMs: DEFAULT_CONSCIOUSNESS_CONFIG.maxSilenceThresholdMs,
            sleepStartHourUtc: DEFAULT_CONSCIOUSNESS_CONFIG.sleepStartHourUtc,
            sleepEndHourUtc: DEFAULT_CONSCIOUSNESS_CONFIG.sleepEndHourUtc,
            postConsolidationDelayMs: DEFAULT_CONSCIOUSNESS_CONFIG.postConsolidationDelayMs,
            llmSource: "consciousness",
          },
          buildSnapshot: async () => makeWakeSnap({ capturedAt: Date.now() }),
          dispatch: {
            sendToChannel: async () => {},
            appendNote: async () => {},
          },
          onTick: (result) => {
            tickCount++;
            const ownerCount = listBySurface(result.eventBuffer, "owner_active_channel").length;
            tickResults.push({ action: result.decision?.action, ownerCount });
            debugLog(`scheduler/tick${tickCount}/action`, result.decision?.action ?? "undefined");
            debugLog(`scheduler/tick${tickCount}/ownerEventCount`, ownerCount);
            debugLog(`scheduler/tick${tickCount}/phase`, result.state.phase);
          },
        });

        scheduler.pushEvent(ownerEvent);
        scheduler.start();

        // Wait for 2 ticks + buffer
        await new Promise<void>((resolve) =>
          setTimeout(resolve, TICK_INTERVAL * 2 + 2000),
        );
      } finally {
        scheduler?.stop();
        globalThis.fetch = originalFetch;
      }

      debugLog("scheduler/totalTicks", tickCount);
      debugLog("scheduler/capturedBodyCount", capturedBodies.length);

      // At least 1 tick must have fired
      expect(tickCount).toBeGreaterThanOrEqual(1);

      // All tick results must have a valid action
      for (const r of tickResults) {
        expect(["SEND_MESSAGE", "TAKE_NOTE", "STAY_SILENT", "ENTER_SLEEP", undefined]).toContain(
          r.action,
        );
      }

      // Tick 1: owner event must have been injected into the first LLM call body
      if (capturedBodies[0] !== undefined) {
        const firstBody = capturedBodies[0];
        // The summary token must appear in the serialized prompt
        // (buildEventPromptLines renders: "[timestamp] source: summary")
        expect(firstBody).toContain(SMOKE_EVENT_TOKEN);
        debugLog("scheduler/tick1/bodyContainsEvent",
          firstBody.includes(SMOKE_EVENT_TOKEN) ? "YES" : "NO");
      }

      // Tick 2 drain verification (conditional on first tick action)
      if (tickResults[0] !== undefined && tickResults[1] !== undefined) {
        const t1Action = tickResults[0].action;
        const t2Body = capturedBodies[1];

        if ((t1Action === "SEND_MESSAGE" || t1Action === "TAKE_NOTE") && t2Body !== undefined) {
          // Owner event was acted on → must be drained → absent from tick 2
          debugLog("scheduler/tick2/drainVerification",
            "SEND_MESSAGE/TAKE_NOTE → event should be gone");
          expect(t2Body).not.toContain(SMOKE_EVENT_TOKEN);
        } else if (t1Action === "STAY_SILENT" && t2Body !== undefined) {
          // Not drained → must still be present in tick 2
          debugLog("scheduler/tick2/drainVerification",
            "STAY_SILENT → event should persist");
          expect(t2Body).toContain(SMOKE_EVENT_TOKEN);
        }
        // ENTER_SLEEP: LLM might not be called on tick 2 (SLEEPING phase), skip body check
      }
    },
    60_000, // 60s timeout — two real network round-trips
  );
});
