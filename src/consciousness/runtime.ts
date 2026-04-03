import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { ProductionBrain } from "./brain/brain-factory.js";

export type ConsciousnessRuntime = {
  brain: ProductionBrain;
};

type RuntimeStore = {
  current: ConsciousnessRuntime | null;
};

const CONSCIOUSNESS_RUNTIME_KEY = Symbol.for("openclaw.consciousness.runtime");

function getRuntimeStore(): RuntimeStore {
  return resolveGlobalSingleton(CONSCIOUSNESS_RUNTIME_KEY, () => ({
    current: null,
  }));
}

export function setConsciousnessRuntime(runtime: ConsciousnessRuntime | null): void {
  getRuntimeStore().current = runtime;
}

export function getConsciousnessRuntime(): ConsciousnessRuntime | null {
  return getRuntimeStore().current;
}
