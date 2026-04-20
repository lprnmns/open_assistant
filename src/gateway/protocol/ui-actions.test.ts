import { describe, expect, it } from "vitest";
import {
  formatValidationErrors,
  validateUiActionPlan,
  validateUiTaskRunParams,
  type UiActionPlan,
} from "./index.js";

const validPlan = {
  kind: "ui_actions",
  planId: "ui_plan_123",
  targetDeviceId: "android_redmi",
  idempotencyKey: "ui_plan_123_attempt_1",
  risk: "low",
  requiresConfirmation: false,
  actions: [
    { action: "open_app", target: "com.instagram.android" },
    { action: "click_node", content_desc: "Search" },
    { action: "type_text", text: "Ali" },
    { action: "observe_screen" },
  ],
} satisfies UiActionPlan;

describe("ui action protocol validation", () => {
  it("accepts a bounded Android UI action plan", () => {
    expect(validateUiActionPlan(validPlan)).toBe(true);
  });

  it("rejects plans without an idempotency key", () => {
    const plan = { ...validPlan };
    delete (plan as Record<string, unknown>).idempotencyKey;

    expect(validateUiActionPlan(plan)).toBe(false);
    expect(formatValidationErrors(validateUiActionPlan.errors)).toContain("idempotencyKey");
  });

  it("rejects click actions without a stable selector", () => {
    const plan = {
      ...validPlan,
      actions: [{ action: "click_node" }],
    };

    expect(validateUiActionPlan(plan)).toBe(false);
    expect(formatValidationErrors(validateUiActionPlan.errors)).toContain("must match");
  });

  it("rejects arbitrary LLM-supplied action fields", () => {
    const plan = {
      ...validPlan,
      actions: [
        {
          action: "open_app",
          target: "com.instagram.android",
          shell: "rm -rf /",
        },
      ],
    };

    expect(validateUiActionPlan(plan)).toBe(false);
    expect(formatValidationErrors(validateUiActionPlan.errors)).toContain("shell");
  });

  it("accepts a bounded UI task run request with optional action hints", () => {
    expect(
      validateUiTaskRunParams({
        objective: "Open Instagram and search Ali",
        maxSteps: 5,
        actions: [{ action: "open_app", target: "com.instagram.android" }],
      }),
    ).toBe(true);
  });

  it("rejects UI task run requests without an objective", () => {
    expect(validateUiTaskRunParams({ actions: [{ action: "observe_screen" }] })).toBe(false);
    expect(formatValidationErrors(validateUiTaskRunParams.errors)).toContain("objective");
  });
});
