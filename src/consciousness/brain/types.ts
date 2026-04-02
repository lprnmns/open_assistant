import type { TemporalRange } from "./temporal-resolver.js";

/**
 * src/consciousness/brain/types.ts — Living Brain memory contracts
 *
 * Defines the full write/read contract for the agent's own episodic and
 * semantic memory.  No implementation lives here — only types, interfaces,
 * constants, and one factory helper.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 *
 *   WRITE PATH (TAKE_NOTE decision from the loop)
 *   ─────────────────────────────────────────────
 *   TickDecision { action: "TAKE_NOTE", noteContent }
 *     → DispatchContext.appendNote(content)           ← existing contract,
 *         │                                              unchanged externally;
 *         │                                              boot layer closes over
 *         │                                              sessionKey when wiring
 *         ▼
 *     NoteIngestionPipeline.ingest({ content, sessionKey })
 *         ├── makeMemoryNote(...)              → id + timestamp assigned once
 *         ├── Cortex.stage(note)               ← FIRST — RAM-only, never throws
 *         │                                       note is safe even if embed fails
 *         ├── Embedder.embed(content)          → dense vector (failure stops here)
 *         └── Hippocampus.ingest(note, vector) ← async, SQLite-vec, durable
 *                                                 errors caught: loop is immune
 *
 *   READ PATH (tick prompt builder, before each LLM call)
 *   ─────────────────────────────────────────────────────
 *   MemoryRecallPipeline.recall({ text, k, recentN, sessionKey })
 *         ├── Cortex.recent(recentN)             → recent: MemoryNote[] (UNCONDITIONAL)
 *         ├── Embedder.embed(text) → queryVector  (failure: recalled = [], recent kept)
 *         └── Hippocampus.recall(queryVector, k) → recalled: MemoryNote[]
 *         → MemoryRecallResult { recent, recalled }
 *           (pipeline deduplicates: notes in recent are omitted from recalled)
 *
 * ── Episodic vs Semantic ──────────────────────────────────────────────────────
 *
 *   "episodic"  Timestamped events — what the agent observed or decided.
 *               Written once, never mutated.  Queried by recency + similarity.
 *               Example: "User asked about the project deadline at 14:32."
 *               Default for all TAKE_NOTE decisions from the loop.
 *
 *   "semantic"  Extracted facts — what the agent believes to be true.
 *               Intended to be upsertable by content fingerprint (future pass).
 *               Queried by similarity only.
 *               Example: "User prefers concise answers without preamble."
 *               Reserved for offline Sleep-Phase consolidation (Sub-Task 5.x).
 *
 * ── Storage boundary ─────────────────────────────────────────────────────────
 *
 *   Cortex      Zero disk I/O.  Circular buffer in RAM.  Bounded by capacity
 *               set at construction.  Cleared at shutdown; not reconstructed
 *               from disk (recent context only needs the current session).
 *
 *   Hippocampus All SQLite-vec I/O.  Separate database file (consciousness.db)
 *               from the workspace file index (memory.db).  Cortex never reads
 *               from or writes to Hippocampus.  Embedder is injected; neither
 *               layer owns it.
 */

// ── Note types ────────────────────────────────────────────────────────────────

export type NoteType = "episodic" | "semantic";

/**
 * All valid NoteType values as a readonly tuple.
 * Use for exhaustive switch/mapping without importing the union directly.
 */
export const NOTE_TYPES: readonly NoteType[] = ["episodic", "semantic"] as const;

// ── Core note record ──────────────────────────────────────────────────────────

/**
 * A single memory note — the unit of both ingestion and recall.
 * Immutable: id, createdAt, and sessionKey are fixed at creation time.
 */
export type MemoryNote = {
  /** UUID v4 assigned at ingest time.  Never reassigned or recycled. */
  readonly id: string;
  /** Raw text content as written by the loop. */
  readonly content: string;
  /** Episodic (event) or Semantic (fact). */
  readonly type: NoteType;
  /** Unix ms when this note was ingested. */
  readonly createdAt: number;
  /** Session that produced this note; used for session-scoped recall. */
  readonly sessionKey: string;
};

/**
 * Factory for MemoryNote.
 * Callers supply content + type + sessionKey; id and createdAt are generated.
 * Using a factory (not inline object literals) keeps id/timestamp logic in one
 * place and makes tests deterministic via injectable overrides.
 */
