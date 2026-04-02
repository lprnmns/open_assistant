export type UndoEntry = {
  id: string;
  toolName: string;
  summary: string;
  createdAt: number;
  undo: () => Promise<void> | void;
};

export class InMemoryUndoRegistry {
  private readonly entries = new Map<string, UndoEntry>();

  register(params: {
    scopeKey: string;
    toolName: string;
    summary: string;
    undo: () => Promise<void> | void;
  }): UndoEntry {
    const entry: UndoEntry = {
      id: crypto.randomUUID(),
      toolName: params.toolName,
      summary: params.summary,
      createdAt: Date.now(),
      undo: params.undo,
    };
    this.entries.set(params.scopeKey, entry);
    return entry;
  }

  peekLast(scopeKey: string): UndoEntry | null {
    return this.entries.get(scopeKey) ?? null;
  }

  async undoLast(scopeKey: string): Promise<UndoEntry | null> {
    const entry = this.entries.get(scopeKey);
    if (!entry) return null;
    this.entries.delete(scopeKey);
    await entry.undo();
    return entry;
  }
}

const defaultUndoRegistry = new InMemoryUndoRegistry();

export function getDefaultUndoRegistry(): InMemoryUndoRegistry {
  return defaultUndoRegistry;
}
