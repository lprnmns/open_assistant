import { randomUUID } from "node:crypto";
import type { NodeInvokeResult, NodeSession } from "../node-registry.js";
import {
  ErrorCodes,
  errorShape,
  type UiAction,
  type UiActionPlan,
  type UiActionRisk,
  type UiTaskRunParams,
  validateUiTaskRunParams,
} from "../protocol/index.js";
import { authorizeUiActionPlan } from "../ui-actions-policy.js";
import { respondInvalidParams, safeParseJson } from "./nodes.helpers.js";
import type { GatewayRequestContext, GatewayRequestHandlers, RespondFn } from "./types.js";

type UiTaskStep = {
  stage: "observe" | "execute";
  ok: boolean;
  payload?: unknown;
  error?: NodeInvokeResult["error"];
};

const UI_ACTION_COMMAND = "ui.actions.execute";
const DEFAULT_MAX_STEPS = 3;
const OBSERVE_ACTION = { action: "observe_screen" } satisfies UiAction;

function isUiControlNode(node: NodeSession): boolean {
  return node.caps.includes("uiControl") && node.commands.includes(UI_ACTION_COMMAND);
}

function resolveUiControlNode(params: {
  nodes: NodeSession[];
  requestedNodeId?: string;
}):
  | { ok: true; node: NodeSession }
  | { ok: false; code: typeof ErrorCodes.INVALID_REQUEST | typeof ErrorCodes.UNAVAILABLE; message: string } {
  if (params.requestedNodeId) {
    const node = params.nodes.find((entry) => entry.nodeId === params.requestedNodeId);
    if (!node) {
      return {
        ok: false,
        code: ErrorCodes.UNAVAILABLE,
        message: `requested UI-control node is not connected: ${params.requestedNodeId}`,
      };
    }
    if (!isUiControlNode(node)) {
      return {
        ok: false,
        code: ErrorCodes.INVALID_REQUEST,
        message: `requested node does not support ${UI_ACTION_COMMAND}: ${params.requestedNodeId}`,
      };
    }
    return { ok: true, node };
  }

  const candidates = params.nodes.filter(isUiControlNode);
  if (candidates.length === 0) {
    return {
      ok: false,
      code: ErrorCodes.UNAVAILABLE,
      message: "no connected UI-control node supports ui.actions.execute",
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      code: ErrorCodes.INVALID_REQUEST,
      message: "multiple UI-control nodes are connected; provide nodeId",
    };
  }
  return { ok: true, node: candidates[0] };
}

function buildUiActionPlan(params: {
  taskId: string;
  stage: UiTaskStep["stage"];
  nodeId: string;
  idempotencyKey: string;
  risk: UiActionRisk;
  requiresConfirmation: boolean;
  actions: UiAction[];
}): UiActionPlan {
  return {
    kind: "ui_actions",
    planId: `${params.taskId}:${params.stage}`,
    targetDeviceId: params.nodeId,
    idempotencyKey: `${params.idempotencyKey}:${params.stage}`,
    risk: params.risk,
    requiresConfirmation: params.requiresConfirmation,
    actions: params.actions,
  };
}

function parseInvokePayload(result: NodeInvokeResult): unknown {
  if (typeof result.payloadJSON === "string") {
    return safeParseJson(result.payloadJSON);
  }
  return result.payload ?? null;
}

async function invokeUiPlan(params: {
  nodeRegistry: GatewayRequestContext["nodeRegistry"];
  node: NodeSession;
  plan: UiActionPlan;
  respond: RespondFn;
  stage: UiTaskStep["stage"];
}): Promise<UiTaskStep | null> {
  const authorization = authorizeUiActionPlan(params.plan, { nowMs: Date.now() });
  if (!authorization.ok) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, authorization.message, {
        details: { stage: params.stage, code: authorization.code },
      }),
    );
    return null;
  }

  const result = await params.nodeRegistry.invoke({
    nodeId: params.node.nodeId,
    command: UI_ACTION_COMMAND,
    params: params.plan,
    timeoutMs: 30_000,
    idempotencyKey: params.plan.idempotencyKey,
  });
  if (!result.ok) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.UNAVAILABLE,
        result.error?.message ?? `${UI_ACTION_COMMAND} failed during ${params.stage}`,
        {
          details: { stage: params.stage, nodeError: result.error ?? null },
        },
      ),
    );
    return null;
  }

  return {
    stage: params.stage,
    ok: true,
    payload: parseInvokePayload(result),
  };
}

export const uiTaskHandlers: GatewayRequestHandlers = {
  "ui.task.run": async ({ params, respond, context }) => {
    if (!validateUiTaskRunParams(params)) {
      respondInvalidParams({ respond, method: "ui.task.run", validator: validateUiTaskRunParams });
      return;
    }

    const task = params as UiTaskRunParams;
    const resolution = resolveUiControlNode({
      nodes: context.nodeRegistry.listConnected(),
      requestedNodeId: task.nodeId,
    });
    if (!resolution.ok) {
      respond(false, undefined, errorShape(resolution.code, resolution.message));
      return;
    }

    const taskId = `ui_task_${randomUUID()}`;
    const maxSteps = task.maxSteps ?? DEFAULT_MAX_STEPS;
    const idempotencyKey = task.idempotencyKey ?? randomUUID();
    const risk = task.risk ?? "low";
    const requiresConfirmation = task.requiresConfirmation ?? risk === "high";
    const observePlan = buildUiActionPlan({
      taskId,
      stage: "observe",
      nodeId: resolution.node.nodeId,
      idempotencyKey,
      risk: "low",
      requiresConfirmation: false,
      actions: [OBSERVE_ACTION],
    });
    const executePlan = task.actions
      ? buildUiActionPlan({
          taskId,
          stage: "execute",
          nodeId: resolution.node.nodeId,
          idempotencyKey,
          risk,
          requiresConfirmation,
          actions: [...task.actions, OBSERVE_ACTION],
        })
      : null;

    if (task.dryRun) {
      respond(true, {
        status: "dry_run",
        taskId,
        objective: task.objective,
        nodeId: resolution.node.nodeId,
        maxSteps,
        planned: executePlan ? [observePlan, executePlan] : [observePlan],
      });
      return;
    }

    const steps: UiTaskStep[] = [];
    const observeStep = await invokeUiPlan({
      nodeRegistry: context.nodeRegistry,
      node: resolution.node,
      plan: observePlan,
      respond,
      stage: "observe",
    });
    if (!observeStep) {
      return;
    }
    steps.push(observeStep);

    if (executePlan) {
      const executeStep = await invokeUiPlan({
        nodeRegistry: context.nodeRegistry,
        node: resolution.node,
        plan: executePlan,
        respond,
        stage: "execute",
      });
      if (!executeStep) {
        return;
      }
      steps.push(executeStep);
    }

    respond(true, {
      status: executePlan ? "completed" : "needs_plan",
      taskId,
      objective: task.objective,
      nodeId: resolution.node.nodeId,
      maxSteps,
      steps,
    });
  },
};
