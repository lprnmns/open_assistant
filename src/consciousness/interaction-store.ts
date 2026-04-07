/**
 * src/consciousness/interaction-store.ts — Persistent state store for the consciousness loop
 *
 * Provides a durable backing store for the InteractionTracker so that
 * interaction state survives process restarts.
 *
 * Write path: debounced — at most one disk write per `debounceMs` (default 5 s).
 *   save(state) is fire-and-forget; close() flushes any pending write synchronously.
 *
 * Read path: synchronous — loadSync() uses readFileSync so boot-lifecycle stays
 *   synchronous and the process does not yield before seeding the tracker.
 *
 * Atomic write: data is written to `<path>.tmp` then renamed to `<path>` so a
 *   crash mid-write never leaves a corrupt file.
 */

import fs from "node:fs";
import path from "node:path";
import type { DeliveryTarget } from "./delivery-target.js";
import { migrateLegacyActiveChannel, normalizeDeliveryTarget } from "./delivery-target.js";
import {
  prunePendingProactiveDeliveries,
  type PendingProactiveDelivery,
} from "./pending-proactive-delivery.js";

// ── Persisted state ───────────────────────────────────────────────────────────

/**
 * All fields that survive a process restart.
 * Optional fields not yet wired are simply absent from the stored JSON and
 * default to `undefined` on load.
 */
export type PersistedInteractionState = {
  /** Unix ms of the last owner interaction (any channel). */
  lastUserInteractionAt?: number;
  /** Canonical proactive delivery target for the owner's active surface. */
  activeDeliveryTarget?: DeliveryTarget;
  /** Legacy stable route key for the owner's active channel (e.g. "telegram:123"). */
  activeChannelId?: string;
  /** Legacy provider/channel type for the active channel (e.g. "telegram"). */
  activeChannelType?: string;
  /** Silence threshold in ms currently in effect (backoff-expanded). Wired in WS-1.2. */
  effectiveSilenceThresholdMs?: number;
  /** Unix ms of the last completed consciousness tick. Wired in WS-1.2. */
  lastTickAt?: number;
  /** Unix ms of the last proactive SEND_MESSAGE dispatch. Wired in WS-1.3. */
  lastProactiveSentAt?: number;
  /** Persisted queue for proactive node deliveries that should retry on reconnect. */
  pendingProactiveDeliveries?: PendingProactiveDelivery[];
};

// ── InteractionStore interface ────────────────────────────────────────────────

/**
 * Contract for the durable backing store.
 * FileInteractionStore is the production implementation.
 * Tests inject stub implementations.
 */
export interface InteractionStore {
  /**
   * Enqueue a partial-update write.  The store shallow-merges the supplied
   * fields onto its accumulated state so callers can update a single field
   * without overwriting fields owned by other workstreams.
   * Debounced — rapid calls collapse to a single flush.
   * Never throws.
   */
  save(partial: Partial<PersistedInteractionState>): void;
  /**
   * Flush any pending write and release resources.
   * Safe to call multiple times (idempotent after first call).
   */
  close(): Promise<void>;
}

// ── FileInteractionStore ──────────────────────────────────────────────────────

export type FileInteractionStoreOptions = {
  /** Absolute path to the JSON state file (e.g. "data/consciousness-state.json"). */
  filePath: string;
  /**
   * Max milliseconds between disk writes.
   * Default: 5000 (5 s).  Override to 0 in tests for synchronous behaviour.
   */
  debounceMs?: number;
  /**
   * Injectable writer for tests.  When provided, replaces real fs.writeFileSync/rename.
   * Receives the final (non-tmp) path and the serialised JSON string.
   */
  _writeForTest?: (filePath: string, data: string) => void;
  /**
   * Injectable reader for tests.  When provided, replaces real fs.readFileSync.
   */
  _readForTest?: (filePath: string) => string;
};

export class FileInteractionStore implements InteractionStore {
  private readonly filePath: string;
  private readonly debounceMs: number;
  /**
   * Accumulated full state.  Every save() shallow-merges its partial onto this
   * so no field is silently dropped when different workstreams write different
   * subsets of PersistedInteractionState.
   */
  private mergedState: PersistedInteractionState = {};
  private hasPending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly _writeForTest?: (filePath: string, data: string) => void;
  private readonly _readForTest?: (filePath: string) => string;

