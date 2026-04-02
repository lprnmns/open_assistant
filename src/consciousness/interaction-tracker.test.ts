/**
 * src/consciousness/interaction-tracker.test.ts
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  _resetInteractionTrackerForTest,
  getActiveChannelId,
  getLastUserInteractionAt,
  recordUserInteraction,
  resolveActiveChannelIdFromInteraction,
} from "./interaction-tracker.js";

describe("InteractionTracker", () => {
  afterEach(() => {
    _resetInteractionTrackerForTest();
  });

  it("starts with undefined state", () => {
    expect(getLastUserInteractionAt()).toBeUndefined();
    expect(getActiveChannelId()).toBeUndefined();
  });

  it("recordUserInteraction sets lastUserInteractionAt to approximately now", () => {
    const before = Date.now();
    recordUserInteraction("telegram");
    const after = Date.now();
    const ts = getLastUserInteractionAt();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("recordUserInteraction sets activeChannelId", () => {
    recordUserInteraction("discord");
    expect(getActiveChannelId()).toBe("discord");
  });

  it("subsequent interactions update both values", () => {
    recordUserInteraction("telegram");
    recordUserInteraction("whatsapp");
    expect(getActiveChannelId()).toBe("whatsapp");
  });

  it("reset clears both values", () => {
    recordUserInteraction("telegram");
    _resetInteractionTrackerForTest();
    expect(getLastUserInteractionAt()).toBeUndefined();
    expect(getActiveChannelId()).toBeUndefined();
  });

  it("each call updates the timestamp monotonically", () => {
    recordUserInteraction("telegram");
    const t1 = getLastUserInteractionAt()!;
    recordUserInteraction("telegram");
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
});
