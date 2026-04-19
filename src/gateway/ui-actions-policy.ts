import {
  formatValidationErrors,
  type UiActionPlan,
  validateUiActionPlan,
} from "./protocol/index.js";

export type UiActionPlanPolicyOptions = {
  nowMs: number;
};

export type UiActionPlanPolicyDecision =
  | { ok: true; plan: UiActionPlan }
  | {
      ok: false;
      code: "invalid_schema" | "invalid_expiration" | "expired" | "confirmation_required";
      message: string;
    };

function hasLeadingConfirmationAction(plan: UiActionPlan): boolean {
  return plan.actions[0]?.action === "request_confirmation";
}

function validateExpiration(
  expiresAt: string | undefined,
  nowMs: number,
): UiActionPlanPolicyDecision | null {
  if (!expiresAt) {
    return null;
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return {
      ok: false,
      code: "invalid_expiration",
      message: "ui action plan expiresAt is not a valid timestamp",
    };
  }
  if (expiresAtMs <= nowMs) {
    return { ok: false, code: "expired", message: "ui action plan expired" };
  }
  return null;
}

export function authorizeUiActionPlan(
  candidate: unknown,
  options: UiActionPlanPolicyOptions,
): UiActionPlanPolicyDecision {
  if (!validateUiActionPlan(candidate)) {
    return {
      ok: false,
      code: "invalid_schema",
      message: formatValidationErrors(validateUiActionPlan.errors),
    };
  }

  const plan = candidate;
  const expirationDecision = validateExpiration(plan.expiresAt, options.nowMs);
  if (expirationDecision) {
    return expirationDecision;
  }

  if (plan.risk === "high" && (!plan.requiresConfirmation || !hasLeadingConfirmationAction(plan))) {
    return {
      ok: false,
      code: "confirmation_required",
      message: "high-risk ui action plans must start with request_confirmation",
    };
  }

  return { ok: true, plan };
}
