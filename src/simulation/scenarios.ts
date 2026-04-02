import type { ApprovalSurface } from "../agents/approval-surface.js";
import {
  evaluateToolEnforcement,
  wrapToolWithEnforcement,
  type ToolExecutionResult,
} from "../agents/tool-policy-enforce.js";
import {
  buildDefaultActFirstToolPolicyMeta,
  type ResolvedToolPolicyMeta,
} from "../agents/tool-policy-pipeline.js";
import { buildAgentSystemPrompt } from "../agents/system-prompt.js";
import { createCortex } from "../consciousness/brain/cortex.js";
import { createMemoryRecallPipeline } from "../consciousness/brain/recall.js";
import { resolveTemporalRange } from "../consciousness/brain/temporal-resolver.js";
import { makeMemoryNote, type Embedder, type Hippocampus } from "../consciousness/brain/types.js";
import { detectCognitiveMode } from "../consciousness/cognitive-load.js";
import { DEFAULT_CONSCIOUSNESS_CONFIG, type WorldSnapshot } from "../consciousness/types.js";
import { runWatchdog } from "../consciousness/watchdog.js";

export type SmokeStatus = "pass" | "partial" | "fail";

export type SmokeCheck = {
  label: string;
  passed: boolean;
  detail: string;
};

export type SmokeScenarioReport = {
  id: "silence" | "act-first" | "chrono-spatial" | "cognitive-load";
  status: SmokeStatus;
  summary: string;
  checks: readonly SmokeCheck[];
  artifacts?: Record<string, unknown>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function buildResolvedMeta(toolNames: readonly string[]): ResolvedToolPolicyMeta {
  const meta =
    buildDefaultActFirstToolPolicyMeta(toolNames.map((name) => ({ name }))) ?? {};
  return {
    reversibilityScores: meta.reversibilityScore ?? {},
    requiresHuman: new Set(meta.requiresHuman ?? []),
    rateLimits: meta.rateLimits ?? {},
  };
}

function buildWorldSnapshot(
  overrides: Partial<WorldSnapshot> & Pick<WorldSnapshot, "capturedAt">,
): WorldSnapshot {
  const { capturedAt, ...rest } = overrides;
  return {
    capturedAt,
    lastUserInteractionAt: undefined,
    pendingNoteCount: 0,
    firedTriggerIds: [],
    dueCronExpressions: [],
    externalWorldEvents: [],
    activeChannelId: "telegram:owner-chat",
    activeChannelType: "telegram",
    lastTickAt: capturedAt - 60_000,
    effectiveSilenceThresholdMs: DEFAULT_CONSCIOUSNESS_CONFIG.baseSilenceThresholdMs,
    ...rest,
  };
}

export function simulateSilenceScenario(now = Date.UTC(2026, 3, 2, 9, 0, 0, 0)): SmokeScenarioReport {
  const silenceOnlySnapshot = buildWorldSnapshot({
    capturedAt: now,
    lastUserInteractionAt: now - 3 * DAY_MS,
  });
  const silenceWithCalendarSnapshot = buildWorldSnapshot({
    capturedAt: now,
    lastUserInteractionAt: now - 3 * DAY_MS,
    externalWorldEvents: ["calendar:deadline:project-delivery"],
  });

  const silenceOnlyResult = runWatchdog(silenceOnlySnapshot, DEFAULT_CONSCIOUSNESS_CONFIG);
  const silenceWithCalendarResult = runWatchdog(
    silenceWithCalendarSnapshot,
    DEFAULT_CONSCIOUSNESS_CONFIG,
  );

  return {
    id: "silence",
    status:
      silenceOnlyResult.wake &&
      silenceOnlyResult.reason === "SILENCE_THRESHOLD" &&
      silenceWithCalendarResult.wake &&
      silenceWithCalendarResult.reason === "EXTERNAL_WORLD_DELTA"
        ? "partial"
        : "fail",
    summary:
      "The watchdog definitely wakes on long silence, and the same snapshot model also wakes on calendar/external deltas. Exact proactive copy is still live-LLM dependent, so the empathy/tone of the first message is not deterministically proven here.",
    checks: [
      {
        label: "pure-3-day-silence",
        passed:
          silenceOnlyResult.wake === true && silenceOnlyResult.reason === "SILENCE_THRESHOLD",
        detail: silenceOnlyResult.wake
          ? `${silenceOnlyResult.reason}: ${silenceOnlyResult.context}`
          : "Watchdog stayed asleep on a 3-day silence snapshot.",
      },
      {
        label: "silence-plus-calendar-delta",
        passed:
          silenceWithCalendarResult.wake === true &&
          silenceWithCalendarResult.reason === "EXTERNAL_WORLD_DELTA",
        detail: silenceWithCalendarResult.wake
          ? `${silenceWithCalendarResult.reason}: ${silenceWithCalendarResult.context}`
          : "Watchdog stayed asleep when an external event was present.",
      },
      {
        label: "exact-proactive-copy",
        passed: false,
        detail:
          "The loop still generates the actual user-facing text through live proxyCall() in tick(); this harness proves wake semantics, not the final natural-language wording.",
      },
    ],
    artifacts: {
      silenceOnlyResult,
      silenceWithCalendarResult,
    },
  };
}

export async function simulateActFirstScenario(): Promise<SmokeScenarioReport> {
  const meta = buildResolvedMeta(["calendar.create", "edit", "email.send"]);
  const approvalRequests: string[] = [];
  const autoNotices: string[] = [];
  const approvalSurface: ApprovalSurface = {
    onApprovalRequest(request) {
      approvalRequests.push(`${request.toolName}:${request.confirmPrompt}`);
      return true;
    },
    onAutoExecutionNotice(notice) {
      autoNotices.push(`${notice.toolName}:${notice.summary}`);
    },
  };

  const calendarTool = wrapToolWithEnforcement(
    {
      name: "calendar.create",
      execute: async () =>
        ({
          value: { ok: true },
          summary: "Calendar event created for tomorrow 14:00",
        }) satisfies { value: { ok: boolean }; summary: string },
    },
    meta,
    { actFirstEnabled: true, approvalSurface },
  );
  const editTool = wrapToolWithEnforcement(
    {
      name: "edit",
      execute: async () =>
        ({
          value: { ok: true },
          summary: "Draft email prepared for clinic reschedule",
        }) satisfies { value: { ok: boolean }; summary: string },
    },
    meta,
    { actFirstEnabled: true, approvalSurface },
  );
  const emailTool = wrapToolWithEnforcement(
    {
      name: "email.send",
      execute: async () =>
        ({
          value: { ok: true },
          summary: "Third-party email sent",
        }) satisfies { value: { ok: boolean }; summary: string },
    },
    meta,
    { actFirstEnabled: true, approvalSurface },
  );

  const calendarDecision = evaluateToolEnforcement({
    toolName: "calendar.create",
    meta,
    actFirstEnabled: true,
  });
  const editDecision = evaluateToolEnforcement({
    toolName: "edit",
    meta,
    actFirstEnabled: true,
  });
  const emailDecision = evaluateToolEnforcement({
    toolName: "email.send",
    meta,
    actFirstEnabled: true,
  });
  const emailApprovedDecision = evaluateToolEnforcement({
    toolName: "email.send",
    meta,
    actFirstEnabled: true,
    humanApproved: true,
  });

  const calendarResult = (await calendarTool.execute()) as ToolExecutionResult<{ ok: boolean }>;
  const editResult = (await editTool.execute()) as ToolExecutionResult<{ ok: boolean }>;
  let emailError = "";
  try {
    await emailTool.execute();
  } catch (error) {
    emailError = error instanceof Error ? error.message : String(error);
  }

  return {
    id: "act-first",
    status:
      calendarDecision.mode === "auto" &&
      editDecision.mode === "confirm" &&
      emailDecision.mode === "blocked" &&
      emailApprovedDecision.mode === "auto"
        ? "pass"
        : "fail",
    summary:
      "Act-first covers the full spectrum: high-reversibility auto-executes, mid-band asks confirmation, low-reversibility blocks but unlocks on explicit human approval.",
    checks: [
      {
        label: "calendar-add-auto",
        passed: calendarDecision.mode === "auto" && calendarResult.undoAvailable === false,
        detail: `decision=${calendarDecision.mode}, summary=${calendarResult.summary}`,
      },
      {
        label: "mid-band-confirm-path-exists",
        passed:
          editDecision.mode === "confirm" &&
          editResult.summary === "Draft email prepared for clinic reschedule" &&
          approvalRequests.some((entry) => entry.startsWith("edit:")),
        detail: `decision=${editDecision.mode}, approvalRequests=${approvalRequests.length}`,
      },
      {
        label: "email-send-blocked-without-approval",
        passed:
          emailDecision.mode === "blocked" &&
          !emailDecision.allowed &&
          emailDecision.reason === "approval-required-low-reversibility",
        detail: emailError || "email.send did not throw as expected",
      },
      {
        label: "email-send-auto-with-human-approval",
        passed: emailApprovedDecision.mode === "auto" && emailApprovedDecision.allowed === true,
        detail: `decision=${emailApprovedDecision.mode}, allowed=${emailApprovedDecision.allowed}`,
      },
    ],
    artifacts: {
      reversibilityScores: meta.reversibilityScores,
      calendarDecision,
      editDecision,
      emailDecision,
      emailApprovedDecision,
      autoNotices,
      approvalRequests,
    },
  };
}

export async function simulateChronoSpatialScenario(
  now = Date.UTC(2026, 2, 19, 12, 0, 0, 0),
): Promise<SmokeScenarioReport> {
  const sessionKey = "agent:main:telegram:123";
  const cortex = createCortex(8);
  const temporalRange = resolveTemporalRange("Gecen hafta Ali ile ne konustuk?", { now });
  const lastWeekNote = makeMemoryNote({
    id: "ali-last-week",
    content: "Ali ile benchmark timeline ve teslim riskini konustuk.",
    sessionKey,
    createdAt: Date.UTC(2026, 2, 10, 14, 0, 0, 0),
  });
  const thisWeekNote = makeMemoryNote({
    id: "ali-this-week",
    content: "Ali ile bugun deployment rollback konustuk.",
    sessionKey,
    createdAt: Date.UTC(2026, 2, 18, 10, 0, 0, 0),
  });
  const oldNote = makeMemoryNote({
    id: "ali-old",
    content: "Ali ile aylar once tatil planini konustuk.",
    sessionKey,
    createdAt: Date.UTC(2025, 8, 10, 9, 0, 0, 0),
  });
  const notes = [oldNote, lastWeekNote, thisWeekNote];
  for (const note of notes) {
    cortex.stage(note);
  }

  const embedder: Embedder = {
    async embed(_text: string) {
      return [1, 0, 0];
    },
  };
  const hippocampus: Hippocampus = {
    async ingest() {},
    async recall(_queryVector, k, filter) {
      return notes
        .filter((note) => {
          if (filter?.sessionKey && note.sessionKey !== filter.sessionKey) {
            return false;
          }
          if (filter?.startTime !== undefined && note.createdAt < filter.startTime) {
            return false;
          }
          if (filter?.endTime !== undefined && note.createdAt >= filter.endTime) {
            return false;
          }
          return true;
        })
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, k);
    },
    async listByType() {
      return [];
    },
    async close() {},
  };

  const pipeline = createMemoryRecallPipeline({ cortex, embedder, hippocampus });
  const result = await pipeline.recall({
    text: "Gecen hafta Ali ile ne konustuk?",
    sessionKey,
    ...(temporalRange ? { temporalRange } : {}),
  });

  const allReturnedIds = [...result.recent, ...result.recalled].map((note) => note.id);
  const hasOnlyLastWeekNotes =
    !allReturnedIds.includes("ali-old") &&
    !allReturnedIds.includes("ali-this-week") &&
    allReturnedIds.includes("ali-last-week");

  return {
    id: "chrono-spatial",
    status:
      temporalRange !== null && hasOnlyLastWeekNotes && result.warning === undefined
        ? "pass"
        : "fail",
    summary:
      "The recall pipeline is no longer semantic-only. It resolves 'gecen hafta', pushes a createdAt filter into both Cortex and Hippocampus, and avoids surfacing older semantically similar notes from outside the requested time window.",
    checks: [
      {
        label: "temporal-expression-resolved",
        passed: temporalRange !== null,
        detail:
          temporalRange === null
            ? "Temporal resolver returned null."
            : `${temporalRange.rawExpression}: ${new Date(temporalRange.start).toISOString()} -> ${new Date(temporalRange.end).toISOString()}`,
      },
      {
        label: "time-filter-excludes-nonmatching-notes",
        passed: hasOnlyLastWeekNotes,
        detail: `returned=${allReturnedIds.join(", ") || "(none)"}`,
      },
      {
        label: "no-semantic-fallback-on-temporal-hit",
        passed: result.warning === undefined,
        detail: result.warning ?? "Temporal hit returned notes without warning.",
      },
    ],
    artifacts: {
      temporalRange,
      result,
    },
  };
}

