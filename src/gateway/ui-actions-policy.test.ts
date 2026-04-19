import { describe, expect, it } from "vitest";
import type { UiActionPlan } from "./protocol/index.js";
import { authorizeUiActionPlan } from "./ui-actions-policy.js";

const basePlan = {
  kind: "ui_actions",
  planId: "ui_plan_123",
  targetDeviceId: "android_redmi",
  idempotencyKey: "ui_plan_123_attempt_1",
  risk: "low",
  requiresConfirmation: false,
  expiresAt: "2026-04-20T22:00:00.000Z",
  actions: [{ action: "open_app", target: "com.instagram.android" }],
} satisfies UiActionPlan;

describe("ui action policy gate", () => {
  it("accepts a valid unexpired low-risk plan", () => {
    const decision = authorizeUiActionPlan(basePlan, {
      nowMs: Date.parse("2026-04-20T21:00:00.000Z"),
    });

    expect(decision).toEqual({ ok: true, plan: basePlan });
  });

  it("rejects a protocol-invalid plan before policy evaluation", () => {
    const decision = authorizeUiActionPlan(
      {
        ...basePlan,
        actions: [{ action: "click_node" }],
      },
      { nowMs: Date.parse("2026-04-20T21:00:00.000Z") },
    );

    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("invalid_schema");
      expect(decision.message).toContain("must match");
    }
  });

  it("rejects expired plans", () => {
    const decision = authorizeUiActionPlan(basePlan, {
      nowMs: Date.parse("2026-04-20T22:00:01.000Z"),
    });

    expect(decision).toEqual({
      ok: false,
      code: "expired",
      message: "ui action plan expired",
    });
  });

  it("rejects invalid expiration timestamps", () => {
    const decision = authorizeUiActionPlan(
      { ...basePlan, expiresAt: "tomorrow eventually" },
      { nowMs: Date.parse("2026-04-20T21:00:00.000Z") },
    );

    expect(decision).toEqual({
      ok: false,
      code: "invalid_expiration",
      message: "ui action plan expiresAt is not a valid timestamp",
    });
  });

  it("requires an explicit confirmation action for high-risk plans", () => {
    const decision = authorizeUiActionPlan(
      {
        ...basePlan,
        risk: "high",
        requiresConfirmation: true,
      },
      { nowMs: Date.parse("2026-04-20T21:00:00.000Z") },
    );

    expect(decision).toEqual({
      ok: false,
      code: "confirmation_required",
      message: "high-risk ui action plans must start with request_confirmation",
    });
  });
});
