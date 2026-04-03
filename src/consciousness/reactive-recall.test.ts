import { describe, expect, it, vi } from "vitest";
import type { ProductionBrain } from "./brain/brain-factory.js";
import { buildReactiveRecallSection, formatReactiveRecallSection } from "./reactive-recall.js";

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
      recall: vi.fn().mockResolvedValue({
        recent: [
          {
            id: "recent-1",
            content: "[user]: launchi gecen sali konustuk",
            type: "episodic",
            createdAt: 1,
            sessionKey: "main",
          },
        ],
        recalled: [
          {
            id: "recalled-1",
            content: "[assistant]: evet, deadline cuma demistim",
            type: "episodic",
            createdAt: 2,
            sessionKey: "main",
          },
        ],
        warning: "No notes found in that time range.",
      }),
    },
    sessionKey: "consciousness-main",
    dbPath: "data/consciousness.db",
    providerId: "test-provider",
    model: "test-model",
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("reactive-recall", () => {
  it("formats memory recall sections with warning, recent, and related notes", () => {
    const section = formatReactiveRecallSection({
      recent: [
        {
          id: "recent-1",
          content: "[user]: hello",
          type: "episodic",
          createdAt: 1,
          sessionKey: "main",
        },
      ],
      recalled: [
        {
          id: "recalled-1",
          content: "[assistant]: hi back",
          type: "episodic",
          createdAt: 2,
          sessionKey: "main",
        },
      ],
      warning: "No notes found in that time range.",
    });

    expect(section).toContain("Consciousness memory context:");
    expect(section).toContain("Temporal recall warning: No notes found in that time range.");
    expect(section).toContain("- [user]: hello");
    expect(section).toContain("- [assistant]: hi back");
  });

  it("skips reactive recall when runtime or session key is missing", async () => {
    await expect(
      buildReactiveRecallSection({
        text: "gecen sali ne konustuk",
        sessionKey: undefined,
      }),
    ).resolves.toBeUndefined();

    await expect(
      buildReactiveRecallSection({
        text: "gecen sali ne konustuk",
        sessionKey: "main",
        runtime: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("queries the runtime brain recall pipeline and returns a formatted section", async () => {
    const brain = makeFakeBrain();

    const section = await buildReactiveRecallSection({
      text: "gecen sali ne konustuk",
      sessionKey: "main",
      runtime: { brain },
    });

    expect(brain.recall.recall).toHaveBeenCalledWith({
      text: "gecen sali ne konustuk",
      sessionKey: "main",
    });
    expect(section).toContain("Recent conversation:");
    expect(section).toContain("[user]: launchi gecen sali konustuk");
    expect(section).toContain("[assistant]: evet, deadline cuma demistim");
  });
});
