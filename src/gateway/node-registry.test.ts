import { describe, expect, it, vi } from "vitest";
import { NodeRegistry } from "./node-registry.js";

describe("NodeRegistry", () => {
  it("fires the onRegister hook with the registered session", () => {
    const onRegister = vi.fn();
    const registry = new NodeRegistry({ onRegister });
    const socket = { send: vi.fn() };

    const session = registry.register(
      {
        connId: "conn-1",
        socket,
        connect: {
          client: {
            id: "android-node-1",
            platform: "android",
            version: "1.0.0",
          },
          device: {
            id: "android-node-1",
          },
          caps: [],
          commands: ["system.notify"],
        },
      } as never,
      {},
    );

    expect(onRegister).toHaveBeenCalledOnce();
    expect(onRegister).toHaveBeenCalledWith(session);
  });
});