  constructor(options: FileInteractionStoreOptions) {
    this.filePath = options.filePath;
    this.debounceMs = options.debounceMs ?? 5_000;
    this._writeForTest = options._writeForTest;
    this._readForTest = options._readForTest;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  save(partial: Partial<PersistedInteractionState>): void {
    if (this.closed) return;
    // Shallow-merge: only the supplied keys are updated; all other fields
    // already present in mergedState are preserved unchanged.
    this.mergedState = mergePersistedInteractionState(this.mergedState, partial);
    this.hasPending = true;
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushNow();
      }, this.debounceMs);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.hasPending) {
      this.flushNow();
    }
  }

  /**
   * Synchronous read for boot-time seeding.
   *
   * On success, hydrates this.mergedState with the loaded data so that
   * subsequent partial save() calls preserve all previously persisted fields
   * across process restarts — not just within the same process instance.
   *
   * Returns null when the file does not exist or contains invalid JSON.
   */
  loadSync(): PersistedInteractionState | null {
    try {
      const raw = this._readForTest
        ? this._readForTest(this.filePath)
        : fs.readFileSync(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      const state = normalizePersistedInteractionState(parsed as PersistedInteractionState);
      // Hydrate internal merged state so the restart boundary is transparent:
      // the first partial save() after boot merges onto the full disk snapshot
      // rather than onto an empty object.
      this.mergedState = { ...state };
      return state;
    } catch {
      return null;
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private flushNow(): void {
    if (!this.hasPending) return;
    this.hasPending = false;
    const state = this.mergedState;
    try {
      const data = JSON.stringify(state, null, 2);
      if (this._writeForTest) {
        this._writeForTest(this.filePath, data);
        return;
      }
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = this.filePath + ".tmp";
      fs.writeFileSync(tmp, data, "utf-8");
      fs.renameSync(tmp, this.filePath);
    } catch {
      // Swallowed: persistence failure must never crash the consciousness loop.
    }
  }
}

function normalizePersistedInteractionState(
  state: PersistedInteractionState,
): PersistedInteractionState {
  const activeDeliveryTarget =
    normalizeDeliveryTarget(state.activeDeliveryTarget) ??
    migrateLegacyActiveChannel(state.activeChannelId, state.activeChannelType);
  const pendingProactiveDeliveries = prunePendingProactiveDeliveries(
    state.pendingProactiveDeliveries,
  );
  const legacyChannelId =
    activeDeliveryTarget?.kind === "none" ? undefined : activeDeliveryTarget?.id;
  const legacyChannelType =
    activeDeliveryTarget?.kind === "channel"
      ? activeDeliveryTarget.channelType
      : undefined;

  return {
    ...state,
    activeDeliveryTarget,
    activeChannelId: legacyChannelId,
    activeChannelType: legacyChannelType,
    pendingProactiveDeliveries:
      pendingProactiveDeliveries.length > 0 ? pendingProactiveDeliveries : undefined,
  };
}

function mergePersistedInteractionState(
  previous: PersistedInteractionState,
  partial: Partial<PersistedInteractionState>,
): PersistedInteractionState {
  const merged = {
    ...previous,
    ...partial,
  };

  let activeDeliveryTarget: DeliveryTarget | undefined;
  if (Object.hasOwn(partial, "activeDeliveryTarget")) {
    activeDeliveryTarget = normalizeDeliveryTarget(partial.activeDeliveryTarget);
  } else if (
    Object.hasOwn(partial, "activeChannelId") ||
    Object.hasOwn(partial, "activeChannelType")
  ) {
    const nextLegacyChannelId = Object.hasOwn(partial, "activeChannelId")
      ? partial.activeChannelId
      : previous.activeChannelId;
    const nextLegacyChannelType = Object.hasOwn(partial, "activeChannelType")
      ? partial.activeChannelType
      : previous.activeChannelType;
    activeDeliveryTarget = migrateLegacyActiveChannel(
      nextLegacyChannelId,
      nextLegacyChannelType,
    );
  } else {
    activeDeliveryTarget =
      normalizeDeliveryTarget(merged.activeDeliveryTarget) ??
      migrateLegacyActiveChannel(merged.activeChannelId, merged.activeChannelType);
  }

  return normalizePersistedInteractionState({
    ...merged,
    activeDeliveryTarget,
  });
}
