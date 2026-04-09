import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveUserConsciousnessDbPath } from "../accounts/user-dir.js";
import { __resetConsciousnessRuntimesForTest, getConsciousnessRuntime } from "../consciousness/runtime.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  ensureGatewayConsciousnessRuntime,
  resolveGatewayConsciousnessRuntimeScope,
} from "./account-consciousness-scope.js";
import type { GatewayClient } from "./server-methods/types.js";

afterEach(async () => {
  await __resetConsciousnessRuntimesForTest();
});

describe("account consciousness scope", () => {
  it("returns undefined when the client has no account user", () => {
    expect(resolveGatewayConsciousnessRuntimeScope(null)).toBeUndefined();
    expect(resolveGatewayConsciousnessRuntimeScope({} as GatewayClient)).toBeUndefined();
  });

  it("creates and caches a scoped runtime per account user", async () => {
    const brainA = { close: vi.fn() } as never;
    const brainB = { close: vi.fn() } as never;
    const createProductionBrain = vi
      .fn()
      .mockResolvedValueOnce(brainA)
      .mockResolvedValueOnce(brainB);
    const cfg = {} as OpenClawConfig;
    const clientA = { internal: { accountUserId: "user-a" } } as GatewayClient;
    const clientB = { internal: { accountUserId: "user-b" } } as GatewayClient;

    const scopeA = await ensureGatewayConsciousnessRuntime({
      client: clientA,
      cfg,
      createProductionBrain,
    });
    const secondScopeA = await ensureGatewayConsciousnessRuntime({
      client: clientA,
      cfg,
      createProductionBrain,
    });
    const scopeB = await ensureGatewayConsciousnessRuntime({
      client: clientB,
      cfg,
      createProductionBrain,
    });

    expect(scopeA).toBe("account:user-a");
    expect(secondScopeA).toBe("account:user-a");
    expect(scopeB).toBe("account:user-b");
    expect(createProductionBrain).toHaveBeenCalledTimes(2);
    expect(createProductionBrain).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dbPath: resolveUserConsciousnessDbPath("user-a"),
        sessionKey: "consciousness-account:user-a",
      }),
    );
    expect(createProductionBrain).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        dbPath: resolveUserConsciousnessDbPath("user-b"),
        sessionKey: "consciousness-account:user-b",
      }),
    );
    expect(getConsciousnessRuntime("account:user-a")?.brain).toBe(brainA);
    expect(getConsciousnessRuntime("account:user-b")?.brain).toBe(brainB);
  });
});
