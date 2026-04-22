import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMocks = vi.hoisted(() => ({
  callGatewayTool: vi.fn(),
  readGatewayCallOptions: vi.fn(() => ({})),
}));

const nodeUtilsMocks = vi.hoisted(() => ({
  resolveNodeId: vi.fn(async () => "node-1"),
  resolveNode: vi.fn(async () => ({ nodeId: "node-1", remoteIp: "127.0.0.1" })),
  listNodes: vi.fn(async () => [] as Array<{ nodeId: string; commands?: string[] }>),
  resolveNodeIdFromList: vi.fn(() => "node-1"),
}));

const nodesCameraMocks = vi.hoisted(() => ({
  cameraTempPath: vi.fn(({ facing }: { facing?: string }) =>
    facing ? `/tmp/camera-${facing}.jpg` : "/tmp/camera.jpg",
  ),
  parseCameraClipPayload: vi.fn(),
  parseCameraSnapPayload: vi.fn(() => ({
    base64: "ZmFrZQ==",
    format: "jpg",
    width: 800,
    height: 600,
  })),
  writeCameraClipPayloadToFile: vi.fn(),
  writeCameraPayloadToFile: vi.fn(async () => undefined),
}));

const screenMocks = vi.hoisted(() => ({
  parseScreenRecordPayload: vi.fn(() => ({
    base64: "ZmFrZQ==",
    format: "mp4",
    durationMs: 300_000,
    fps: 10,
    screenIndex: 0,
    hasAudio: true,
  })),
  screenRecordTempPath: vi.fn(() => "/tmp/screen-record.mp4"),
  writeScreenRecordToFile: vi.fn(async () => ({ path: "/tmp/screen-record.mp4" })),
}));

vi.mock("./gateway.js", () => ({
  callGatewayTool: gatewayMocks.callGatewayTool,
  readGatewayCallOptions: gatewayMocks.readGatewayCallOptions,
}));

vi.mock("./nodes-utils.js", () => ({
  resolveNodeId: nodeUtilsMocks.resolveNodeId,
  resolveNode: nodeUtilsMocks.resolveNode,
  listNodes: nodeUtilsMocks.listNodes,
  resolveNodeIdFromList: nodeUtilsMocks.resolveNodeIdFromList,
}));

vi.mock("../../cli/nodes-camera.js", () => ({
  cameraTempPath: nodesCameraMocks.cameraTempPath,
  parseCameraClipPayload: nodesCameraMocks.parseCameraClipPayload,
  parseCameraSnapPayload: nodesCameraMocks.parseCameraSnapPayload,
  writeCameraClipPayloadToFile: nodesCameraMocks.writeCameraClipPayloadToFile,
  writeCameraPayloadToFile: nodesCameraMocks.writeCameraPayloadToFile,
}));

vi.mock("../../cli/nodes-screen.js", () => ({
  parseScreenRecordPayload: screenMocks.parseScreenRecordPayload,
  screenRecordTempPath: screenMocks.screenRecordTempPath,
  writeScreenRecordToFile: screenMocks.writeScreenRecordToFile,
}));

let createNodesTool: typeof import("./nodes-tool.js").createNodesTool;

async function loadFreshNodesToolModuleForTest() {
  vi.resetModules();
  vi.doMock("./gateway.js", () => ({
    callGatewayTool: gatewayMocks.callGatewayTool,
    readGatewayCallOptions: gatewayMocks.readGatewayCallOptions,
  }));
  vi.doMock("./nodes-utils.js", () => ({
    resolveNodeId: nodeUtilsMocks.resolveNodeId,
    resolveNode: nodeUtilsMocks.resolveNode,
    listNodes: nodeUtilsMocks.listNodes,
    resolveNodeIdFromList: nodeUtilsMocks.resolveNodeIdFromList,
  }));
  vi.doMock("../../cli/nodes-camera.js", () => ({
    cameraTempPath: nodesCameraMocks.cameraTempPath,
    parseCameraClipPayload: nodesCameraMocks.parseCameraClipPayload,
    parseCameraSnapPayload: nodesCameraMocks.parseCameraSnapPayload,
    writeCameraClipPayloadToFile: nodesCameraMocks.writeCameraClipPayloadToFile,
    writeCameraPayloadToFile: nodesCameraMocks.writeCameraPayloadToFile,
  }));
  vi.doMock("../../cli/nodes-screen.js", () => ({
    parseScreenRecordPayload: screenMocks.parseScreenRecordPayload,
    screenRecordTempPath: screenMocks.screenRecordTempPath,
    writeScreenRecordToFile: screenMocks.writeScreenRecordToFile,
  }));
  ({ createNodesTool } = await import("./nodes-tool.js"));
}

