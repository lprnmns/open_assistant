import { describe, expect, it, vi } from "vitest";
import { InMemoryUndoRegistry } from "./undo-registry.js";

describe("InMemoryUndoRegistry", () => {
  it("keeps only the last action per scope", () => {
    const registry = new InMemoryUndoRegistry();
    registry.register({
      scopeKey: "session-1",
      toolName: "calendar_add",
      summary: "Added first event",
      undo: vi.fn(),
    });
    const secondUndo = vi.fn();
    registry.register({
      scopeKey: "session-1",
      toolName: "calendar_add",
      summary: "Added second event",
      undo: secondUndo,
    });

    const entry = registry.peekLast("session-1");
    expect(entry?.summary).toBe("Added second event");
    expect(entry?.undo).toBe(secondUndo);
  });

  it("undoes and clears the last action for a scope", async () => {
    const registry = new InMemoryUndoRegistry();
    const undo = vi.fn().mockResolvedValue(undefined);
    registry.register({
      scopeKey: "session-1",
      toolName: "calendar_add",
      summary: "Added event",
      undo,
    });

    const undone = await registry.undoLast("session-1");
    expect(undone?.summary).toBe("Added event");
    expect(undo).toHaveBeenCalledTimes(1);
    expect(registry.peekLast("session-1")).toBeNull();
  });
});
