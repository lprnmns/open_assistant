import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { ProductionBrain } from "./brain/brain-factory.js";
import { maybeStartConsciousnessLoop } from "./boot-lifecycle.js";
import { _resetInteractionTrackerForTest } from "./interaction-tracker.js";
import {
  getConsciousnessRuntime,
  setConsciousnessRuntime,
} from "./runtime.js";

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

describe("maybeStartConsciousnessLoop - production brain wiring", () => {
  afterEach(() => {
    _resetInteractionTrackerForTest();
    setConsciousnessRuntime(null);
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });

  it("registers the production brain in the runtime and clears it on stop", async () => {
    const brain = makeFakeBrain();
    const createProductionBrain = vi.fn().mockResolvedValue(brain);

    const lifecycle = await maybeStartConsciousnessLoop(
      {
        CONSCIOUSNESS_ENABLED: "1",
        CONSCIOUSNESS_STATE_PATH: "",
        CONSCIOUSNESS_DB_PATH: "data/founder-brain.db",
        CONSCIOUSNESS_SESSION_KEY: "founder-session",
      },
      {
        loadConfig: () => ({}) as OpenClawConfig,
        createProductionBrain,
      },
    );

    expect(lifecycle).not.toBeNull();
    expect(lifecycle?.brain).toBe(brain);
    expect(createProductionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        dbPath: "data/founder-brain.db",
        sessionKey: "founder-session",
      }),
    );
    expect(getConsciousnessRuntime()?.brain).toBe(brain);

    await lifecycle?.stop();

    expect(brain.close).toHaveBeenCalledOnce();
    expect(getConsciousnessRuntime()).toBeNull();
  });

  it("fails fast when production brain init throws", async () => {
    const createProductionBrain = vi
      .fn()
      .mockRejectedValue(new Error("embedding provider unavailable"));

    await expect(
      maybeStartConsciousnessLoop(
        {
          CONSCIOUSNESS_ENABLED: "1",
          CONSCIOUSNESS_STATE_PATH: "",
        },
        {
          loadConfig: () => ({}) as OpenClawConfig,
          createProductionBrain,
        },
      ),
    ).rejects.toThrow("embedding provider unavailable");

    expect(getConsciousnessRuntime()).toBeNull();
  });
});
