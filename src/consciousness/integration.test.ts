import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsciousnessAuditLog } from "./audit.js";
import { dispatchDecision, type DispatchContext } from "./integration.js";
import {
  DEFAULT_CONSCIOUSNESS_CONFIG,
  type TickDecision,
  type WorldSnapshot,
} from "./types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeSnap(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    capturedAt: NOW,
    lastUserInteractionAt: NOW - 60_000,
    pendingNoteCount: 0,
    firedTriggerIds: [],
    dueCronExpressions: [],
    externalWorldEvents: [],
    activeChannelId: "web-chat",
    activeChannelType: "webchat",
    lastTickAt: undefined,
    effectiveSilenceThresholdMs: DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    sendToChannel: vi.fn().mockResolvedValue(undefined),
    appendNote: vi.fn().mockResolvedValue(undefined),
    proactiveState: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ── SEND_MESSAGE ──────────────────────────────────────────────────────────────

describe("dispatchDecision — SEND_MESSAGE", () => {
  it("calls sendToChannel with the snap's activeChannelId and messageContent", async () => {
    const ctx = makeCtx();
    const snap = makeSnap({ activeChannelId: "telegram-123", activeChannelType: "telegram" });
    const decision: TickDecision = { action: "SEND_MESSAGE", messageContent: "Hello!" };

    const result = await dispatchDecision(decision, snap, ctx);

    expect(result.dispatched).toBe(true);
    expect(ctx.sendToChannel).toHaveBeenCalledOnce();
    expect(ctx.sendToChannel).toHaveBeenCalledWith("telegram-123", "Hello!", "telegram");
    expect(ctx.appendNote).not.toHaveBeenCalled();
  });

  it("drops the message (dispatched:false) when activeChannelId is undefined", async () => {
    const ctx = makeCtx();
    const snap = makeSnap({ activeChannelId: undefined });
    const decision: TickDecision = { action: "SEND_MESSAGE", messageContent: "Hi" };

    const result = await dispatchDecision(decision, snap, ctx);

    expect(result.dispatched).toBe(false);
    expect(result.error).toBeUndefined();
    expect(ctx.sendToChannel).not.toHaveBeenCalled();
  });

  it("never routes to a channel other than snap.activeChannelId", async () => {
    const ctx = makeCtx();
    const snap = makeSnap({ activeChannelId: "channel-A" });
    const decision: TickDecision = { action: "SEND_MESSAGE", messageContent: "Hi" };

    await dispatchDecision(decision, snap, ctx);

    const calls = (ctx.sendToChannel as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(([ch]) => ch === "channel-A")).toBe(true);
  });

  it("enforces proactive rate limits and records an audit entry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    const auditLog = new ConsciousnessAuditLog();
    const ctx = makeCtx({
      proactiveState: { lastSentAt: NOW - 10_000 },
      auditLog,
    });
    const snap = makeSnap({ activeChannelId: "telegram-123", activeChannelType: "telegram" });
    const decision: TickDecision = { action: "SEND_MESSAGE", messageContent: "Hello again" };

    const result = await dispatchDecision(decision, snap, ctx, {
      ...DEFAULT_CONSCIOUSNESS_CONFIG,
      proactiveMessageMinIntervalMs: 60_000,
    });

    expect(result.dispatched).toBe(false);
    expect(ctx.sendToChannel).not.toHaveBeenCalled();
    expect(auditLog.list()).toEqual([
      expect.objectContaining({
        kind: "dispatch",
        channelId: "telegram-123",
        channelType: "telegram",
        contentLength: "Hello again".length,
        decision: "rate_limited",
        success: false,
      }),
    ]);
  });

  it("caps proactive content before sending and auditing", async () => {
    const auditLog = new ConsciousnessAuditLog();
    const ctx = makeCtx({ auditLog });
    const snap = makeSnap({ activeChannelId: "telegram-123", activeChannelType: "telegram" });
    const decision: TickDecision = {
      action: "SEND_MESSAGE",
      messageContent: "This proactive message is intentionally too long.",
    };

    const result = await dispatchDecision(decision, snap, ctx, {
      ...DEFAULT_CONSCIOUSNESS_CONFIG,
      proactiveMessageMaxContentChars: 12,
    });

    expect(result.dispatched).toBe(true);
    expect(ctx.sendToChannel).toHaveBeenCalledWith("telegram-123", "This proa...", "telegram");
    expect(auditLog.list()).toEqual([
      expect.objectContaining({
        kind: "dispatch",
        channelId: "telegram-123",
        contentLength: "This proa...".length,
        contentPreview: "This proa...",
        decision: "sent",
        success: true,
      }),
    ]);
  });

  it("updates runtime state and calls onProactiveSent after a successful send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    const onProactiveSent = vi.fn();
    const ctx = makeCtx({
      proactiveState: {},
      onProactiveSent,
    });
    const snap = makeSnap({ activeChannelId: "telegram-123", activeChannelType: "telegram" });
    const decision: TickDecision = { action: "SEND_MESSAGE", messageContent: "Hello!" };

    const result = await dispatchDecision(decision, snap, ctx);

    expect(result.dispatched).toBe(true);
    expect(ctx.proactiveState?.lastSentAt).toBe(NOW);
    expect(onProactiveSent).toHaveBeenCalledOnce();
    expect(onProactiveSent).toHaveBeenCalledWith(NOW);
  });

  it("does not call onProactiveSent when the proactive send is rate-limited", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    const onProactiveSent = vi.fn();
    const ctx = makeCtx({
      proactiveState: { lastSentAt: NOW - 10_000 },
      onProactiveSent,
    });
    const snap = makeSnap({ activeChannelId: "telegram-123", activeChannelType: "telegram" });
    const decision: TickDecision = { action: "SEND_MESSAGE", messageContent: "Hello again" };

    const result = await dispatchDecision(decision, snap, ctx, {
      ...DEFAULT_CONSCIOUSNESS_CONFIG,
      proactiveMessageMinIntervalMs: 60_000,
    });

    expect(result.dispatched).toBe(false);
    expect(onProactiveSent).not.toHaveBeenCalled();
  });

  it("returns dispatched:false with error when sendToChannel throws — does not rethrow", async () => {
    const auditLog = new ConsciousnessAuditLog();
    const ctx = makeCtx({
      sendToChannel: vi.fn().mockRejectedValue(new Error("network error")),
      auditLog,
    });
    const snap = makeSnap();
    const decision: TickDecision = { action: "SEND_MESSAGE", messageContent: "Hi" };

    const result = await dispatchDecision(decision, snap, ctx);

    expect(result.dispatched).toBe(false);
    expect(result.error?.message).toBe("network error");
    expect(auditLog.list()).toEqual([
      expect.objectContaining({
        kind: "dispatch",
        channelId: "web-chat",
        contentLength: 2,
        decision: "send_error",
        success: false,
      }),
    ]);
  });
});

