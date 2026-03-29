/**
 * src/consciousness/brain/cortex.ts — In-RAM short-term memory (Cortex)
 *
 * InMemoryCortex implements the Cortex interface using a fixed-size circular
 * buffer.  No imports from Embedder, Hippocampus, or any I/O layer.
 *
 * Circular buffer mechanics
 * ─────────────────────────
 *   `head`  — index of the NEXT write slot (advances after each stage()).
 *   `size`  — number of valid items currently in the buffer (0..capacity).
 *
 *   stage():   write at buffer[head], advance head mod capacity.
 *              When size < capacity, increment size.
 *              When size === capacity, head has wrapped: oldest slot is
 *              overwritten and the new item silently replaces it.  O(1).
 *
 *   recent(n): read backwards from head-1 for min(n, size) steps.
 *              Returns newest-first.  O(min(n, size)).
 *
 *   clear():   reset head=0, size=0.  Buffer slots are not zeroed; they will
 *              be overwritten on the next stage().  O(1).
 *
 * Why circular buffer (not Array.push + slice)?
 *   Array.unshift / shift is O(N).  A fixed array with head/size pointers
 *   keeps stage() at O(1) regardless of capacity.
 */

import type { Cortex, MemoryNote } from "./types.js";

/** Default capacity used by createCortex() when no override is supplied. */
export const DEFAULT_CORTEX_CAPACITY = 64;

export class InMemoryCortex implements Cortex {
  private readonly buffer: Array<MemoryNote | undefined>;
  /** Index of the next write slot. */
  private head = 0;
  /** Number of valid items currently stored (0 ≤ size ≤ capacity). */
  private size = 0;

  constructor(private readonly capacity: number = DEFAULT_CORTEX_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`Cortex capacity must be a positive integer, got ${capacity}`);
    }
    this.buffer = new Array<MemoryNote | undefined>(capacity).fill(undefined);
  }

  /**
   * Append a note to the buffer.
   * O(1) — no array shift, no allocation after construction.
   * When full, the oldest note is silently replaced.
   */
  stage(note: MemoryNote): void {
    this.buffer[this.head] = note;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
    // When size === capacity the slot that head just left is now the oldest;
    // it was implicitly evicted by being overwritten above.
  }

  /**
   * Return the n most recently staged notes, newest-first.
   * Returns min(n, size) items.  Never throws; returns [] for n ≤ 0.
   */
  recent(n: number): readonly MemoryNote[] {
    const count = Math.min(Math.max(0, n), this.size);
    const result: MemoryNote[] = [];
    for (let i = 0; i < count; i++) {
      // (head - 1) is the most recent, (head - 2) the one before, etc.
      // Adding capacity before the modulo prevents negative indices.
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      result.push(this.buffer[idx]!);
    }
    return result;
  }

  /** Drain the buffer.  O(1) — slots are lazily overwritten on next stage(). */
  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}

/**
 * Factory preferred over `new InMemoryCortex()` in application code.
 * Accepts an optional capacity override; defaults to DEFAULT_CORTEX_CAPACITY.
 */
export function createCortex(capacity?: number): InMemoryCortex {
  return new InMemoryCortex(capacity);
}
