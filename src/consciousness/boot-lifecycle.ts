/**
 * src/consciousness/boot-lifecycle.ts - Production boot wiring for the
 * Consciousness Loop.
 *
 * maybeStartConsciousnessLoop() is the single app bootstrap seam for the
 * background loop. When CONSCIOUSNESS_ENABLED=1 it wires:
 *   1. persisted interaction state
 *   2. production Living Brain init
 *   3. snapshot adapters
 *   4. proactive dispatch callbacks
 *   5. graceful shutdown
 */

import process from "node:process";
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { loadConfig, type OpenClawConfig } from "../config/config.js";
import {
  clearGlobalConsciousnessAuditLog,
  ConsciousnessAuditLog,
  setGlobalConsciousnessAuditLog,
} from "./audit.js";
import { startConsciousnessLoop, type ConsciousnessScheduler } from "./boot.js";
import {
  createProductionBrain,
  type ProductionBrain,
} from "./brain/brain-factory.js";
import {
  getActiveChannelId,
  getActiveChannelType,
  getLastUserInteractionAt,
  seedInteractionTracker,
  setInteractionStore,
} from "./interaction-tracker.js";
import { FileInteractionStore } from "./interaction-store.js";
import type { TickResult } from "./loop.js";
import { PendingReflectionQueue } from "./reflection-queue.js";
import { setConsciousnessRuntime } from "./runtime.js";
import { buildRealWorldSnapshot } from "./snapshot.js";
import { ingestConversationTurn } from "./turn-ingestion.js";
import { DEFAULT_CONSCIOUSNESS_CONFIG } from "./types.js";

export type ConsciousnessLifecycle = {
  stop: () => Promise<void>;
  scheduler: ConsciousnessScheduler;
  brain: ProductionBrain;
  reflectionQueue: PendingReflectionQueue;
  auditLog: ConsciousnessAuditLog;
  interactionStore?: FileInteractionStore;
  getEffectiveSilenceThresholdMs: () => number;
  getLastTickAt: () => number | undefined;
  getLastProactiveSentAt: () => number | undefined;
  _fireOnTickForTest: (result: TickResult) => void;
  _fireOnProactiveSentForTest: (sentAt?: number) => void;
};

export type BootLifecycleDeps = {
  loadConfig?: () => OpenClawConfig;
  createProductionBrain?: typeof createProductionBrain;
};

