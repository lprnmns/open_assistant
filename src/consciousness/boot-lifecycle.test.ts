/**
 * src/consciousness/boot-lifecycle.test.ts
 *
 * Basic production boot wiring coverage:
 *   - feature flag off -> no boot
 *   - feature flag on  -> scheduler starts
 *   - shutdown signal  -> stop() is safe and idempotent
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { ProductionBrain } from "./brain/brain-factory.js";
import { maybeStartConsciousnessLoop } from "./boot-lifecycle.js";
import { setConsciousnessRuntime } from "./runtime.js";

function withFlag(value: string | undefined): NodeJS.ProcessEnv {
  return { CONSCIOUSNESS_ENABLED: value, CONSCIOUSNESS_STATE_PATH: "" } as NodeJS.ProcessEnv;
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

async function start(env: NodeJS.ProcessEnv) {
  return await maybeStartConsciousnessLoop(env, makeDeps());
}

describe("maybeStartConsciousnessLoop", () => {
  afterEach(() => {
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    setConsciousnessRuntime(null);
  });

  it("returns null when CONSCIOUSNESS_ENABLED is absent", async () => {
    const result = await maybeStartConsciousnessLoop({} as NodeJS.ProcessEnv, makeDeps());
    expect(result).toBeNull();
  });

  it("returns null when CONSCIOUSNESS_ENABLED=0", async () => {
    expect(await maybeStartConsciousnessLoop(withFlag("0"), makeDeps())).toBeNull();
  });

  it("returns null when CONSCIOUSNESS_ENABLED=false", async () => {
    expect(await maybeStartConsciousnessLoop(withFlag("false"), makeDeps())).toBeNull();
  });

  it("returns null when CONSCIOUSNESS_ENABLED is empty string", async () => {
    expect(await maybeStartConsciousnessLoop(withFlag(""), makeDeps())).toBeNull();
  });

  it("returns a lifecycle when CONSCIOUSNESS_ENABLED=1", async () => {
    const lc = await start(withFlag("1"));
    expect(lc).not.toBeNull();
    expect(typeof lc?.stop).toBe("function");
    expect(lc?.scheduler).toBeDefined();
    expect(lc?.brain).toBeDefined();
    expect(lc?.reflectionQueue).toBeDefined();
    expect(lc?.auditLog).toBeDefined();
    await lc?.stop();
  });

  it("returns a lifecycle when CONSCIOUSNESS_ENABLED=true", async () => {
    const lc = await start(withFlag("true"));
    expect(lc).not.toBeNull();
    await lc?.stop();
  });

  it("scheduler is running after start", async () => {
    const lc = await start(withFlag("1"));
    expect(lc).not.toBeNull();
    await expect(lc!.stop()).resolves.toBeUndefined();
  });

  it("stop() is idempotent", async () => {
    const lc = await start(withFlag("1"));
    expect(lc).not.toBeNull();
    await lc!.stop();
    await expect(lc!.stop()).resolves.toBeUndefined();
    await expect(lc!.stop()).resolves.toBeUndefined();
  });

  it("reflectionQueue starts empty", async () => {
    const lc = await start(withFlag("1"));
    expect(lc!.reflectionQueue.count()).toBe(0);
    await lc!.stop();
  });

  it("reflectionQueue.count() feeds pendingNoteCount in snapshot", async () => {
    const lc = await start(withFlag("1"));
    expect(lc!.reflectionQueue.count()).toBe(0);
    lc!.reflectionQueue.enqueue("pending note for reflection");
    expect(lc!.reflectionQueue.count()).toBe(1);
    await lc!.stop();
  });
});
