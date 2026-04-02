/**
 * src/consciousness/interaction-tracker.test.ts
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  _resetInteractionTrackerForTest,
  getActiveChannelId,
  getLastUserInteractionAt,
  recordUserInteraction,
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
});
