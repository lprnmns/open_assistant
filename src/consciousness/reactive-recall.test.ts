import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAgentAssistantMessage } from "../agents/test-helpers/agent-message-fixtures.js";
import type { ProductionBrain } from "./brain/brain-factory.js";
import { buildReactiveRecallSection, formatReactiveRecallSection } from "./reactive-recall.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.allSettled(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

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

  it("includes transcript ground truth for temporal questions before semantic recall", async () => {
    const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-reactive-recall-"));
    tempDirs.push(sessionsDir);
    const sessionManager = SessionManager.create(sessionsDir, sessionsDir);
    sessionManager.appendMessage({
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "Conversation info (untrusted metadata):",
            "```json",
            JSON.stringify(
              {
                message_id: "ACB3952074F035F479BA013380F019E2",
                sender_id: "+905075086027",
                sender: "Alperen",
              },
              null,
              2,
            ),
            "```",
            "",
            "Sender (untrusted metadata):",
            "```json",
            JSON.stringify(
              {
                label: "Alperen (+905075086027)",
                id: "+905075086027",
                name: "Alperen",
              },
              null,
              2,
            ),
            "```",
            "",
            "kod patladi acil bak",
          ].join("\n"),
        },
      ],
      timestamp: Date.parse("2026-04-04T15:27:42.000Z"),
    });
    sessionManager.appendMessage(
      makeAgentAssistantMessage({
        content: [{ type: "text", text: "Ne patladi tam olarak?" }],
        timestamp: Date.parse("2026-04-04T15:28:00.000Z"),
      }),
    );
    sessionManager.appendMessage({
      role: "user",
      content: "su kodun patlama ani neydi",
      timestamp: Date.parse("2026-04-05T08:08:42.000Z"),
    });
    sessionManager.appendMessage({
      role: "user",
      content: "su kodun patlama anini demistim ne zamandi o tarih saat hatirliyor musun",
      timestamp: Date.parse("2026-04-05T08:37:39.000Z"),
    });

    const sessionFile = sessionManager.getSessionFile();
    if (!sessionFile) {
      throw new Error("Expected transcript file");
    }
    const sessionId = path.basename(sessionFile, ".jsonl");
    const storePath = path.join(sessionsDir, "sessions.json");
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "agent:main:whatsapp:direct:+905075086027": {
          sessionId,
          sessionFile,
          updatedAt: Date.now(),
        },
      }),
      "utf8",
    );

    const brain = makeFakeBrain();
    const section = await buildReactiveRecallSection({
      text: "su kodun patlama ani neydi",
      sessionKey: "agent:main:whatsapp:direct:+905075086027",
      runtime: { brain },
      storePath,
    });

    expect(section).toContain("Transcript ground truth (prefer this for exact dates/times):");
    expect(section).toContain("Exact timestamp rule:");
    expect(section).toContain("kod patladi acil bak");
    expect(section).not.toContain("Conversation info (untrusted metadata):");
    expect(section).toContain("2026-04-04 18:27:42");
    expect(section).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(section).not.toContain("su kodun patlama ani neydi");
    expect(section?.indexOf("Transcript ground truth")).toBeLessThan(
      section?.indexOf("Recent conversation:") ?? Number.POSITIVE_INFINITY,
    );
  });
});
