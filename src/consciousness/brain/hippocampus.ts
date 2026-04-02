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
 *   consciousness_meta      — key/value pairs; persists dims across restarts
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
 *   Both ingest() and recall() call ensureReady() which opens the DB on demand
 *   and restores dims + vec state from consciousness_meta on every cold open.
 *   This means a new SqliteHippocampus instance pointing to an existing file
 *   can immediately recall() notes ingested by a previous process.
 *
 *   vec table:  created lazily on first ingest once dims is known; dims value
 *               is persisted to consciousness_meta immediately after creation.
 *   Dimension mismatch (model change): drops and recreates vec table; meta is
 *   updated with the new dims; existing notes stay in notes table but become
 *   invisible to recall until re-ingested.
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

const NOTES_TABLE = "consciousness_notes";
const VEC_TABLE = "consciousness_notes_vec";
/** Persists dims (and any future config) across process restarts. */
const META_TABLE = "consciousness_meta";
/** Meta key under which the embedding dimensionality is stored. */
const META_DIMS_KEY = "dims";
type SqlParam = string | number | Buffer;

// ── Serialization ─────────────────────────────────────────────────────────────

function vectorToBlob(vec: readonly number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

// ── SqliteHippocampus ─────────────────────────────────────────────────────────

export class SqliteHippocampus implements Hippocampus {
  private db: DatabaseSync | null = null;
  private dims: number | null = null;
  private vecLoaded = false;

  /**
   * @param dbPath  Absolute path to the SQLite file (use ":memory:" for tests).
   * @param log     Optional error logger; injectable to avoid hard logger imports.
   */
  constructor(
    private readonly dbPath: string,
    private readonly log: (msg: string) => void = (msg) => console.warn(msg),
  ) {}

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Open the DB (if not already open), create base tables, and restore
   * vec state from consciousness_meta so recall() works after a process restart.
   *
   * Returns the open DatabaseSync, or null when node:sqlite is unavailable.
   * All errors are logged and swallowed.
   */
  private async ensureReady(): Promise<DatabaseSync | null> {
    if (this.db) return this.db;

    try {
      const { DatabaseSync } = requireNodeSqlite();
      const db = new DatabaseSync(this.dbPath);

      // Create base tables unconditionally on every cold open.
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
        CREATE TABLE IF NOT EXISTS ${META_TABLE} (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      this.db = db;

      // Restore dims + vec state from meta (set by a previous process/instance).
      const metaRow = db
        .prepare(`SELECT value FROM ${META_TABLE} WHERE key = ?`)
        .get(META_DIMS_KEY) as { value: string } | undefined;

      if (metaRow) {
        const storedDims = parseInt(metaRow.value, 10);
        if (Number.isInteger(storedDims) && storedDims > 0) {
          // Try to load the vec extension and confirm the vec table exists.
          const result = await loadSqliteVecExtension({ db });
          if (result.ok) {
            const tableRow = db
              .prepare(
                `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
              )
              .get(VEC_TABLE) as { name: string } | undefined;

            if (tableRow) {
              this.vecLoaded = true;
              this.dims = storedDims;
            }
          }
        }
      }

      return db;
    } catch (err) {
      this.log(`consciousness hippocampus: failed to open db: ${String(err)}`);
      return null;
    }
  }

  /**
   * Ensure the vec virtual table exists for the given dimensionality.
   * Persists dims to consciousness_meta so future instances can restore state.
   * Returns true when the vec table is ready; false when the extension is absent.
   */
  private async ensureVec(db: DatabaseSync, dims: number): Promise<boolean> {
    // Dimension mismatch — drop stale vec table and clear persisted dims.
    if (this.dims !== null && this.dims !== dims) {
      try {
        db.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`);
        db.prepare(`DELETE FROM ${META_TABLE} WHERE key = ?`).run(META_DIMS_KEY);
      } catch (err) {
        this.log(`consciousness hippocampus: failed to drop stale vec table: ${String(err)}`);
      }
      this.dims = null;
      this.vecLoaded = false;
    }

    // Already ready.
    if (this.vecLoaded && this.dims === dims) return true;

    // Load extension.
    if (!this.vecLoaded) {
      const result = await loadSqliteVecExtension({ db });
      if (!result.ok) {
        this.log(
          `consciousness hippocampus: sqlite-vec unavailable — ${result.error ?? "unknown error"}`,
        );
        return false;
      }
      this.vecLoaded = true;
    }

    // Create vec table and persist dims.
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(\n` +
        `  id        TEXT PRIMARY KEY,\n` +
        `  embedding FLOAT[${dims}]\n` +
        `)`,
    );
    db
      .prepare(`INSERT OR REPLACE INTO ${META_TABLE} (key, value) VALUES (?, ?)`)
      .run(META_DIMS_KEY, String(dims));
    this.dims = dims;
    return true;
  }

  // ── Hippocampus interface ───────────────────────────────────────────────────

  async ingest(note: MemoryNote, vector: readonly number[]): Promise<void> {
    try {
      const db = await this.ensureReady();
      if (!db) return;

      const normalized = sanitizeAndNormalizeEmbedding([...vector]);

      // Metadata row — always written.
      db.prepare(
        `INSERT OR REPLACE INTO ${NOTES_TABLE} (id, content, type, session_key, created_at)\n` +
          `VALUES (?, ?, ?, ?, ?)`,
      ).run(note.id, note.content, note.type, note.sessionKey, note.createdAt);

      // Vec row — written when extension is available.
      const vecReady = await this.ensureVec(db, normalized.length);
      if (vecReady) {
        db.prepare(
          `INSERT OR REPLACE INTO ${VEC_TABLE} (id, embedding) VALUES (?, ?)`,
        ).run(note.id, vectorToBlob(normalized));
      }
    } catch (err) {
      this.log(`consciousness hippocampus ingest failed [${note.id}]: ${String(err)}`);
    }
  }

  async recall(
    queryVector: readonly number[],
    k: number,
    filter?: { sessionKey?: string; startTime?: number; endTime?: number },
  ): Promise<readonly MemoryNote[]> {
    try {
      // ensureReady() opens the DB and restores dims from meta if needed.
      const db = await this.ensureReady();
      if (!db || !this.vecLoaded || this.dims === null) return [];
      if (k <= 0) return [];
      if (queryVector.length !== this.dims) return [];

      const normalized = sanitizeAndNormalizeEmbedding([...queryVector]);
      const blob = vectorToBlob(normalized);
      const sessionKey = filter?.sessionKey?.trim() || undefined;
      const startTime = Number.isFinite(filter?.startTime) ? filter?.startTime : undefined;
      const endTime = Number.isFinite(filter?.endTime) ? filter?.endTime : undefined;

      const whereClauses: string[] = [];
      const params: SqlParam[] = [];
      if (sessionKey) {
        whereClauses.push(`n.session_key = ?`);
        params.push(sessionKey);
      }
      if (startTime !== undefined) {
        whereClauses.push(`n.created_at >= ?`);
        params.push(startTime);
      }
      if (endTime !== undefined) {
        whereClauses.push(`n.created_at < ?`);
        params.push(endTime);
      }

      const sql =
        `SELECT n.id, n.content, n.type, n.session_key, n.created_at\n` +
        `  FROM ${VEC_TABLE} v\n` +
        `  JOIN ${NOTES_TABLE} n ON n.id = v.id\n` +
        (whereClauses.length > 0 ? `  WHERE ${whereClauses.join(" AND ")}\n` : ``) +
        `  ORDER BY vec_distance_cosine(v.embedding, ?) ASC\n` +
        `  LIMIT ?`;

      params.push(blob, k);

      const rows = db.prepare(sql).all(...params) as Array<{
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

  async listByType(
    type: MemoryNote["type"],
    filter?: { sessionKey?: string; limit?: number },
  ): Promise<readonly MemoryNote[]> {
    try {
      const db = await this.ensureReady();
      if (!db) return [];

      const sessionKey = filter?.sessionKey?.trim() || undefined;
      const limit = filter?.limit;
      const applyLimit = limit !== undefined && Number.isInteger(limit) && limit > 0;

      const sql =
        `SELECT id, content, type, session_key, created_at FROM ${NOTES_TABLE}` +
        ` WHERE type = ?` +
        (sessionKey ? ` AND session_key = ?` : ``) +
        ` ORDER BY created_at ASC` +
        (applyLimit ? ` LIMIT ?` : ``);

      const params: SqlParam[] = [type];
      if (sessionKey) params.push(sessionKey);
      if (applyLimit) params.push(limit!);

      const rows = db.prepare(sql).all(...params) as Array<{
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

export function createHippocampus(
  dbPath: string,
  log?: (msg: string) => void,
): SqliteHippocampus {
  return new SqliteHippocampus(dbPath, log);
}
