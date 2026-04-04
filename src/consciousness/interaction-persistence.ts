import process from "node:process";
import {
  FileInteractionStore,
  type PersistedInteractionState,
} from "./interaction-store.js";
import {
  seedInteractionTracker,
  setInteractionStore,
} from "./interaction-tracker.js";

export type InteractionPersistenceLifecycle = {
  stop: () => Promise<void>;
  interactionStore: FileInteractionStore;
  loadedState: PersistedInteractionState | null;
};

let currentLifecycle: InteractionPersistenceLifecycle | null = null;

export function resolveInteractionStorePath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const configured = env.CONSCIOUSNESS_STATE_PATH?.trim();
  if (configured) return configured;
  if (env.CONSCIOUSNESS_STATE_PATH === "") return undefined;
  return "data/consciousness-state.json";
}

export function maybeStartInteractionPersistence(
  env: NodeJS.ProcessEnv = process.env,
): InteractionPersistenceLifecycle | null {
  const filePath = resolveInteractionStorePath(env);
  if (!filePath) {
    return null;
  }

  if (currentLifecycle) {
    return currentLifecycle;
  }

  const interactionStore = new FileInteractionStore({ filePath });
  const loadedState = interactionStore.loadSync();
  if (loadedState) {
    seedInteractionTracker(loadedState);
  }
  setInteractionStore(interactionStore);

  let stopped = false;
  const lifecycle: InteractionPersistenceLifecycle = {
    interactionStore,
    loadedState,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (currentLifecycle === lifecycle) {
        currentLifecycle = null;
      }
      setInteractionStore(null);
      await interactionStore.close();
    },
  };

  currentLifecycle = lifecycle;
  return lifecycle;
}

export async function __resetInteractionPersistenceForTest(): Promise<void> {
  const active = currentLifecycle;
  currentLifecycle = null;
  if (active) {
    await active.stop();
  } else {
    setInteractionStore(null);
  }
}
