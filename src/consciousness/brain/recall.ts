/**
 * src/consciousness/brain/recall.ts — MemoryRecallPipeline implementation
 *
 * Orchestrates the read path executed before each LLM tick:
 *
 *   Step 1  Cortex.recent(recentN)      synchronous, UNCONDITIONAL — always runs
 *   Step 2  Embedder.embed(query.text)  async; failure → recalled:[], recent intact
 *   Step 3  Hippocampus.recall(...)     async; failure → recalled:[], recent intact
 *   Step 4  Deduplicate                 notes in recent removed from recalled (by id)
 *   → MemoryRecallResult { recent, recalled }
 *
 * Invariants enforced here:
 *   - Cortex.recent runs unconditionally as step 1.  No exception.
 *   - recall() NEVER throws or rejects.  All errors are caught and swallowed.
 *   - If Embedder fails, Hippocampus is not called (no vector available).
 *     The recent slice is unaffected.
 *   - If Hippocampus fails, recalled is [] and recent is unaffected.
 *   - Deduplication is by id — a note in recent is never duplicated in recalled.
 *   - RECALL_DEFAULTS apply when recentN / k are omitted from the query.
 */

import {
  RECALL_DEFAULTS,
  type Cortex,
  type Embedder,
  type Hippocampus,
  type MemoryNote,
  type MemoryRecallPipeline,
  type MemoryRecallQuery,
  type MemoryRecallResult,
} from "./types.js";

// ── DefaultMemoryRecallPipeline ───────────────────────────────────────────────

export class DefaultMemoryRecallPipeline implements MemoryRecallPipeline {
  constructor(
    private readonly cortex: Cortex,
    private readonly embedder: Embedder,
    private readonly hippocampus: Hippocampus,
  ) {}

  async recall(query: MemoryRecallQuery): Promise<MemoryRecallResult> {
    const recentN = query.recentN ?? RECALL_DEFAULTS.recentN;
    const k = query.k ?? RECALL_DEFAULTS.k;

    // ── Step 1: Cortex.recent — UNCONDITIONAL, synchronous ───────────────────
    // This always succeeds.  The recent slice is populated regardless of whether
    // the embedding stack is available.
    const recent: readonly MemoryNote[] = this.cortex.recent(recentN);

    // ── Steps 2 + 3: Embed then Hippocampus recall ───────────────────────────
    // Both are wrapped so any failure returns recalled:[] with recent intact.
    let recalled: readonly MemoryNote[] = [];

    try {
      const queryVector = await this.embedder.embed(query.text);

      try {
        const raw = await this.hippocampus.recall(
          queryVector,
          k,
          query.sessionKey !== undefined ? { sessionKey: query.sessionKey } : undefined,
        );

        // ── Step 4: Deduplicate — remove notes already in the recent slice ───
        const recentIds = new Set(recent.map((n) => n.id));
        recalled = raw.filter((n) => !recentIds.has(n.id));
      } catch {
        // Hippocampus failure — recalled stays []; recent is intact
      }
    } catch {
      // Embedder failure — skip Hippocampus entirely; recalled stays []
    }

    return { recent, recalled };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createMemoryRecallPipeline(params: {
  cortex: Cortex;
  embedder: Embedder;
  hippocampus: Hippocampus;
}): DefaultMemoryRecallPipeline {
  return new DefaultMemoryRecallPipeline(params.cortex, params.embedder, params.hippocampus);
}