export function makeMemoryNote(params: {
  content: string;
  type?: NoteType;
  sessionKey: string;
  /** Override for tests; defaults to Date.now(). */
  createdAt?: number;
  /** Override for tests; defaults to crypto.randomUUID(). */
  id?: string;
}): MemoryNote {
  return {
    id: params.id ?? crypto.randomUUID(),
    content: params.content,
    type: params.type ?? "episodic",
    createdAt: params.createdAt ?? Date.now(),
    sessionKey: params.sessionKey,
  };
}

// ── Type guards ───────────────────────────────────────────────────────────────

export function isEpisodic(note: MemoryNote): boolean {
  return note.type === "episodic";
}

export function isSemantic(note: MemoryNote): boolean {
  return note.type === "semantic";
}

// ── Recall result ─────────────────────────────────────────────────────────────

/**
 * Output of a recall query.  Two distinct slices let prompt builders place
 * them in different sections ("recent context" vs "related memories").
 */
export type MemoryRecallResult = {
  /**
   * Most recent notes from Cortex (newest-first).
   * Bounded by MemoryRecallQuery.recentN.
   */
  readonly recent: readonly MemoryNote[];
  /**
   * Semantically similar notes from Hippocampus (highest-similarity-first).
   * Bounded by MemoryRecallQuery.k.
   * Notes that already appear in `recent` are excluded (deduplicated by id).
   */
  readonly recalled: readonly MemoryNote[];
  /**
   * Optional recall warning when a temporal filter matched the query but the
   * filtered candidate set was empty. Callers can surface this instead of
   * silently falling back to unrelated older memories.
   */
  readonly warning?: string;
};

/**
 * Optional createdAt filter applied before recency/vector ranking.
 * `startTime` is inclusive, `endTime` is exclusive.
 */
export type MemoryTimeFilter = {
  startTime?: number;
  endTime?: number;
};

// ── Embedder ──────────────────────────────────────────────────────────────────

/**
 * Injectable text embedder.
 * Neither Cortex nor Hippocampus owns this — only pipeline implementations do.
 * Wrap src/memory/embeddings.ts or any provider behind this interface.
 */
export interface Embedder {
  /** Produce a dense float32 vector for the given text. */
  embed(text: string): Promise<readonly number[]>;
}

// ── Cortex ────────────────────────────────────────────────────────────────────

/**
 * In-RAM short-term memory buffer.
 *
 * Invariants:
 *   - No I/O, no async operations.  stage() is synchronous and O(1).
 *   - recent(n) returns notes ordered newest-first, at most n items.
 *   - Capacity ceiling is set at construction time; oldest notes are evicted
 *     when the buffer is full (circular / sliding window).
 *   - clear() is for shutdown and testing; the loop does not call it during
 *     normal operation.
 *   - Single-process, single-loop assumed — no locking needed.
 */
export interface Cortex {
  /** Append a note to the buffer.  O(1), synchronous, never throws. */
  stage(note: MemoryNote): void;
  /**
   * Return the n most recently staged notes, ordered newest-first.
   * Returns all staged notes when fewer than n are available.
   */
  recent(n: number): readonly MemoryNote[];
  /**
   * Return the n most recent notes that also satisfy the optional createdAt
   * range filter. The result remains newest-first.
   */
  recent(n: number, filter?: MemoryTimeFilter): readonly MemoryNote[];
  /** Drain the buffer entirely.  Used at shutdown or in tests. */
  clear(): void;
}

// ── Hippocampus ───────────────────────────────────────────────────────────────

/**
 * Durable long-term memory store backed by SQLite-vec.
 *
 * Storage target: a dedicated SQLite database file (consciousness.db) that is
 * separate from the workspace file-chunk index (memory.db).  This keeps the
 * agent's own memories isolated from workspace content search.
 *
 * Invariants:
 *   - ingest() is the only write path.  Notes are immutable after ingestion.
 *   - recall() NEVER throws to the caller; implementations catch SQLite errors
 *     and return [] on failure.
 *   - All vectors passed to a single Hippocampus instance must share the same
 *     dimensionality (determined by the Embedder model at boot).
 *   - sessionKey filtering in recall() is optional; omit to search all sessions.
 */
