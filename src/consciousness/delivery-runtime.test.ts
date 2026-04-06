import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getConsciousnessDeliveryTargetSender,
  setConsciousnessDeliveryTargetSender,
} from "./delivery-runtime.js";

describe("delivery-runtime", () => {
  afterEach(() => {
    setConsciousnessDeliveryTargetSender(null);
  });

  it("stores and returns the active delivery target sender", () => {
    const sender = vi.fn(async () => {});
    setConsciousnessDeliveryTargetSender(sender);

    expect(getConsciousnessDeliveryTargetSender()).toBe(sender);
  });

  it("clears the active delivery target sender", () => {
    setConsciousnessDeliveryTargetSender(vi.fn(async () => {}));
    setConsciousnessDeliveryTargetSender(null);

    expect(getConsciousnessDeliveryTargetSender()).toBeNull();
  });
});
