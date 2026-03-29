/**
 * src/consciousness/brain/hippocampus.ts — Durable vector store (Hippocampus)
 *
 * SqliteHippocampus implements the Hippocampus interface using:
 *   - node:sqlite  (DatabaseSync) for structured note metadata
 *   - sqlite-vec   extension for ANN vector search via vec0 virtual tables
 *
 * ── Storage ───────────────────────────────────────────────────────────────────
 *
 *   Database file: the path provided to the constructor (caller owns the path;
 *   canonical value is consciousness.db, separate from workspace memory.db).
 *
 *   consciousness_notes     — note metadata (id, content, type,
 *                             session_key, created_at)
 *   consciousness_notes_vec — vec0 virtual table: id + FLOAT[dims] embedding
 *
 * ── Distance metric ───────────────────────────────────────────────────────────
 *
 *   vec_distance_cosine on L2-normalized vectors.
 *   All vectors are normalized via sanitizeAndNormalizeEmbedding() before
 *   storage.  For unit vectors, cosine distance ≡ L2 distance (same ranking),
 *   consistent with the existing workspace memory manager (manager-search.ts).
 *
 * ── Schema lifecycle ──────────────────────────────────────────────────────────
 *
 *   notes table: created synchronously on first open (openDb()).
 *   vec table:   created lazily on first ingest once dims is known.
 *                Dimension mismatch (model change) drops and recreates the vec
 *                table; existing notes remain in the notes table but become
 *                invisible to recall until the caller re-ingests them.
 *
 * ── Fail-soft guarantees (Hippocampus contract) ───────────────────────────────
 *
 *   ingest():  note row is ALWAYS written to the notes table.
 *              vec row is written only when the extension is available and dims
 *              match.  All errors are passed to the optional logger and swallowed.
 *   recall():  returns [] on any error (closed db, missing extension, dim
 *              mismatch, SQL error).  Never throws.
 *   close():   idempotent, never throws.
 *
 * ── Cortex isolation ──────────────────────────────────────────────────────────
 *
 *   No import of, reference to, or dependency on InMemoryCortex or any
 *   in-RAM buffer.  This module owns only the SQLite layer.
 */

import type { DatabaseSync } from "node:sqlite";
import { sanitizeAndNormalizeEmbedding } from "../../memory/embedding-vectors.js";
import { loadSqliteVecExtension } from "../../memory/sqlite-vec.js";
import { requireNodeSqlite } from "../../memory/sqlite.js";
import type { Hippocampus, MemoryNote } from "./types.js";

// ── Internal constants ────────────────────────────────────────────────────────

/** Metadata table — separate namespace avoids collision with workspace tables. */
const NOTES_TABLE = "consciousness_notes";
/** sqlite-vec virtual table for ANN search. */
const VEC_TABLE = "consciousness_notes_vec";

// ── Serialization ─────────────────────────────────────────────────────────────

