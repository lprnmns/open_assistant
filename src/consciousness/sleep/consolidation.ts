/**
 * src/consciousness/sleep/consolidation.ts — Sleep-phase consolidation pipeline
 *
 * Converts episodic notes into semantic notes during the Sleep Phase.
 * Called ONLY when evaluateConsolidationTrigger() returns shouldConsolidate:true
 * — never by the Watchdog or the tick-level trigger evaluation.
 *
 * ── Four guardrails ────────────────────────────────────────────────────────────
 *
 *   1. Fail-soft
 *      run() NEVER throws or rejects.  Individual note failures increment the
 *      `failed` counter and are logged; the rest of the batch continues.
 *      listByType() failures return an empty result (zero counts).
 *
 *   2. Idempotency — no duplicate conversions
 *      Each semantic note produced here carries a source marker on its first
 *      line: "[source:<episodicNoteId>]".  Before the batch loop, run() fetches
 *      all existing semantic notes and builds a Set of already-consolidated IDs.
 *      Notes whose ID is in that set are skipped (increment `skipped`).
 *      This survives process restarts because the marker is stored in the DB.
 *
 *   3. Append-only — episodic source is never touched
 *      The pipeline only calls hippocampus.ingest() with NEW semantic notes.
 *      Episodic notes are read but never updated, deleted, or re-ingested.
 *      The semantic note is a brand-new MemoryNote with a fresh id and
 *      type: "semantic"; the source episodic note is referenced only by the
 *      marker in the content.
 *
 *   4. LLM cost from consolidation run only
 *      extractFacts() (the LLM call) is invoked exclusively inside run().
 *      The trigger evaluation (evaluateConsolidationTrigger) is a pure $0
 *      function that never calls extractFacts.  There is no LLM cost from
 *      scheduling, snapshot building, or watchdog checks.
 *
 * ── Source-marker format ───────────────────────────────────────────────────────
 *
 *   Semantic note content:
 *     "[source:<episodicNoteId>]\n<extracted semantic facts>"
 *
 *   The marker is on the first line; everything after the newline is the
 *   LLM-extracted content.  parseSourceId() reads only the first line so
 *   multi-line semantic content is preserved intact.
 *
 * ── Batch size ────────────────────────────────────────────────────────────────
 *
 *   CONSOLIDATION_DEFAULTS.batchSize (20) limits how many episodic notes are
 *   processed per run.  This bounds LLM cost per consolidation pass.
 *   Callers may override via ConsolidationInput.batchSize.
 */

import { makeMemoryNote, type Embedder, type Hippocampus } from "../brain/types.js";

// ── Defaults ──────────────────────────────────────────────────────────────────

export const CONSOLIDATION_DEFAULTS = {
  /** Maximum episodic notes processed per consolidation run. */
  batchSize: 20,
} as const;

// ── Source marker helpers ──────────────────────────────────────────────────────

const SOURCE_MARKER_PREFIX = "[source:";

/** Build the source-marker line that prefixes every semantic note's content. */
export function buildSemanticContent(sourceId: string, extractedFacts: string): string {
  return `${SOURCE_MARKER_PREFIX}${sourceId}]\n${extractedFacts.trim()}`;
}

/**
 * Extract the source episodic note ID from a semantic note's content.
 * Returns undefined when the content does not carry a valid source marker.
 */
export function parseSourceId(content: string): string | undefined {
  if (!content.startsWith(SOURCE_MARKER_PREFIX)) return undefined;
  const end = content.indexOf("]");
  if (end === -1) return undefined;
  const id = content.slice(SOURCE_MARKER_PREFIX.length, end);
  return id.length > 0 ? id : undefined;
}

// ── Pipeline types ─────────────────────────────────────────────────────────────

export type ConsolidationInput = {
  /** Session whose episodic notes are consolidated. */
  sessionKey: string;
  /**
   * Maximum episodic notes to process this run.
   * Defaults to CONSOLIDATION_DEFAULTS.batchSize.
   */
  batchSize?: number;
};

