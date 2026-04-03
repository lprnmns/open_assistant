import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { createProductionBrain } from "./brain-factory.js";
import {
  createProductionEmbedder,
  type ProductionEmbedder,
} from "./embedder-factory.js";

describe("createProductionBrain", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-brain-factory-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the brain db parent directory and wires metadata", async () => {
    const dbPath = path.join(tmpDir, "nested", "consciousness.db");
    const fakeCreateProductionEmbedder = vi
      .fn()
      .mockResolvedValue({
        settings: {} as unknown as ProductionEmbedder["settings"],
        providerId: "test-provider",
        model: "test-model",
        embedder: {
          embed: async () => [1, 0, 0],
        },
      } satisfies ProductionEmbedder);

    const brain = await createProductionBrain(
      {
        cfg: {} as OpenClawConfig,
        dbPath,
        sessionKey: "founder-session",
        agentId: "main",
      },
      {
        createProductionEmbedder:
          fakeCreateProductionEmbedder as typeof createProductionEmbedder,
      },
    );

    expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
    expect(brain.dbPath).toBe(dbPath);
    expect(brain.sessionKey).toBe("founder-session");
    expect(brain.providerId).toBe("test-provider");
    expect(brain.model).toBe("test-model");

    await brain.ingestion.ingest({
      content: "[user]: hello founder brain",
      sessionKey: "founder-session",
    });
    const recalled = await brain.recall.recall({
      text: "hello founder brain",
      sessionKey: "founder-session",
      recentN: 1,
      k: 1,
    });

    expect(recalled.recent).toHaveLength(1);
    expect(recalled.recent[0]?.content).toBe("[user]: hello founder brain");

    await brain.close();
  });
});