describe("createNodesTool screen_record duration guardrails", () => {
  beforeEach(async () => {
    gatewayMocks.callGatewayTool.mockReset();
    gatewayMocks.readGatewayCallOptions.mockReset();
    gatewayMocks.readGatewayCallOptions.mockReturnValue({});
    nodeUtilsMocks.resolveNodeId.mockClear();
    nodeUtilsMocks.resolveNode.mockClear();
    nodeUtilsMocks.listNodes.mockReset();
    nodeUtilsMocks.listNodes.mockResolvedValue([]);
    nodeUtilsMocks.resolveNodeIdFromList.mockClear();
    screenMocks.parseScreenRecordPayload.mockClear();
    screenMocks.writeScreenRecordToFile.mockClear();
    nodesCameraMocks.cameraTempPath.mockClear();
    nodesCameraMocks.parseCameraSnapPayload.mockClear();
    nodesCameraMocks.writeCameraPayloadToFile.mockClear();
    await loadFreshNodesToolModuleForTest();
  });

  it("marks nodes as owner-only", () => {
    const tool = createNodesTool();
    expect(tool.ownerOnly).toBe(true);
  });

  it("documents auto node selection in the tool description", () => {
    const tool = createNodesTool();
    expect(tool.description).toContain('invokeCommand="calendar.add"');
    expect(tool.description).toContain('invokeCommand="ui.actions.execute"');
    expect(tool.description).toContain('action="ui_task"');
    expect(tool.description).toContain("exactly one capable node");
    expect(tool.description).toContain("calendarCandidate.toolInput");
    expect(tool.description).toContain("browser automation");
    expect(tool.description).toContain("Structured UI Action plan");
    expect(tool.description).toContain("node_ref");
    expect(tool.description).toContain("tap_point");
    expect(tool.description).toContain("home");
    expect(tool.description).toContain("recents");
    expect(tool.description).toContain("quick_settings");
    expect(tool.description).toContain("ime_enter");
    expect(tool.description).toContain("type_text");
    expect(tool.description).toContain("id/content_desc/node_ref");
    expect(tool.description).toContain("long_click_node");
  });

  it("auto-selects the sole calendar-capable node for calendar.add invoke", async () => {
    gatewayMocks.callGatewayTool.mockResolvedValue({ ok: true });
    nodeUtilsMocks.listNodes.mockResolvedValue([
      {
        nodeId: "phone-1",
        commands: ["calendar.add"],
      },
    ]);
    const tool = createNodesTool();

    await tool.execute("call-1", {
      action: "invoke",
      invokeCommand: "calendar.add",
      invokeParamsJson:
        '{"title":"Team sync","startISO":"2026-04-21T07:00:00.000Z","endISO":"2026-04-21T08:00:00.000Z"}',
    });

    expect(nodeUtilsMocks.resolveNodeId).not.toHaveBeenCalled();
    expect(nodeUtilsMocks.listNodes).toHaveBeenCalledTimes(1);
    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "node.invoke",
      {},
      expect.objectContaining({
        nodeId: "phone-1",
        command: "calendar.add",
        params: {
          title: "Team sync",
          startISO: "2026-04-21T07:00:00.000Z",
          endISO: "2026-04-21T08:00:00.000Z",
        },
      }),
    );
  });

  it("requires node for calendar.add invoke when multiple calendar-capable nodes are available", async () => {
    nodeUtilsMocks.listNodes.mockResolvedValue([
      {
        nodeId: "phone-1",
        commands: ["calendar.add"],
      },
      {
        nodeId: "phone-2",
        commands: ["calendar.add"],
      },
    ]);
    const tool = createNodesTool();

    await expect(
      tool.execute("call-1", {
        action: "invoke",
        invokeCommand: "calendar.add",
      }),
    ).rejects.toThrow(
      'node required for invokeCommand "calendar.add" (multiple calendar-capable nodes available)',
    );
    expect(gatewayMocks.callGatewayTool).not.toHaveBeenCalled();
  });

  it("auto-selects the sole ui-control node for ui.actions.execute invoke", async () => {
    gatewayMocks.callGatewayTool.mockResolvedValue({ ok: true });
    nodeUtilsMocks.listNodes.mockResolvedValue([
      {
        nodeId: "phone-1",
        commands: ["ui.actions.execute"],
      },
    ]);
    const tool = createNodesTool();

    await tool.execute("call-1", {
      action: "invoke",
      invokeCommand: "ui.actions.execute",
      invokeParamsJson:
        '{"kind":"ui_actions","planId":"plan-1","targetDeviceId":"phone-1","idempotencyKey":"idem-1","risk":"medium","requiresConfirmation":false,"actions":[{"action":"open_app","target":"com.instagram.android"}]}',
    });

    expect(nodeUtilsMocks.resolveNodeId).not.toHaveBeenCalled();
    expect(nodeUtilsMocks.listNodes).toHaveBeenCalledTimes(1);
    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "node.invoke",
      {},
      expect.objectContaining({
        nodeId: "phone-1",
        command: "ui.actions.execute",
        params: {
          kind: "ui_actions",
          planId: "plan-1",
          targetDeviceId: "phone-1",
          idempotencyKey: "idem-1",
          risk: "medium",
          requiresConfirmation: false,
          actions: [{ action: "open_app", target: "com.instagram.android" }],
        },
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("runs a UI task through the gateway closed-loop task runner", async () => {
    gatewayMocks.callGatewayTool.mockResolvedValue({
      status: "needs_plan",
      steps: [
        { stage: "observe", payload: { observedNodes: [{ nodeRef: "o1n1", text: "Search" }] } },
      ],
    });
    const tool = createNodesTool();

    const result = await tool.execute("call-1", {
      action: "ui_task",
      objective: "Open Instagram and search Ali",
      maxSteps: 4,
      uiTaskActionsJson: '[{"action":"open_app","target":"com.instagram.android"}]',
    });

    expect(nodeUtilsMocks.resolveNodeId).not.toHaveBeenCalled();
    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "ui.task.run",
      {},
      {
        objective: "Open Instagram and search Ali",
        maxSteps: 4,
        actions: [{ action: "open_app", target: "com.instagram.android" }],
      },
    );
    expect(String(result.content?.[0]?.text)).toContain("needs_plan");
    expect(String(result.content?.[0]?.text)).toContain("observedNodes");
    expect(String(result.content?.[0]?.text)).toContain("uiTaskActionsJson");
  });

  it("resolves node query for UI task runs when node is supplied", async () => {
    gatewayMocks.callGatewayTool.mockResolvedValue({ status: "needs_plan" });
    nodeUtilsMocks.resolveNodeId.mockResolvedValueOnce("phone-1");
    const tool = createNodesTool();

    await tool.execute("call-1", {
      action: "ui_task",
      node: "Redmi",
      objective: "Observe screen",
    });

    expect(nodeUtilsMocks.resolveNodeId).toHaveBeenCalledWith({}, "Redmi");
    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "ui.task.run",
      {},
      {
        objective: "Observe screen",
        nodeId: "phone-1",
      },
    );
  });

  it("caps durationMs schema at 300000", () => {
    const tool = createNodesTool();
    const schema = tool.parameters as {
      properties?: {
        durationMs?: {
          maximum?: number;
        };
      };
    };
    expect(schema.properties?.durationMs?.maximum).toBe(300_000);
  });

  it("clamps screen_record durationMs argument to 300000 before gateway invoke", async () => {
    gatewayMocks.callGatewayTool.mockResolvedValue({ payload: { ok: true } });
    const tool = createNodesTool();

    await tool.execute("call-1", {
      action: "screen_record",
      node: "macbook",
      durationMs: 900_000,
    });

    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "node.invoke",
      {},
      expect.objectContaining({
        params: expect.objectContaining({
          durationMs: 300_000,
        }),
      }),
    );
  });

  it("omits rawCommand when preparing wrapped argv execution", async () => {
    nodeUtilsMocks.listNodes.mockResolvedValue([
      {
        nodeId: "node-1",
        commands: ["system.run"],
      },
    ]);
    gatewayMocks.callGatewayTool.mockImplementation(async (_method, _opts, payload) => {
      if (payload?.command === "system.run.prepare") {
        return {
          payload: {
            plan: {
              argv: ["bash", "-lc", "echo hi"],
              cwd: null,
              commandText: 'bash -lc "echo hi"',
              commandPreview: "echo hi",
              agentId: null,
              sessionKey: null,
            },
          },
        };
      }
      if (payload?.command === "system.run") {
        return { payload: { ok: true } };
      }
      throw new Error(`unexpected command: ${String(payload?.command)}`);
    });
    const tool = createNodesTool();

    await tool.execute("call-1", {
      action: "run",
      node: "macbook",
      command: ["bash", "-lc", "echo hi"],
    });

    const prepareCall = gatewayMocks.callGatewayTool.mock.calls.find(
      (call) => call[2]?.command === "system.run.prepare",
    )?.[2];
    expect(prepareCall).toBeTruthy();
    expect(prepareCall?.params).toMatchObject({
      command: ["bash", "-lc", "echo hi"],
      agentId: "main",
    });
    expect(prepareCall?.params).not.toHaveProperty("rawCommand");
  });
  it("returns camera snaps via details.media.mediaUrls", async () => {
    gatewayMocks.callGatewayTool.mockResolvedValue({ payload: { ok: true } });
    const tool = createNodesTool();

    const result = await tool.execute("call-1", {
      action: "camera_snap",
      node: "macbook",
      facing: "front",
    });

    expect(result?.details).toEqual({
      snaps: [
        {
          facing: "front",
          path: "/tmp/camera-front.jpg",
          width: 800,
          height: 600,
        },
      ],
      media: {
        mediaUrls: ["/tmp/camera-front.jpg"],
      },
    });
    expect(JSON.stringify(result?.content ?? [])).not.toContain("MEDIA:");
  });

  it("returns latest photos via details.media.mediaUrls", async () => {
    gatewayMocks.callGatewayTool.mockResolvedValue({
      payload: {
        photos: [
          { base64: "ZmFrZQ==", format: "jpg", width: 800, height: 600, createdAt: "now" },
          { base64: "YmFy", format: "jpg", width: 1024, height: 768 },
        ],
      },
    });
    nodesCameraMocks.cameraTempPath
      .mockReturnValueOnce("/tmp/photo-1.jpg")
      .mockReturnValueOnce("/tmp/photo-2.jpg");
    nodesCameraMocks.parseCameraSnapPayload
      .mockReturnValueOnce({
        base64: "ZmFrZQ==",
        format: "jpg",
        width: 800,
        height: 600,
      })
      .mockReturnValueOnce({
        base64: "YmFy",
        format: "jpg",
        width: 1024,
        height: 768,
      });
    const tool = createNodesTool();

    const result = await tool.execute("call-1", {
      action: "photos_latest",
      node: "macbook",
    });

    expect(result?.details).toEqual({
      photos: [
        {
          index: 0,
          path: "/tmp/photo-1.jpg",
          width: 800,
          height: 600,
          createdAt: "now",
        },
        {
          index: 1,
          path: "/tmp/photo-2.jpg",
          width: 1024,
          height: 768,
        },
      ],
      media: {
        mediaUrls: ["/tmp/photo-1.jpg", "/tmp/photo-2.jpg"],
      },
    });
    expect(JSON.stringify(result?.content ?? [])).not.toContain("MEDIA:");
  });
});