/** Pack a float array into the binary blob format sqlite-vec expects. */
function vectorToBlob(vec: readonly number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

// ── SqliteHippocampus ─────────────────────────────────────────────────────────

export class SqliteHippocampus implements Hippocampus {
  private db: DatabaseSync | null = null;
  /** Embedding dimensionality currently indexed in the vec table. null = no vec table yet. */
  private dims: number | null = null;
  /** True once the sqlite-vec extension has been successfully loaded into this.db. */
  private vecLoaded = false;

  /**
   * @param dbPath   Absolute path to the SQLite file (use ":memory:" for tests).
   * @param log      Optional error logger; defaults to console.warn.
   *                 Injectable to keep the module free of hard logger imports.
   */
  constructor(
    private readonly dbPath: string,
    private readonly log: (msg: string) => void = (msg) => console.warn(msg),
  ) {}

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Open the database and ensure the notes metadata table exists. */
  private openDb(): DatabaseSync {
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(this.dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${NOTES_TABLE} (
        id          TEXT    PRIMARY KEY,
        content     TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        session_key TEXT    NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_consciousness_notes_session
        ON ${NOTES_TABLE}(session_key);
    `);
    return db;
  }

  /**
   * Load the sqlite-vec extension and ensure the vec virtual table exists for
   * the given number of dimensions.
   *
   * Returns true when the vec table is ready for reads/writes.
   * Returns false when the extension is unavailable — caller falls back to
   * metadata-only storage (notes written but not vector-searchable).
   *
   * Dimension change: drops the old vec table and recreates it.  Notes already
   * in the notes table without matching vec rows are invisible to recall.
   */
  private async ensureVec(dims: number): Promise<boolean> {
    if (!this.db) return false;

    // Dimension mismatch — drop stale vec table, reset state.
    if (this.dims !== null && this.dims !== dims) {
      try {
        this.db.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`);
      } catch (err) {
        this.log(`consciousness hippocampus: failed to drop stale vec table: ${String(err)}`);
      }
      this.dims = null;
      this.vecLoaded = false;
    }

    // Already ready for this dimension.
    if (this.vecLoaded && this.dims === dims) return true;

    // Load extension (dynamic import is async; actual load is sync).
    if (!this.vecLoaded) {
      const result = await loadSqliteVecExtension({ db: this.db });
      if (!result.ok) {
        this.log(`consciousness hippocampus: sqlite-vec unavailable — ${result.error ?? "unknown error"}`);
        return false;
      }
      this.vecLoaded = true;
    }

    // Create vec virtual table with the given dimensionality.
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(\n` +
        `  id        TEXT PRIMARY KEY,\n` +
        `  embedding FLOAT[${dims}]\n` +
        `)`,
    );
    this.dims = dims;
    return true;
  }

  // ── Hippocampus interface ───────────────────────────────────────────────────

  /**
   * Persist a note and its embedding.
   *
   * The metadata row is ALWAYS written — even when the vec extension is absent.
   * The vec row is written only when the extension is loaded and dims match.
   * Any error is logged and swallowed; the loop is never interrupted.
   */
  async ingest(note: MemoryNote, vector: readonly number[]): Promise<void> {
    try {
      if (!this.db) {
        this.db = this.openDb();
      }

      // Normalize before storage so cosine ≡ L2 at query time.
      const normalized = sanitizeAndNormalizeEmbedding([...vector]);

      // --- Metadata (always) ---
      this.db
        .prepare(
          `INSERT OR REPLACE INTO ${NOTES_TABLE} (id, content, type, session_key, created_at)\n` +
            `VALUES (?, ?, ?, ?, ?)`,
        )
        .run(note.id, note.content, note.type, note.sessionKey, note.createdAt);

      // --- Vector (when extension available) ---
      const vecReady = await this.ensureVec(normalized.length);
      if (vecReady) {
        this.db
          .prepare(`INSERT OR REPLACE INTO ${VEC_TABLE} (id, embedding) VALUES (?, ?)`)
          .run(note.id, vectorToBlob(normalized));
      }
    } catch (err) {
      this.log(`consciousness hippocampus ingest failed [${note.id}]: ${String(err)}`);
    }
  }

  /**
   * Return the k most semantically similar notes to queryVector.
   *
   * Uses vec_distance_cosine on L2-normalized vectors; results are
   * ordered closest-first (lowest cosine distance = highest similarity).
   *
   * Returns [] when the store is empty, the extension is unavailable,
   * dims mismatch, or any SQL error occurs.  Never throws.
   */
  async recall(
    queryVector: readonly number[],
    k: number,
    filter?: { sessionKey?: string },
  ): Promise<readonly MemoryNote[]> {
    try {
      if (!this.db || !this.vecLoaded || this.dims === null) return [];
      if (k <= 0) return [];
      if (queryVector.length !== this.dims) return [];

      const normalized = sanitizeAndNormalizeEmbedding([...queryVector]);
      const blob = vectorToBlob(normalized);
      const sessionKey = filter?.sessionKey?.trim() || undefined;

      const sql =
        `SELECT n.id, n.content, n.type, n.session_key, n.created_at\n` +
        `  FROM ${VEC_TABLE} v\n` +
        `  JOIN ${NOTES_TABLE} n ON n.id = v.id\n` +
        (sessionKey ? `  WHERE n.session_key = ?\n` : ``) +
        `  ORDER BY vec_distance_cosine(v.embedding, ?) ASC\n` +
        `  LIMIT ?`;

      const params: unknown[] = sessionKey ? [sessionKey, blob, k] : [blob, k];

      const rows = this.db.prepare(sql).all(...params) as Array<{
        id: string;
        content: string;
        type: string;
        session_key: string;
        created_at: number;
      }>;

      return rows.map((row) => ({
        id: row.id,
        content: row.content,
        type: row.type as MemoryNote["type"],
        sessionKey: row.session_key,
        createdAt: row.created_at,
      }));
    } catch {
      return [];
    }
  }

  /** Release the SQLite connection. Idempotent, never throws. */
  async close(): Promise<void> {
    try {
      this.db?.close();
    } catch {}
    this.db = null;
    this.dims = null;
    this.vecLoaded = false;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a Hippocampus backed by the given database file.
 * Pass ":memory:" for test isolation (in-memory, discarded on close).
 */
export function createHippocampus(
  dbPath: string,
  log?: (msg: string) => void,
): SqliteHippocampus {
  return new SqliteHippocampus(dbPath, log);
}
