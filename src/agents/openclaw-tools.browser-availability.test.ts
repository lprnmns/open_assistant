import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing as browserToolAvailabilityTesting,
  markBrowserToolUnhealthy,
} from "../browser/tool-availability.js";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("createOpenClawTools browser availability", () => {
  beforeEach(() => {
    browserToolAvailabilityTesting.resetBrowserToolAvailability();
    vi.useFakeTimers();
  });

  afterEach(() => {
    browserToolAvailabilityTesting.resetBrowserToolAvailability();
    vi.useRealTimers();
  });

  it("omits browser tool while browser health is marked unavailable", () => {
    markBrowserToolUnhealthy({
      reason: "Can't reach the OpenClaw browser control service.",
      cooldownMs: 60_000,
    });

    expect(createOpenClawTools().some((tool) => tool.name === "browser")).toBe(false);

    vi.advanceTimersByTime(60_001);

    expect(createOpenClawTools().some((tool) => tool.name === "browser")).toBe(true);
  });
});
