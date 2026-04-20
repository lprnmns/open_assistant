import { describe, expect, it, vi } from "vitest";
import type { NodeSession } from "../node-registry.js";
import type { GatewayRequestContext, RespondFn } from "./types.js";
import { uiTaskHandlers } from "./ui-task.js";

function androidUiNode(overrides: Partial<NodeSession> = {}): NodeSession {
  return {
    nodeId: "phone-1",
    connId: "conn-1",
    client: {} as NodeSession["client"],
    platform: "android",
    caps: ["uiControl"],
    commands: ["ui.actions.execute"],
    connectedAtMs: 1,
    ...overrides,
  };
}

function createFixture(params?: {
  nodes?: NodeSession[];
  invokeResults?: Array<{ ok: boolean; payloadJSON?: string; error?: { code?: string; message?: string } }>;
}) {
  const responses: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond: RespondFn = (ok, payload, error) => {
    responses.push({ ok, payload, error });
  };
  const invoke = vi.fn(async () => {
    const next = params?.invokeResults?.shift();
    return (
      next ?? {
        ok: true,
        payloadJSON:
          '{"status":"completed","observations":["OpenClaw"],"observedNodes":[{"nodeRef":"o1n1","text":"Settings"}]}',
      }
    );
  });
  const context = {
    nodeRegistry: {
      listConnected: () => params?.nodes ?? [androidUiNode()],
      invoke,
    },
  } as unknown as GatewayRequestContext;
  return { context, respond, responses, invoke };
}

async function runUiTask(
  fixture: ReturnType<typeof createFixture>,
  params: Record<string, unknown>,
) {
  await uiTaskHandlers["ui.task.run"]({
    req: { id: "req-1", method: "ui.task.run", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: fixture.respond,
    context: fixture.context,
  });
}

describe("ui.task.run", () => {
  it("observes the sole UI-control node and returns needs_plan when no actions are supplied", async () => {
    const fixture = createFixture();

    await runUiTask(fixture, { objective: "Open settings" });

    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    expect(fixture.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "phone-1",
        command: "ui.actions.execute",
        params: expect.objectContaining({
          kind: "ui_actions",
          targetDeviceId: "phone-1",
          actions: [{ action: "observe_screen" }],
        }),
      }),
    );
    expect(fixture.responses).toHaveLength(1);
    expect(fixture.responses[0]?.ok).toBe(true);
    expect(fixture.responses[0]?.payload).toMatchObject({
      status: "needs_plan",
      objective: "Open settings",
      nodeId: "phone-1",
      steps: [
        {
          stage: "observe",
          ok: true,
          payload: {
            observations: ["OpenClaw"],
            observedNodes: [{ nodeRef: "o1n1", text: "Settings" }],
          },
        },
      ],
    });
  });

  it("runs supplied actions and appends a post-action observe step", async () => {
    const fixture = createFixture();

    await runUiTask(fixture, {
      objective: "Open settings",
      actions: [{ action: "click_node", text: "Settings" }],
    });

    expect(fixture.invoke).toHaveBeenCalledTimes(2);
    expect(fixture.invoke).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nodeId: "phone-1",
        command: "ui.actions.execute",
        params: expect.objectContaining({
          actions: [{ action: "click_node", text: "Settings" }, { action: "observe_screen" }],
        }),
      }),
    );
    expect(fixture.responses[0]?.ok).toBe(true);
    expect(fixture.responses[0]?.payload).toMatchObject({
      status: "completed",
      objective: "Open settings",
      nodeId: "phone-1",
      steps: [{ stage: "observe" }, { stage: "execute" }],
    });
  });

  it("requires a node id when multiple UI-control nodes are connected", async () => {
    const fixture = createFixture({
      nodes: [androidUiNode({ nodeId: "phone-1" }), androidUiNode({ nodeId: "phone-2" })],
    });

    await runUiTask(fixture, { objective: "Open settings" });

    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(fixture.responses[0]?.ok).toBe(false);
    expect(fixture.responses[0]?.error).toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("multiple UI-control nodes"),
    });
  });
});