export interface Hippocampus {
  /**
   * Write a note and its embedding vector to the store.
   * vector must have the same dimensionality as all previously ingested vectors.
   */
  ingest(note: MemoryNote, vector: readonly number[]): Promise<void>;
  /**
   * Return the k most semantically similar notes to queryVector.
   * Optionally restrict the search to a specific sessionKey.
   * Returns [] when the store is empty or on any internal error.
   */
  recall(
    queryVector: readonly number[],
    k: number,
    filter?: { sessionKey?: string; startTime?: number; endTime?: number },
  ): Promise<readonly MemoryNote[]>;
  /** Release the SQLite connection.  Called at graceful shutdown. */
  close(): Promise<void>;
}

// ── Ingestion pipeline ────────────────────────────────────────────────────────

/** Raw input from the loop after a TAKE_NOTE decision. */
export type NoteIngestionInput = {
  /** Note text from TickDecision.noteContent. */
  content: string;
  /**
   * Note type.  Omit to default to "episodic".
   * The loop always emits episodic notes.  Semantic notes are produced by
   * future Sleep-Phase consolidation passes (Sub-Task 5.x).
   */
  type?: NoteType;
  /**
   * Session that triggered this note.
   * The boot layer closes over this when constructing DispatchContext.appendNote,
   * so the loop itself never needs to pass it explicitly.
   */
  sessionKey: string;
};

/**
 * Orchestrates the full write path.
 *
 * Step order (guaranteed):
 *   1. makeMemoryNote({ content, type, sessionKey })  → id + createdAt assigned
 *   2. Cortex.stage(note)                             → synchronous, in-RAM, FIRST
 *   3. Embedder.embed(content)                        → vector
 *                                                        ↑ failure stops here;
 *                                                          note is already in Cortex
 *   4. Hippocampus.ingest(note, vector)               → async, durable
 *
 * Cortex.stage runs before Embedder.embed so that short-term memory is
 * populated regardless of embedding availability.  A flaky embedding API or
 * a missing model must not prevent the note from appearing in Cortex.recent().
 *
 * NEVER throws — TAKE_NOTE errors must not drop the consciousness loop.
 * Embedder and Hippocampus errors are caught and logged; Cortex.stage errors
 * (extremely unlikely for a RAM write) are also swallowed.
 */
export interface NoteIngestionPipeline {
  ingest(input: NoteIngestionInput): Promise<void>;
}

// ── Recall pipeline ───────────────────────────────────────────────────────────

/** Parameters for a tick-time memory recall. */
export type MemoryRecallQuery = {
  /**
   * Query text to embed.
   * Typically the WatchdogResult.context string so the recall is anchored
   * to the reason the loop woke up this tick.
   */
  text: string;
  /** Notes to retrieve from Hippocampus. Defaults to RECALL_DEFAULTS.k. */
  k?: number;
  /** Recent notes to pull from Cortex. Defaults to RECALL_DEFAULTS.recentN. */
  recentN?: number;
  /** When set, restricts Hippocampus recall to this session only. */
  sessionKey?: string;
  /**
   * Optional pre-resolved temporal range. When omitted, the recall pipeline may
   * derive one from the query text via the temporal resolver.
   */
  temporalRange?: TemporalRange;
};

/** Default values for optional MemoryRecallQuery fields. */
export const RECALL_DEFAULTS = {
  k: 5,
  recentN: 3,
} as const;

/**
 * Orchestrates the full read path for prompt enrichment.
 *
 * Step order (guaranteed):
 *   1. Cortex.recent(recentN)     → recent notes (synchronous, NO embedding needed)
 *                                    ↑ always succeeds; independent of Embedder
 *   2. Embedder.embed(query.text) → queryVector
 *                                    ↑ failure: skip step 3; recalled = []
 *                                      recent slice is UNAFFECTED
 *   3. Hippocampus.recall(...)    → recalled notes (async, ANN search)
 *                                    ↑ only reached when embed succeeded
 *   4. Deduplicate: notes whose id appears in recent are removed from recalled
 *   5. Return MemoryRecallResult { recent, recalled }
 *
 * Failure modes:
 *   Hippocampus error → recalled: []; recent is unaffected.
 *   Embedder error    → recalled: []; recent is unaffected.
 *
 * Cortex.recent() is unconditional: the caller always receives at least the
 * in-RAM recent slice even when the entire embedding/ANN stack is unavailable.
 */
export interface MemoryRecallPipeline {
  recall(query: MemoryRecallQuery): Promise<MemoryRecallResult>;
}