export type ConsolidationResult = {
  /** Episodic notes examined this run (≤ batchSize). */
  processed: number;
  /** New semantic notes successfully written. */
  converted: number;
  /**
   * Episodic notes skipped due to in-run duplicate detection.
   * Cross-run idempotency is handled by pre-loop filtering (already-consolidated
   * notes never enter the loop), so this counter is non-zero only when the same
   * note id appears more than once in the fetched episodic list.
   */
  skipped: number;
  /** Individual note failures that were swallowed (fail-soft). */
  failed: number;
};

export interface ConsolidationPipeline {
  run(input: ConsolidationInput): Promise<ConsolidationResult>;
}

// ── DefaultConsolidationPipeline ──────────────────────────────────────────────

export class DefaultConsolidationPipeline implements ConsolidationPipeline {
  constructor(
    private readonly hippocampus: Hippocampus,
    private readonly embedder: Embedder,
    /**
     * Injectable LLM call: given episodic note content, return extracted
     * semantic facts as a string.  Returning an empty string is valid (no
     * durable facts in this note); the pipeline will skip writing in that case.
     *
     * Inject a real proxyCall wrapper at boot; inject a deterministic stub in
     * tests.  The pipeline does NOT import proxyCall directly so test cost is $0.
     */
    private readonly extractFacts: (content: string) => Promise<string>,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async run(input: ConsolidationInput): Promise<ConsolidationResult> {
    const result: ConsolidationResult = { processed: 0, converted: 0, skipped: 0, failed: 0 };

    try {
      const batchSize = input.batchSize ?? CONSOLIDATION_DEFAULTS.batchSize;
      const { sessionKey } = input;

      // ── Step 1: Build already-consolidated set from existing semantic notes ────
      // Idempotency guard — cross-restart safe because the marker is in the DB.
      // Must run BEFORE fetching episodic notes so the batchSize limit applies
      // only to unconsolidated candidates (prevents backlog starvation).
      const semanticNotes = await this.hippocampus.listByType("semantic", { sessionKey });
      const consolidatedIds = new Set<string>();
      for (const note of semanticNotes) {
        const sourceId = parseSourceId(note.content);
        if (sourceId) consolidatedIds.add(sourceId);
      }

      // ── Step 2: Fetch unconsolidated episodic notes (oldest-first, bounded) ──
      // Fetch ALL episodic notes for the session (no limit), filter to those not
      // yet consolidated, then cap at batchSize.  This ensures the limit applies
      // to unconsolidated candidates only — not to the total pool — so a large
      // block of already-processed older notes cannot starve newer unconsolidated
      // ones.
      const allEpisodic = await this.hippocampus.listByType("episodic", { sessionKey });
      const episodicNotes = allEpisodic
        .filter((n) => !consolidatedIds.has(n.id))
        .slice(0, batchSize);

      if (episodicNotes.length === 0) return result;

      // ── Step 3: Process each episodic note ────────────────────────────────────
      for (const episodic of episodicNotes) {
        result.processed++;

        if (consolidatedIds.has(episodic.id)) {
          result.skipped++;
          continue;
        }

        try {
          // LLM call — cost accrues HERE, inside run(), not in trigger evaluation.
          const extracted = await this.extractFacts(episodic.content);

          if (!extracted.trim()) {
            // No durable facts extracted — skip write, but count as processed.
            continue;
          }

          const content = buildSemanticContent(episodic.id, extracted);
          const semanticNote = makeMemoryNote({
            content,
            type: "semantic",
            sessionKey,
          });

          const vector = await this.embedder.embed(content);
          await this.hippocampus.ingest(semanticNote, vector);

          // In-memory tracking so the same note is not re-processed within this run.
          consolidatedIds.add(episodic.id);
          result.converted++;
        } catch (err) {
          this.log(
            `consolidation: failed to process episodic note [${episodic.id}]: ${String(err)}`,
          );
          result.failed++;
        }
      }
    } catch (outer) {
      // Outer guard — e.g. listByType threw despite the interface contract.
      this.log(`consolidation: unexpected error in run(): ${String(outer)}`);
      // result remains at whatever partial state it reached.
    }

    return result;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createConsolidationPipeline(params: {
  hippocampus: Hippocampus;
  embedder: Embedder;
  extractFacts: (content: string) => Promise<string>;
  log?: (msg: string) => void;
}): DefaultConsolidationPipeline {
  return new DefaultConsolidationPipeline(
    params.hippocampus,
    params.embedder,
    params.extractFacts,
    params.log,
  );
}
