import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { useFastShortTimeouts } from "../../test/helpers/fast-short-timeouts.js";
import { installEmbeddingManagerFixture } from "./embedding-manager.test-harness.js";

const fx = installEmbeddingManagerFixture({
  fixturePrefix: "openclaw-mem-",
  largeTokens: 4000,
  smallTokens: 200,
  createCfg: ({ workspaceDir, indexPath, tokens }) => ({
    agents: {
      defaults: {
        workspace: workspaceDir,
        memorySearch: {
          provider: "openai",
          model: "mock-embed",
          store: { path: indexPath, vector: { enabled: false } },
          chunking: { tokens, overlap: 0 },
          sync: { watch: false, onSessionStart: false, onSearch: false },
          query: { minScore: 0, hybrid: { enabled: false } },
        },
      },
      list: [{ id: "main", default: true }],
    },
  }),
});

describe("memory embedding batches", () => {
  function getEmbeddingMethods(manager: unknown): {
    embedBatchWithRetry: (texts: string[]) => Promise<number[][]>;
    embedQueryWithTimeout: (text: string) => Promise<number[]>;
  } {
    return manager as {
      embedBatchWithRetry: (texts: string[]) => Promise<number[][]>;
      embedQueryWithTimeout: (text: string) => Promise<number[]>;
    };
  }

  async function expectSyncWithFastTimeouts(manager: {
    sync: (params: { reason: string }) => Promise<void>;
  }) {
    const restoreFastTimeouts = useFastShortTimeouts();
    try {
      await manager.sync({ reason: "test" });
    } finally {
      restoreFastTimeouts();
    }
  }

  it("serializes concurrent batch embedding calls", async () => {
    const managerSmall = getEmbeddingMethods(fx.getManagerSmall());
    let releaseFirst: (() => void) | undefined;
    let resolveFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });

    fx.embedBatch.mockImplementationOnce(async (texts: string[]) => {
      resolveFirstStarted?.();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return texts.map(() => [0, 1, 0]);
    });

    const first = managerSmall.embedBatchWithRetry(["first"]);
    await firstStarted;
    const second = managerSmall.embedBatchWithRetry(["second"]);

    await Promise.resolve();
    await Promise.resolve();
    expect(fx.embedBatch).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await Promise.all([first, second]);

    expect(fx.embedBatch).toHaveBeenCalledTimes(2);
  });

  it("does not block query embeddings behind the batch retry lock", async () => {
    const managerSmall = getEmbeddingMethods(fx.getManagerSmall());
    let releaseBatch: (() => void) | undefined;
    let resolveBatchStarted: (() => void) | undefined;
    const batchStarted = new Promise<void>((resolve) => {
      resolveBatchStarted = resolve;
    });

    fx.embedBatch.mockImplementationOnce(async (texts: string[]) => {
      resolveBatchStarted?.();
      await new Promise<void>((resolve) => {
        releaseBatch = resolve;
      });
      return texts.map(() => [0, 1, 0]);
    });
    fx.embedQuery.mockResolvedValueOnce([9, 9, 9]);

    const batchPromise = managerSmall.embedBatchWithRetry(["index me"]);
    await batchStarted;

    try {
      const queryResult = await Promise.race([
        managerSmall.embedQueryWithTimeout("ping"),
        new Promise<number[]>((_, reject) => {
          setTimeout(() => reject(new Error("query embedding was blocked")), 100);
        }),
      ]);

      expect(queryResult).toEqual([9, 9, 9]);
      expect(fx.embedQuery).toHaveBeenCalledWith("ping");
    } finally {
      releaseBatch?.();
      await batchPromise;
    }
  });

  it("splits large files across multiple embedding batches", async () => {
    const memoryDir = fx.getMemoryDir();
    const managerLarge = fx.getManagerLarge();
    // Keep this small but above the embedding batch byte threshold (8k) so we
    // exercise multi-batch behavior without generating lots of chunks/DB rows.
    const line = "a".repeat(4200);
    const content = [line, line].join("\n");
    await fs.writeFile(path.join(memoryDir, "2026-01-03.md"), content);
    const updates: Array<{ completed: number; total: number; label?: string }> = [];
    await managerLarge.sync({
      progress: (update) => {
        updates.push(update);
      },
    });

    const status = managerLarge.status();
    const totalTexts = fx.embedBatch.mock.calls.reduce(
      (sum: number, call: unknown[]) => sum + ((call[0] as string[] | undefined)?.length ?? 0),
      0,
    );
    expect(totalTexts).toBe(status.chunks);
    expect(fx.embedBatch.mock.calls.length).toBeGreaterThan(1);
    const inputs: string[] = fx.embedBatch.mock.calls.flatMap(
      (call: unknown[]) => (call[0] as string[] | undefined) ?? [],
    );
    expect(inputs.every((text) => Buffer.byteLength(text, "utf8") <= 8000)).toBe(true);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.some((update) => update.label?.includes("/"))).toBe(true);
    const last = updates[updates.length - 1];
    expect(last?.total).toBeGreaterThan(0);
    expect(last?.completed).toBe(last?.total);
  });

  it("keeps small files in a single embedding batch", async () => {
    const memoryDir = fx.getMemoryDir();
    const managerSmall = fx.getManagerSmall();
    const line = "b".repeat(120);
    const content = Array.from({ length: 4 }, () => line).join("\n");
    await fs.writeFile(path.join(memoryDir, "2026-01-04.md"), content);
    await managerSmall.sync({ reason: "test" });

    expect(fx.embedBatch.mock.calls.length).toBe(1);
  });

  it("retries embeddings on transient rate limit and 5xx errors", async () => {
    const memoryDir = fx.getMemoryDir();
    const managerSmall = fx.getManagerSmall();
    const line = "d".repeat(120);
    const content = Array.from({ length: 4 }, () => line).join("\n");
    await fs.writeFile(path.join(memoryDir, "2026-01-06.md"), content);

    const transientErrors = [
      "openai embeddings failed: 429 rate limit",
      "openai embeddings failed: 502 Bad Gateway (cloudflare)",
    ];
    let calls = 0;
    fx.embedBatch.mockImplementation(async (texts: string[]) => {
      calls += 1;
      const transient = transientErrors[calls - 1];
      if (transient) {
        throw new Error(transient);
      }
      return texts.map(() => [0, 1, 0]);
    });

    await expectSyncWithFastTimeouts(managerSmall);

    expect(calls).toBe(3);
  }, 10000);

  it("retries embeddings on too-many-tokens-per-day rate limits", async () => {
    const memoryDir = fx.getMemoryDir();
    const managerSmall = fx.getManagerSmall();
    const line = "e".repeat(120);
    const content = Array.from({ length: 4 }, () => line).join("\n");
    await fs.writeFile(path.join(memoryDir, "2026-01-08.md"), content);

    let calls = 0;
    fx.embedBatch.mockImplementation(async (texts: string[]) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("AWS Bedrock embeddings failed: Too many tokens per day");
      }
      return texts.map(() => [0, 1, 0]);
    });

    await expectSyncWithFastTimeouts(managerSmall);

    expect(calls).toBe(2);
  }, 10000);

  it("skips empty chunks so embeddings input stays valid", async () => {
    const memoryDir = fx.getMemoryDir();
    const managerSmall = fx.getManagerSmall();
    await fs.writeFile(path.join(memoryDir, "2026-01-07.md"), "\n\n\n");
    await managerSmall.sync({ reason: "test" });

    const inputs = fx.embedBatch.mock.calls.flatMap(
      (call: unknown[]) => (call[0] as string[]) ?? [],
    );
    expect(inputs).not.toContain("");
  });
});
