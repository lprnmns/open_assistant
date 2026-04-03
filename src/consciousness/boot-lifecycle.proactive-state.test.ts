/**
 * src/consciousness/boot-lifecycle.proactive-state.test.ts
 *
 * WS-1.3 real boot seam coverage for persisted proactive cooldown state.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { ProductionBrain } from "./brain/brain-factory.js";
import { maybeStartConsciousnessLoop } from "./boot-lifecycle.js";
import { _resetInteractionTrackerForTest } from "./interaction-tracker.js";
import { dispatchDecision } from "./integration.js";
import { setConsciousnessRuntime } from "./runtime.js";
import {
  DEFAULT_CONSCIOUSNESS_CONFIG,
  type TickDecision,
  type WorldSnapshot,
} from "./types.js";

const NOW = 1_700_000_000_000;

function makeTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-proactive-state-"));
  return path.join(dir, "consciousness-state.json");
}

function makeEnv(statePath: string): NodeJS.ProcessEnv {
  return {
    CONSCIOUSNESS_ENABLED: "1",
    CONSCIOUSNESS_STATE_PATH: statePath,
  } as NodeJS.ProcessEnv;
}

function writeState(
  filePath: string,
  partial: {
    lastProactiveSentAt?: number;
    lastUserInteractionAt?: number;
    activeChannelId?: string;
    activeChannelType?: string;
  },
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(partial, null, 2), "utf-8");
}

function readState(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

function makeSnap(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    capturedAt: NOW,
    lastUserInteractionAt: NOW - 60_000,
    pendingNoteCount: 0,
    firedTriggerIds: [],
    dueCronExpressions: [],
    externalWorldEvents: [],
    activeChannelId: "web-chat",
    activeChannelType: "webchat",
    lastTickAt: undefined,
    effectiveSilenceThresholdMs:
      DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs,
    ...overrides,
  };
}

function makeFakeBrain(): ProductionBrain {
  return {
    cortex: {
      stage: () => {},
      recent: () => [],
      clear: () => {},
    },
    hippocampus: {
      ingest: async () => {},
      recall: async () => [],
      close: async () => {},
    },
    embedder: {
      embed: async () => [],
    },
    ingestion: {
      ingest: vi.fn().mockResolvedValue(undefined),
    },
    recall: {
      recall: vi.fn().mockResolvedValue({ recent: [], recalled: [] }),
    },
    sessionKey: "consciousness-main",
    dbPath: "data/consciousness.db",
    providerId: "test-provider",
    model: "test-model",
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(brain: ProductionBrain = makeFakeBrain()) {
  return {
    loadConfig: () => ({}) as OpenClawConfig,
    createProductionBrain: vi.fn().mockResolvedValue(brain),
  };
}

afterEach(() => {
  _resetInteractionTrackerForTest();
  setConsciousnessRuntime(null);
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  vi.useRealTimers();
});

describe("maybeStartConsciousnessLoop - proactive cooldown persistence", () => {
  it("hydrates lastProactiveSentAt from the persisted interaction state at boot", async () => {
    const statePath = makeTempStatePath();
    writeState(statePath, {
      lastProactiveSentAt: NOW,
      lastUserInteractionAt: NOW - 120_000,
      activeChannelId: "telegram:owner",
      activeChannelType: "telegram",
    });

    const lifecycle = await maybeStartConsciousnessLoop(makeEnv(statePath), makeDeps());

    expect(lifecycle).not.toBeNull();
    expect(lifecycle?.getLastProactiveSentAt()).toBe(NOW);

    await lifecycle?.stop();
  });

  it("persists lastProactiveSentAt when the proactive send hook fires", async () => {
    const statePath = makeTempStatePath();
    const lifecycle = await maybeStartConsciousnessLoop(makeEnv(statePath), makeDeps());

    expect(lifecycle).not.toBeNull();

    lifecycle?._fireOnProactiveSentForTest(NOW);
    await lifecycle?.stop();

    expect(readState(statePath).lastProactiveSentAt).toBe(NOW);
  });

  it("restores the proactive cooldown across process restart", async () => {
    const statePath = makeTempStatePath();

    const lifecycleA = await maybeStartConsciousnessLoop(makeEnv(statePath), makeDeps());
    lifecycleA?._fireOnProactiveSentForTest(NOW);
    await lifecycleA?.stop();

    const lifecycleB = await maybeStartConsciousnessLoop(makeEnv(statePath), makeDeps());

    expect(lifecycleB).not.toBeNull();
    expect(lifecycleB?.getLastProactiveSentAt()).toBe(NOW);

    await lifecycleB?.stop();
  });

  it("rate-limits a restarted lifecycle when the persisted proactive cooldown is still active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW + 30_000));

    const statePath = makeTempStatePath();
    writeState(statePath, { lastProactiveSentAt: NOW });

    const lifecycle = await maybeStartConsciousnessLoop(makeEnv(statePath), makeDeps());
    const sendToChannel = vi.fn().mockResolvedValue(undefined);
    const decision: TickDecision = {
      action: "SEND_MESSAGE",
      messageContent: "Still too soon",
    };

    const result = await dispatchDecision(
      decision,
      makeSnap(),
      {
        sendToChannel,
        appendNote: vi.fn().mockResolvedValue(undefined),
        proactiveState: { lastSentAt: lifecycle?.getLastProactiveSentAt() },
      },
      {
        ...DEFAULT_CONSCIOUSNESS_CONFIG,
        proactiveMessageMinIntervalMs: 60_000,
      },
    );

    expect(result.dispatched).toBe(false);
    expect(sendToChannel).not.toHaveBeenCalled();

    await lifecycle?.stop();
  });

  it("allows a restarted lifecycle to send again after the persisted cooldown elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW + 61_000));

    const statePath = makeTempStatePath();
    writeState(statePath, { lastProactiveSentAt: NOW });

    const lifecycle = await maybeStartConsciousnessLoop(makeEnv(statePath), makeDeps());
    const sendToChannel = vi.fn().mockResolvedValue(undefined);
    const decision: TickDecision = {
      action: "SEND_MESSAGE",
      messageContent: "Cooldown elapsed",
    };

    const result = await dispatchDecision(
      decision,
      makeSnap({
        activeChannelId: "telegram:owner",
        activeChannelType: "telegram",
      }),
      {
        sendToChannel,
        appendNote: vi.fn().mockResolvedValue(undefined),
        proactiveState: { lastSentAt: lifecycle?.getLastProactiveSentAt() },
      },
      {
        ...DEFAULT_CONSCIOUSNESS_CONFIG,
        proactiveMessageMinIntervalMs: 60_000,
      },
    );

    expect(result.dispatched).toBe(true);
    expect(sendToChannel).toHaveBeenCalledOnce();

    await lifecycle?.stop();
  });
});
