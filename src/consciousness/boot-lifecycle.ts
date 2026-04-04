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
import { createSubsystemLogger } from "../logging/subsystem.js";
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
} from "./interaction-tracker.js";
import type { FileInteractionStore } from "./interaction-store.js";
import { maybeStartInteractionPersistence } from "./interaction-persistence.js";
import type { TickResult } from "./loop.js";
import { PendingReflectionQueue } from "./reflection-queue.js";
import { setConsciousnessRuntime } from "./runtime.js";
import { buildRealWorldSnapshot } from "./snapshot.js";
import { ingestConversationTurn } from "./turn-ingestion.js";
import { DEFAULT_CONSCIOUSNESS_CONFIG } from "./types.js";

const consciousnessLog = createSubsystemLogger("consciousness");
const consciousnessDispatchLog = consciousnessLog.child("dispatch");

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

  const sessionKey = resolveBrainSessionKey(env);
  const auditLogPath = resolveAuditLogPath(env) ?? "(disabled)";
  const brainDbPath = resolveBrainDbPath(env) ?? "(default)";
  consciousnessLog.info("boot start", {
    sessionKey,
    dbPath: brainDbPath,
    auditLogPath,
  });

  const loadConfigFn = deps.loadConfig ?? loadConfig;
  const createProductionBrainFn =
    deps.createProductionBrain ?? createProductionBrain;

  const interactionPersistence = maybeStartInteractionPersistence(env);
  const interactionStore = interactionPersistence?.interactionStore;
  const loaded = interactionPersistence?.loadedState ?? null;

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
    if (result.watchdogResult.wake) {
      consciousnessLog.info("wake", {
        reason: result.watchdogResult.reason,
        context: result.watchdogResult.context,
        nextDelayMs: result.nextDelayMs,
      });
    } else if (consciousnessLog.isEnabled("debug")) {
      consciousnessLog.debug("tick idle", {
        nextDelayMs: result.nextDelayMs,
      });
    }
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
    if (interactionPersistence) {
      closes.push(interactionPersistence.stop());
    }
    if (brain) {
      closes.push(brain.close());
    }
    if (closes.length > 0) {
      await Promise.allSettled(closes);
    }
    consciousnessLog.info("stopped");
  };

  try {
    const cfg = loadConfigFn();
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
          consciousnessDispatchLog.info("dispatch attempt", {
            channelId,
            channelType: channelType ?? "(unknown)",
          });
          const { isRoutableChannel, routeReply } = await import(
            "../auto-reply/reply/route-reply.js"
          );

          if (!channelType || !isRoutableChannel(channelType)) {
            const error = new Error(
              `Active channel is not routable for consciousness dispatch: ${String(channelType ?? "(unknown)")}`,
            );
            consciousnessDispatchLog.error("dispatch send_error", {
              channelId,
              channelType: channelType ?? "(unknown)",
              error: error.message,
            });
            throw error;
          }

          try {
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
            consciousnessDispatchLog.info("dispatch sent", {
              channelId,
              channelType,
            });
          } catch (error) {
            consciousnessDispatchLog.error("dispatch send_error", {
              channelId,
              channelType,
              error: describeErrorMessage(error),
            });
            throw error;
          }
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
    consciousnessLog.info("boot ready", {
      sessionKey: activeBrain.sessionKey,
      dbPath: activeBrain.dbPath,
      auditLogPath,
    });
  } catch (error) {
    consciousnessLog.error("boot failed", { error: describeErrorMessage(error) });
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

function describeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || String(error);
  }
  return String(error);
}

function resolveBrainDbPath(env: NodeJS.ProcessEnv): string {
  const configured = env.CONSCIOUSNESS_DB_PATH?.trim();
  return configured || "data/consciousness.db";
}

function resolveBrainSessionKey(env: NodeJS.ProcessEnv): string {
  const configured = env.CONSCIOUSNESS_SESSION_KEY?.trim();
  return configured || "consciousness-main";
}