export async function maybeStartConsciousnessLoop(
  env: NodeJS.ProcessEnv = process.env,
  deps: BootLifecycleDeps = {},
): Promise<ConsciousnessLifecycle | null> {
  if (!isTruthy(env.CONSCIOUSNESS_ENABLED)) {
    return null;
  }

  const loadConfigFn = deps.loadConfig ?? loadConfig;
  const createProductionBrainFn =
    deps.createProductionBrain ?? createProductionBrain;

  const interactionStorePath = resolveInteractionStorePath(env);
  const interactionStore = interactionStorePath
    ? new FileInteractionStore({ filePath: interactionStorePath })
    : undefined;
  const loaded = interactionStore ? interactionStore.loadSync() : null;
  if (loaded) {
    seedInteractionTracker(loaded);
  }
  if (interactionStore) {
    setInteractionStore(interactionStore);
  }

  const envThreshold = resolvePositiveIntEnv(
    env.CONSCIOUSNESS_SILENCE_THRESHOLD_MS,
  );
  const baseSilenceThresholdMs =
    envThreshold ?? DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs;
  const effectiveThresholdRef = {
    value: loaded?.effectiveSilenceThresholdMs ?? baseSilenceThresholdMs,
  };
  const lastTickAtRef = { value: loaded?.lastTickAt as number | undefined };
  const proactiveState: { lastSentAt?: number } = {
    lastSentAt: loaded?.lastProactiveSentAt as number | undefined,
  };

  const reflectionQueue = new PendingReflectionQueue();
  const auditLog = new ConsciousnessAuditLog({
    filePath: resolveAuditLogPath(env),
  });
  setGlobalConsciousnessAuditLog(auditLog);

  const onProactiveSentCallback = (sentAt: number): void => {
    proactiveState.lastSentAt = sentAt;
    interactionStore?.save({ lastProactiveSentAt: sentAt });
  };

  const onTickCallback = (result: TickResult): void => {
    lastTickAtRef.value = Date.now();
    if (
      result.watchdogResult.wake === true &&
      result.watchdogResult.reason === "SILENCE_THRESHOLD" &&
      result.watchdogResult.nextSilenceThresholdMs !== undefined
    ) {
      effectiveThresholdRef.value = result.watchdogResult.nextSilenceThresholdMs;
    }
    interactionStore?.save({
      lastTickAt: lastTickAtRef.value,
      effectiveSilenceThresholdMs: effectiveThresholdRef.value,
    });
  };

  let stopped = false;
  let scheduler: ConsciousnessScheduler | null = null;
  let brain: ProductionBrain | null = null;

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    scheduler?.stop();
    clearGlobalConsciousnessAuditLog(auditLog);
    setConsciousnessRuntime(null);

    const closes: Promise<unknown>[] = [];
    if (interactionStore) {
      setInteractionStore(null);
      closes.push(interactionStore.close());
    }
    if (brain) {
      closes.push(brain.close());
    }
    if (closes.length > 0) {
      await Promise.allSettled(closes);
    }
  };

  try {
    const cfg = loadConfigFn();
    const sessionKey = resolveBrainSessionKey(env);
    brain = await createProductionBrainFn({
      cfg,
      dbPath: resolveBrainDbPath(env),
      sessionKey,
      agentId: resolveSessionAgentId({ config: cfg, sessionKey }),
    });
    const activeBrain = brain;

    scheduler = startConsciousnessLoop({
      config: { baseSilenceThresholdMs },
      buildSnapshot: () =>
        buildRealWorldSnapshot({
          getLastUserInteractionAt: () => getLastUserInteractionAt(),
          getPendingNoteCount: () => reflectionQueue.count(),
          getFiredTriggerIds: () => [],
          getActiveChannelId: () => getActiveChannelId(),
          getActiveChannelType: () => getActiveChannelType(),
          getLastTickAt: () => lastTickAtRef.value,
          getEffectiveSilenceThresholdMs: () => effectiveThresholdRef.value,
        }),
      onTick: onTickCallback,
      dispatch: {
        sendToChannel: async (
          channelId: string,
          content: string,
          channelType?: string,
        ) => {
          const { isRoutableChannel, routeReply } = await import(
            "../auto-reply/reply/route-reply.js"
          );

          if (!channelType || !isRoutableChannel(channelType)) {
            throw new Error(
              `Active channel is not routable for consciousness dispatch: ${String(channelType ?? "(unknown)")}`,
            );
          }

          const result = await routeReply({
            payload: { text: content },
            channel: channelType,
            to: channelId,
            cfg: loadConfigFn(),
            mirror: false,
          });
          if (!result.ok) {
            throw new Error(
              result.error ??
                `Failed to route proactive message to ${channelType}`,
            );
          }
          await ingestConversationTurn({
            direction: "assistant/proactive",
            sessionKey: activeBrain.sessionKey,
            text: content,
          });
        },
        proactiveState,
        onProactiveSent: onProactiveSentCallback,
        auditLog,
      },
      auditLog,
      brain: {
        ingestion: activeBrain.ingestion,
        recall: activeBrain.recall,
        sessionKey: activeBrain.sessionKey,
      },
    });
    setConsciousnessRuntime({ brain: activeBrain });
  } catch (error) {
    await stop();
    throw error;
  }

  process.once("SIGTERM", () => {
    void stop();
  });
  process.once("SIGINT", () => {
    void stop();
  });

  return {
    stop,
    scheduler: scheduler!,
    brain: brain!,
    reflectionQueue,
    auditLog,
    interactionStore,
    getEffectiveSilenceThresholdMs: () => effectiveThresholdRef.value,
    getLastTickAt: () => lastTickAtRef.value,
    getLastProactiveSentAt: () => proactiveState.lastSentAt,
    _fireOnTickForTest: onTickCallback,
    _fireOnProactiveSentForTest: (sentAt = Date.now()) =>
      onProactiveSentCallback(sentAt),
  };
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function resolveAuditLogPath(env: NodeJS.ProcessEnv): string | undefined {
  const filePath = env.CONSCIOUSNESS_AUDIT_LOG_PATH?.trim();
  return filePath ? filePath : undefined;
}

function resolvePositiveIntEnv(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function resolveInteractionStorePath(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.CONSCIOUSNESS_STATE_PATH?.trim();
  if (configured) return configured;
  if (env.CONSCIOUSNESS_STATE_PATH === "") return undefined;
  return "data/consciousness-state.json";
}

function resolveBrainDbPath(env: NodeJS.ProcessEnv): string {
  const configured = env.CONSCIOUSNESS_DB_PATH?.trim();
  return configured || "data/consciousness.db";
}

function resolveBrainSessionKey(env: NodeJS.ProcessEnv): string {
  const configured = env.CONSCIOUSNESS_SESSION_KEY?.trim();
  return configured || "consciousness-main";
}