export function simulateCognitiveLoadScenario(): SmokeScenarioReport {
  const message = "Kod patladi acil bak";
  const assessment = detectCognitiveMode(message);
  const prompt = buildAgentSystemPrompt({
    workspaceDir: "/tmp/openclaw",
    cognitiveMode: assessment.mode,
  });

  return {
    id: "cognitive-load",
    status:
      assessment.mode === "executive" &&
      prompt.includes("Current reply mode: executive.") &&
      prompt.includes("Be brief, direct, and action-first.")
        ? "partial"
        : "fail",
    summary:
      "The inbound reply path does switch into executive mode and injects shorter, action-first guidance into the agent system prompt. What is still not guaranteed is a hard 'no emoji' rule; the prompt minimizes warmth but does not explicitly ban emoji output.",
    checks: [
      {
        label: "executive-mode-detected",
        passed: assessment.mode === "executive",
        detail: `scores executive=${assessment.scores.executive}, companion=${assessment.scores.companion}`,
      },
      {
        label: "executive-guidance-in-system-prompt",
        passed:
          prompt.includes("Current reply mode: executive.") &&
          prompt.includes("Be brief, direct, and action-first."),
        detail: "getReply.ts forwards cognitiveMode into runPreparedReply -> buildAgentSystemPrompt.",
      },
      {
        label: "hard-no-emoji-rule",
        passed: false,
        detail:
          "The executive prompt tells the model to minimize warmth and extra explanation, but it does not contain an explicit emoji ban.",
      },
    ],
    artifacts: {
      assessment,
    },
  };
}

export async function runAllRuntimeSmokeScenarios(): Promise<readonly SmokeScenarioReport[]> {
  return [
    simulateSilenceScenario(),
    await simulateActFirstScenario(),
    await simulateChronoSpatialScenario(),
    simulateCognitiveLoadScenario(),
  ];
}
