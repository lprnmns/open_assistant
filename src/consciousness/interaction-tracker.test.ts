/**
 * src/consciousness/interaction-tracker.test.ts
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  _resetInteractionTrackerForTest,
  getActiveDeliveryTarget,
  getActiveChannelId,
  getActiveChannelType,
  getLastUserInteractionAt,
  recordDeliveryTargetInteraction,
  recordUserInteraction,
  resolveDeliveryTargetFromInteraction,
  resolveActiveChannelIdFromInteraction,
} from "./interaction-tracker.js";

describe("InteractionTracker", () => {
  afterEach(() => {
    _resetInteractionTrackerForTest();
  });

  it("starts with undefined state", () => {
    expect(getLastUserInteractionAt()).toBeUndefined();
    expect(getActiveDeliveryTarget()).toBeUndefined();
    expect(getActiveChannelId()).toBeUndefined();
    expect(getActiveChannelType()).toBeUndefined();
  });

  it("recordUserInteraction sets lastUserInteractionAt to approximately now", () => {
    const before = Date.now();
    recordUserInteraction("telegram", "telegram");
    const after = Date.now();
    const ts = getLastUserInteractionAt();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("recordUserInteraction sets activeChannelId", () => {
    recordUserInteraction("discord:channel:123", "discord");
    expect(getActiveDeliveryTarget()).toEqual({
      kind: "channel",
      id: "discord:channel:123",
      channelType: "discord",
    });
    expect(getActiveChannelId()).toBe("discord:channel:123");
  });

  it("recordUserInteraction stores activeChannelType when provided", () => {
    recordUserInteraction("telegram:123", "telegram");
    expect(getActiveChannelType()).toBe("telegram");
  });

  it("recordUserInteraction leaves activeChannelType undefined when absent", () => {
    recordUserInteraction("route-only");
    expect(getActiveDeliveryTarget()).toEqual({
      kind: "channel",
      id: "route-only",
      channelType: undefined,
    });
    expect(getActiveChannelId()).toBe("route-only");
    expect(getActiveChannelType()).toBeUndefined();
  });

  it("subsequent interactions update both values", () => {
    recordUserInteraction("telegram:123", "telegram");
    recordUserInteraction("whatsapp:+15550001111", "whatsapp");
    expect(getActiveChannelId()).toBe("whatsapp:+15550001111");
    expect(getActiveChannelType()).toBe("whatsapp");
  });

  it("reset clears both values", () => {
    recordUserInteraction("telegram:123", "telegram");
    _resetInteractionTrackerForTest();
    expect(getLastUserInteractionAt()).toBeUndefined();
    expect(getActiveDeliveryTarget()).toBeUndefined();
    expect(getActiveChannelId()).toBeUndefined();
    expect(getActiveChannelType()).toBeUndefined();
  });

  it("recordDeliveryTargetInteraction stores a node target without a channel type", () => {
    recordDeliveryTargetInteraction({
      kind: "node",
      id: "android-node-1",
      nodeId: "android-node-1",
    });
    expect(getActiveDeliveryTarget()).toEqual({
      kind: "node",
      id: "android-node-1",
      nodeId: "android-node-1",
    });
    expect(getActiveChannelId()).toBe("android-node-1");
    expect(getActiveChannelType()).toBeUndefined();
  });

  it("each call updates the timestamp monotonically", () => {
    recordUserInteraction("telegram:123", "telegram");
    const t1 = getLastUserInteractionAt()!;
    recordUserInteraction("telegram:123", "telegram");
    const t2 = getLastUserInteractionAt()!;
    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it("prefers OriginatingTo as the active route key", () => {
    expect(
      resolveActiveChannelIdFromInteraction({
        OriginatingTo: "telegram:123",
        NativeChannelId: "native:ignored",
        To: "to:ignored",
        From: "from:ignored",
      }),
    ).toBe("telegram:123");
  });

  it("falls back to NativeChannelId when OriginatingTo is absent", () => {
    expect(
      resolveActiveChannelIdFromInteraction({
        NativeChannelId: "discord:channel:42",
        To: "to:ignored",
        From: "from:ignored",
      }),
    ).toBe("discord:channel:42");
  });

  it("falls back to To then From for legacy contexts", () => {
    expect(
      resolveActiveChannelIdFromInteraction({
        To: "whatsapp:+15550001111",
      }),
    ).toBe("whatsapp:+15550001111");

    expect(
      resolveActiveChannelIdFromInteraction({
        From: "signal:+15550002222",
      }),
    ).toBe("signal:+15550002222");
  });

  it("ignores empty route fragments", () => {
    expect(
      resolveActiveChannelIdFromInteraction({
        OriginatingTo: "  ",
        NativeChannelId: "",
        To: "  ",
        From: undefined,
      }),
    ).toBeUndefined();
  });

  it("builds a channel delivery target from the resolved route", () => {
    expect(
      resolveDeliveryTargetFromInteraction(
        {
          OriginatingTo: "telegram:123",
          NativeChannelId: "native:ignored",
        },
        "telegram",
      ),
    ).toEqual({
      kind: "channel",
      id: "telegram:123",
      channelType: "telegram",
    });
  });
});
