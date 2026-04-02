/**
 * src/consciousness/reflection-queue.ts — Pending Reflection Queue
 *
 * Tracks notes queued for LLM reflection — the source of truth for
 * WorldSnapshot.pendingNoteCount (PENDING_NOTE wakeup path).
 *
 * This is intentionally separate from the Cortex RAM buffer.
 * Cortex.size() reflects how many notes are in short-term memory;
 * PendingReflectionQueue.count() reflects how many notes are waiting
 * for the consciousness loop to process them via TAKE_NOTE.
 *
 * Mixing the two would cause the Watchdog to wake on PENDING_NOTE
 * whenever short-term memory has any content — breaking wakeup semantics.
 *
 * Lifecycle of a pending reflection:
 *   1. An external event produces a note worth reflecting on
 *      (e.g. inbound owner message, external trigger, cron job)
 *   2. Caller calls enqueue(content)
 *   3. Next consciousness tick reads pendingNoteCount > 0 →
 *      Watchdog fires PENDING_NOTE → tick() runs → TAKE_NOTE decision
 *   4. On TAKE_NOTE dispatch, caller calls acknowledge() to decrement
 *      (or dequeueAll() to drain the full batch)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type PendingReflection = {
  readonly id: string;
  readonly content: string;
  readonly queuedAt: number; // Unix ms
};

// ── Queue implementation ──────────────────────────────────────────────────────

export class PendingReflectionQueue {
  private readonly _queue: PendingReflection[] = [];
  private _idCounter = 0;

  /**
   * Add a note to the queue.
   * Returns the assigned ID for later acknowledgement.
   */
  enqueue(content: string): string {
    const id = `refl-${Date.now()}-${++this._idCounter}`;
    this._queue.push({ id, content, queuedAt: Date.now() });
    return id;
  }

  /**
   * Number of notes waiting for LLM reflection.
   * This is what WorldSnapshot.pendingNoteCount should use.
   */
  count(): number {
    return this._queue.length;
  }

  /**
   * Peek at the oldest pending reflection without removing it.
   */
  peek(): PendingReflection | undefined {
    return this._queue[0];
  }

  /**
   * Remove and return the oldest pending reflection.
   * Returns undefined if the queue is empty.
   */
  dequeue(): PendingReflection | undefined {
    return this._queue.shift();
  }

  /**
   * Remove and return all pending reflections.
   * Used when the loop processes a batch of pending notes.
   */
  dequeueAll(): PendingReflection[] {
    return this._queue.splice(0, this._queue.length);
  }

  /**
   * Remove a specific reflection by ID (post-dispatch acknowledgement).
   * No-op if ID is not found.
   */
  acknowledge(id: string): void {
    const idx = this._queue.findIndex((r) => r.id === id);
    if (idx !== -1) this._queue.splice(idx, 1);
  }
}
