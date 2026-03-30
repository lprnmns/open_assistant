/**
 * src/consciousness/brain/ingestion.ts — NoteIngestionPipeline implementation
 *
 * Orchestrates the TAKE_NOTE write path:
 *
 *   Step 1  makeMemoryNote()      assign id + createdAt (deterministic factory)
 *   Step 2  Cortex.stage(note)    in-RAM, synchronous — ALWAYS before embed
 *   Step 3  Embedder.embed()      async; failure stops the durable path
 *                                 note is already in Cortex regardless
 *   Step 4  Hippocampus.ingest()  async, durable; failure logged + swallowed
 *                                 Cortex is already populated
 *
 * Invariants enforced here:
 *   - Cortex.stage runs before Embedder.embed.  No exception.
 *   - ingest() NEVER throws or rejects.  All errors are caught, logged via the
 *     injectable logger, and swallowed at the appropriate step boundary.
 *   - If Embedder fails, Hippocampus is not called (no vector to store).
 *     The note remains in short-term memory (Cortex).
 *   - If Hippocampus fails, the note remains in short-term memory (Cortex).
 *   - If Cortex.stage fails (extremely unlikely for a RAM write), the error is
 *     logged; embed + Hippocampus are still attempted so the note is at least
 *     durably stored.
 *   - Unexpected errors (e.g. makeMemoryNote crash) are caught by an outer
 *     guard and logged; the pipeline always returns normally.
 */

import {
  makeMemoryNote,
  type Cortex,
  type Embedder,
  type Hippocampus,
  type NoteIngestionInput,
  type NoteIngestionPipeline,
} from "./types.js";

// ── DefaultNoteIngestionPipeline ──────────────────────────────────────────────

export class DefaultNoteIngestionPipeline implements NoteIngestionPipeline {
  constructor(
    private readonly cortex: Cortex,
    private readonly embedder: Embedder,
    private readonly hippocampus: Hippocampus,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /**
   * Fire-and-forget wrapper around the injected logger.
   * A throwing logger must NEVER propagate into the ingest() control flow —
   * logging is observability, not a pipeline step.
   */
  private safeLog(message: string): void {
    try {
      this.log(message);
    } catch {
      // Intentionally swallowed: logging must not affect pipeline behaviour.
    }
  }

  async ingest(input: NoteIngestionInput): Promise<void> {
    try {
      // ── Step 1: create the note record ──────────────────────────────────────
      const note = makeMemoryNote({
        content: input.content,
        type: input.type,          // defaults to "episodic" inside makeMemoryNote
        sessionKey: input.sessionKey,
      });

      // ── Step 2: Cortex.stage — FIRST, synchronous, before any async work ────
      // Cortex.stage() is designed to never throw (RAM buffer), but we guard it
      // so that a hypothetical bug there never silently prevents Hippocampus.
      try {
        this.cortex.stage(note);
      } catch (stageErr) {
        this.safeLog(
          `ingestion: Cortex.stage failed (note may be absent from short-term memory): ${String(stageErr)}`,
        );
        // Proceed — Hippocampus may still persist the note durably.
      }

      // ── Step 3: Embedder.embed — failure stops the durable path ─────────────
      // Cortex already has the note; returning here is safe.
      let vector: readonly number[];
      try {
        vector = await this.embedder.embed(note.content);
      } catch (embedErr) {
        this.safeLog(
          `ingestion: Embedder.embed failed — note staged in Cortex only: ${String(embedErr)}`,
        );
        return; // short-term memory secured; durable path skipped
      }

      // ── Step 4: Hippocampus.ingest — failure logged; Cortex intact ──────────
      try {
        await this.hippocampus.ingest(note, vector);
      } catch (hippoErr) {
        this.safeLog(
          `ingestion: Hippocampus.ingest failed — note staged in Cortex only: ${String(hippoErr)}`,
        );
        // Acceptable degraded state: short-term memory is intact.
      }
    } catch (unexpected) {
      // Belt-and-suspenders: makeMemoryNote or other unforeseen failures.
      this.log(`ingestion: unexpected error: ${String(unexpected)}`);
      // Never re-throw.
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createNoteIngestionPipeline(params: {
  cortex: Cortex;
  embedder: Embedder;
  hippocampus: Hippocampus;
  log?: (msg: string) => void;
}): DefaultNoteIngestionPipeline {
  return new DefaultNoteIngestionPipeline(
    params.cortex,
    params.embedder,
    params.hippocampus,
    params.log,
  );
}