// ── TAKE_NOTE ─────────────────────────────────────────────────────────────────

describe("dispatchDecision — TAKE_NOTE", () => {
  it("calls appendNote with noteContent", async () => {
    const ctx = makeCtx();
    const snap = makeSnap();
    const decision: TickDecision = { action: "TAKE_NOTE", noteContent: "Remember this." };

    const result = await dispatchDecision(decision, snap, ctx);

    expect(result.dispatched).toBe(true);
    expect(ctx.appendNote).toHaveBeenCalledOnce();
    expect(ctx.appendNote).toHaveBeenCalledWith("Remember this.");
    expect(ctx.sendToChannel).not.toHaveBeenCalled();
  });

  it("returns dispatched:false with error when appendNote throws — loop must survive", async () => {
    const ctx = makeCtx({
      appendNote: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    const snap = makeSnap();
    const decision: TickDecision = { action: "TAKE_NOTE", noteContent: "Note." };

    // Must not throw — loop stays alive
    const result = await dispatchDecision(decision, snap, ctx);

    expect(result.dispatched).toBe(false);
    expect(result.error?.message).toBe("disk full");
    expect(ctx.sendToChannel).not.toHaveBeenCalled();
  });

  it("wraps non-Error throws from appendNote into an Error object", async () => {
    const ctx = makeCtx({
      appendNote: vi.fn().mockRejectedValue("string error"),
    });
    const snap = makeSnap();
    const decision: TickDecision = { action: "TAKE_NOTE", noteContent: "Note." };

    const result = await dispatchDecision(decision, snap, ctx);

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe("string error");
  });
});

// ── STAY_SILENT ───────────────────────────────────────────────────────────────

describe("dispatchDecision — STAY_SILENT", () => {
  it("is a no-op: dispatched:false, no callbacks called", async () => {
    const ctx = makeCtx();
    const snap = makeSnap();
    const decision: TickDecision = { action: "STAY_SILENT" };

    const result = await dispatchDecision(decision, snap, ctx);

    expect(result.dispatched).toBe(false);
    expect(result.error).toBeUndefined();
    expect(ctx.sendToChannel).not.toHaveBeenCalled();
    expect(ctx.appendNote).not.toHaveBeenCalled();
  });
});

// ── ENTER_SLEEP ───────────────────────────────────────────────────────────────

describe("dispatchDecision — ENTER_SLEEP", () => {
  it("is a no-op: dispatched:false, no callbacks called", async () => {
    const ctx = makeCtx();
    const snap = makeSnap();
    const decision: TickDecision = { action: "ENTER_SLEEP" };

    const result = await dispatchDecision(decision, snap, ctx);

    expect(result.dispatched).toBe(false);
    expect(result.error).toBeUndefined();
    expect(ctx.sendToChannel).not.toHaveBeenCalled();
    expect(ctx.appendNote).not.toHaveBeenCalled();
  });
});
