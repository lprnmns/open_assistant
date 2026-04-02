import { describe, expect, it } from "vitest";
import {
  runAllRuntimeSmokeScenarios,
  simulateActFirstScenario,
  simulateChronoSpatialScenario,
  simulateCognitiveLoadScenario,
  simulateSilenceScenario,
} from "./scenarios.js";

describe("runtime smoke scenarios", () => {
  it("captures the silence wake semantics and its current limitation", () => {
    const result = simulateSilenceScenario();

    expect(result.status).toBe("partial");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "pure-3-day-silence",
          passed: true,
        }),
        expect.objectContaining({
          label: "silence-plus-calendar-delta",
          passed: true,
        }),
        expect.objectContaining({
          label: "exact-proactive-copy",
          passed: false,
        }),
      ]),
    );
  });

  it("shows that act-first has auto, confirm, approval-required, and human-approved paths", async () => {
    const result = await simulateActFirstScenario();

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "calendar-add-auto",
          passed: true,
        }),
        expect.objectContaining({
          label: "mid-band-confirm-path-exists",
          passed: true,
        }),
        expect.objectContaining({
          label: "email-send-blocked-without-approval",
          passed: true,
        }),
        expect.objectContaining({
          label: "email-send-auto-with-human-approval",
          passed: true,
        }),
      ]),
    );
  });

  it("applies temporal filtering instead of semantic-only fallback", async () => {
    const result = await simulateChronoSpatialScenario();

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "temporal-expression-resolved",
          passed: true,
        }),
        expect.objectContaining({
          label: "time-filter-excludes-nonmatching-notes",
          passed: true,
        }),
      ]),
    );
  });

  it("switches to executive mode with explicit no-emoji and no-fluff rules", () => {
    const result = simulateCognitiveLoadScenario();

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "executive-mode-detected",
          passed: true,
        }),
        expect.objectContaining({
          label: "executive-guidance-in-system-prompt",
          passed: true,
        }),
        expect.objectContaining({
          label: "hard-no-emoji-rule",
          passed: true,
        }),
        expect.objectContaining({
          label: "hard-no-fluff-rule",
          passed: true,
        }),
      ]),
    );
  });

  it("returns all four scenario reports together", async () => {
    const results = await runAllRuntimeSmokeScenarios();

    expect(results).toHaveLength(4);
    expect(results.map((result) => result.id)).toEqual([
      "silence",
      "act-first",
      "chrono-spatial",
      "cognitive-load",
    ]);
  });
});
