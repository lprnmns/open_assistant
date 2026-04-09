import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { ProductionBrain } from "./brain/brain-factory.js";

export type ConsciousnessRuntime = {
  brain: ProductionBrain;
};

type RuntimeStore = {
  current: ConsciousnessRuntime | null;
  scoped: Map<string, ConsciousnessRuntime>;
  pending: Map<string, Promise<ConsciousnessRuntime>>;
};

const CONSCIOUSNESS_RUNTIME_KEY = Symbol.for("openclaw.consciousness.runtime");

function getRuntimeStore(): RuntimeStore {
  return resolveGlobalSingleton(CONSCIOUSNESS_RUNTIME_KEY, () => ({
    current: null,
    scoped: new Map(),
    pending: new Map(),
  }));
}

function normalizeRuntimeScope(scope?: string): string | undefined {
  const normalized = scope?.trim();
  return normalized ? normalized : undefined;
}

export function setConsciousnessRuntime(
  runtime: ConsciousnessRuntime | null,
  scope?: string,
): void {
  const store = getRuntimeStore();
  const normalizedScope = normalizeRuntimeScope(scope);
  if (!normalizedScope) {
    store.current = runtime;
    return;
  }
  if (runtime) {
    store.scoped.set(normalizedScope, runtime);
  } else {
    store.scoped.delete(normalizedScope);
  }
  store.pending.delete(normalizedScope);
}

export function getConsciousnessRuntime(scope?: string): ConsciousnessRuntime | null {
  const store = getRuntimeStore();
  const normalizedScope = normalizeRuntimeScope(scope);
  if (!normalizedScope) {
    return store.current;
  }
  return store.scoped.get(normalizedScope) ?? null;
}

export async function ensureConsciousnessRuntime(
  scope: string,
  createRuntime: () => Promise<ConsciousnessRuntime>,
): Promise<ConsciousnessRuntime> {
  const normalizedScope = normalizeRuntimeScope(scope);
  if (!normalizedScope) {
    throw new Error("consciousness runtime scope is required");
  }
  const store = getRuntimeStore();
  const existing = store.scoped.get(normalizedScope);
  if (existing) {
    return existing;
  }
  const pending = store.pending.get(normalizedScope);
  if (pending) {
    return await pending;
  }

  let initPromise: Promise<ConsciousnessRuntime> | undefined;
  initPromise = (async () => {
    try {
      const runtime = await createRuntime();
      if (store.pending.get(normalizedScope) === initPromise) {
        store.scoped.set(normalizedScope, runtime);
      }
      return runtime;
    } finally {
      if (store.pending.get(normalizedScope) === initPromise) {
        store.pending.delete(normalizedScope);
      }
    }
  })();
  store.pending.set(normalizedScope, initPromise);
  return await initPromise;
}

export async function __resetConsciousnessRuntimesForTest(): Promise<void> {
  const store = getRuntimeStore();
  const runtimes = new Set<ConsciousnessRuntime>();
  if (store.current) {
    runtimes.add(store.current);
  }
  for (const runtime of store.scoped.values()) {
    runtimes.add(runtime);
  }
  store.current = null;
  store.scoped.clear();
  store.pending.clear();
  await Promise.allSettled([...runtimes].map((runtime) => runtime.brain.close()));
}
