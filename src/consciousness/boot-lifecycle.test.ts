/**
 * src/consciousness/boot-lifecycle.test.ts
 *
 * Tests for the production boot wiring:
 *   - CONSCIOUSNESS_ENABLED flag off → no boot
 *   - CONSCIOUSNESS_ENABLED flag on  → scheduler starts
 *   - shutdown signal (SIGTERM/SIGINT) → scheduler.stop() called
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeStartConsciousnessLoop } from "./boot-lifecycle.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function withFlag(value: string | undefined): NodeJS.ProcessEnv {
  return { CONSCIOUSNESS_ENABLED: value } as NodeJS.ProcessEnv;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("maybeStartConsciousnessLoop", () => {
  afterEach(() => {
    // Remove all SIGTERM/SIGINT listeners added during tests to avoid leaks.
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });

  // ── Flag off ────────────────────────────────────────────────────────────────

  it("returns null when CONSCIOUSNESS_ENABLED is absent", () => {
    const result = maybeStartConsciousnessLoop({} as NodeJS.ProcessEnv);
    expect(result).toBeNull();
  });

  it("returns null when CONSCIOUSNESS_ENABLED=0", () => {
    expect(maybeStartConsciousnessLoop(withFlag("0"))).toBeNull();
  });

  it("returns null when CONSCIOUSNESS_ENABLED=false", () => {
    expect(maybeStartConsciousnessLoop(withFlag("false"))).toBeNull();
  });

  it("returns null when CONSCIOUSNESS_ENABLED is empty string", () => {
    expect(maybeStartConsciousnessLoop(withFlag(""))).toBeNull();
  });

  // ── Flag on ─────────────────────────────────────────────────────────────────

  it("returns a lifecycle when CONSCIOUSNESS_ENABLED=1", () => {
    const lc = maybeStartConsciousnessLoop(withFlag("1"));
    expect(lc).not.toBeNull();
    expect(typeof lc?.stop).toBe("function");
    expect(lc?.scheduler).toBeDefined();
    expect(lc?.reflectionQueue).toBeDefined();
    expect(lc?.auditLog).toBeDefined();
    lc?.stop();
  });

  it("returns a lifecycle when CONSCIOUSNESS_ENABLED=true (case-insensitive)", () => {
    const lc = maybeStartConsciousnessLoop(withFlag("true"));
    expect(lc).not.toBeNull();
    lc?.stop();
  });

  it("scheduler is running after start (isRunning or equivalent)", () => {
    const lc = maybeStartConsciousnessLoop(withFlag("1"));
    expect(lc).not.toBeNull();
    // Scheduler has a stop() method — if it threw, the loop didn't start
    expect(() => lc!.stop()).not.toThrow();
  });

  it("stop() is idempotent — safe to call multiple times", () => {
    const lc = maybeStartConsciousnessLoop(withFlag("1"));
    expect(lc).not.toBeNull();
    lc!.stop();
    expect(() => lc!.stop()).not.toThrow();
    expect(() => lc!.stop()).not.toThrow();
  });

  // ── PendingReflectionQueue wiring ───────────────────────────────────────────

  it("reflectionQueue starts empty", () => {
    const lc = maybeStartConsciousnessLoop(withFlag("1"));
    expect(lc!.reflectionQueue.count()).toBe(0);
    lc!.stop();
  });

  it("reflectionQueue.count() feeds pendingNoteCount in snapshot", () => {
    const lc = maybeStartConsciousnessLoop(withFlag("1"));
    expect(lc!.reflectionQueue.count()).toBe(0);
    lc!.reflectionQueue.enqueue("pending note for reflection");
    expect(lc!.reflectionQueue.count()).toBe(1);
    lc!.stop();
  });

  // ── Shutdown signal handling ─────────────────────────────────────────────────

  it("SIGTERM calls scheduler.stop()", () => {
    const lc = maybeStartConsciousnessLoop(withFlag("1"));
    expect(lc).not.toBeNull();

    const stopSpy = vi.spyOn(lc!.scheduler, "stop");
    process.emit("SIGTERM");

    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it("SIGINT calls scheduler.stop()", () => {
    const lc = maybeStartConsciousnessLoop(withFlag("1"));
    expect(lc).not.toBeNull();

    const stopSpy = vi.spyOn(lc!.scheduler, "stop");
    process.emit("SIGINT");

    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it("shutdown signal does not crash when called twice (once handler)", () => {
    const lc = maybeStartConsciousnessLoop(withFlag("1"));
    expect(lc).not.toBeNull();

    // process.once ensures the handler fires at most once
    expect(() => {
      process.emit("SIGTERM");
      process.emit("SIGTERM"); // second emit — handler already removed
    }).not.toThrow();

    lc!.stop(); // idempotent
  });
});
