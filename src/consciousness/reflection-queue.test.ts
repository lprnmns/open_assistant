/**
 * src/consciousness/reflection-queue.test.ts
 */

import { describe, expect, it, beforeEach } from "vitest";
import { PendingReflectionQueue } from "./reflection-queue.js";

describe("PendingReflectionQueue", () => {
  let queue: PendingReflectionQueue;

  beforeEach(() => {
    queue = new PendingReflectionQueue();
  });

  it("starts empty", () => {
    expect(queue.count()).toBe(0);
    expect(queue.peek()).toBeUndefined();
    expect(queue.dequeue()).toBeUndefined();
  });

  it("enqueue increments count", () => {
    queue.enqueue("note A");
    expect(queue.count()).toBe(1);
    queue.enqueue("note B");
    expect(queue.count()).toBe(2);
  });

  it("enqueue returns a unique id", () => {
    const id1 = queue.enqueue("note 1");
    const id2 = queue.enqueue("note 2");
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it("peek returns oldest without removing", () => {
    queue.enqueue("first");
    queue.enqueue("second");
    const peeked = queue.peek();
    expect(peeked?.content).toBe("first");
    expect(queue.count()).toBe(2); // unchanged
  });

  it("dequeue removes and returns oldest (FIFO)", () => {
    queue.enqueue("first");
    queue.enqueue("second");
    const r = queue.dequeue();
    expect(r?.content).toBe("first");
    expect(queue.count()).toBe(1);
    const r2 = queue.dequeue();
    expect(r2?.content).toBe("second");
    expect(queue.count()).toBe(0);
  });

  it("dequeueAll drains and returns all in order", () => {
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    const all = queue.dequeueAll();
    expect(all.map((r) => r.content)).toEqual(["a", "b", "c"]);
    expect(queue.count()).toBe(0);
  });

  it("acknowledge removes by id, leaves others", () => {
    const id1 = queue.enqueue("keep");
    const id2 = queue.enqueue("remove");
    queue.acknowledge(id2);
    expect(queue.count()).toBe(1);
    expect(queue.peek()?.id).toBe(id1);
  });

  it("acknowledge on unknown id is a no-op", () => {
    queue.enqueue("note");
    queue.acknowledge("non-existent-id");
    expect(queue.count()).toBe(1);
  });

  it("count() is NOT affected by Cortex size — independent semantics", () => {
    // This test documents the design contract: pendingNoteCount must come
    // from PendingReflectionQueue, not from Cortex.size(). If someone wires
    // Cortex.size() here, the Watchdog would wake on PENDING_NOTE every time
    // short-term memory has content — breaking wakeup semantics.
    expect(queue.count()).toBe(0);
    queue.enqueue("queued for reflection");
    expect(queue.count()).toBe(1);
    // Draining does not affect count of remaining items
    const item = queue.dequeue();
    expect(item).toBeDefined();
    expect(queue.count()).toBe(0);
  });
});
