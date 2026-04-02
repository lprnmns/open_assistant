import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import { registerGetReplyCommonMocks } from "./get-reply.test-mocks.js";

const mocks = vi.hoisted(() => ({
  resolveReplyDirectives: vi.fn(),
  initSessionState: vi.fn(),
}));

registerGetReplyCommonMocks();

vi.mock("../../link-understanding/apply.runtime.js", () => ({
  applyLinkUnderstanding: vi.fn(async () => undefined),
}));
vi.mock("../../media-understanding/apply.runtime.js", () => ({
  applyMediaUnderstanding: vi.fn(async () => undefined),
}));
vi.mock("./get-reply-directives.js", () => ({
  resolveReplyDirectives: (...args: unknown[]) => mocks.resolveReplyDirectives(...args),
}));
vi.mock("./get-reply-inline-actions.js", () => ({
  handleInlineActions: vi.fn(async ({ directives, abortedLastRun }) => ({
    kind: "continue",
    directives,
    abortedLastRun,
  })),
}));
vi.mock("./session.js", () => ({
  initSessionState: (...args: unknown[]) => mocks.initSessionState(...args),
}));

let getReplyFromConfig: typeof import("./get-reply.js").getReplyFromConfig;
let loadConfigMock: typeof import("../../config/config.js").loadConfig;
let runPreparedReplyMock: typeof import("./get-reply-run.js").runPreparedReply;

async function loadFreshGetReplyModuleForTest() {
  vi.resetModules();
  ({ getReplyFromConfig } = await import("./get-reply.js"));
  ({ loadConfig: loadConfigMock } = await import("../../config/config.js"));
  ({ runPreparedReply: runPreparedReplyMock } = await import("./get-reply-run.js"));
}

function buildCtx(body: string): MsgContext {
  return {
    Provider: "telegram",
    Surface: "telegram",
    ChatType: "direct",
    Body: body,
    BodyForAgent: body,
    RawBody: body,
    CommandBody: body,
    SessionKey: "agent:main:telegram:123",
    From: "telegram:user:42",
    To: "telegram:123",
    Timestamp: 1710000000000,
  };
}

function buildDirectiveResult() {
  return {
    kind: "continue",
    result: {
      commandSource: "",
      command: {
        isAuthorizedSender: true,
        abortKey: "agent:main:telegram:123",
        ownerList: [],
        senderIsOwner: false,
        rawBodyNormalized: "",
        commandBodyNormalized: "",
      },
      allowTextCommands: true,
      skillCommands: [],
      directives: {
        hasThinkDirective: false,
        thinkLevel: undefined,
      },
      cleanedBody: "",
      elevatedEnabled: false,
      elevatedAllowed: false,
      elevatedFailures: [],
      defaultActivation: "always",
      resolvedThinkLevel: "medium",
      resolvedVerboseLevel: "off",
      resolvedReasoningLevel: "off",
      resolvedElevatedLevel: "off",
      execOverrides: undefined,
      blockStreamingEnabled: false,
      blockReplyChunking: undefined,
      resolvedBlockStreamingBreak: "message_end",
      provider: "openai",
      model: "gpt-4o-mini",
      modelState: {
        resolveDefaultThinkingLevel: async () => "medium",
      },
      contextTokens: 0,
      inlineStatusRequested: false,
      directiveAck: undefined,
      perMessageQueueMode: undefined,
      perMessageQueueOptions: undefined,
    },
  } as const;
}

describe("getReplyFromConfig cognitive mode integration", () => {
  beforeEach(async () => {
    await loadFreshGetReplyModuleForTest();
    mocks.resolveReplyDirectives.mockReset();
    mocks.initSessionState.mockReset();
    vi.mocked(runPreparedReplyMock).mockReset();
    vi.mocked(loadConfigMock).mockReset();

    vi.mocked(loadConfigMock).mockReturnValue({} as OpenClawConfig);
    mocks.resolveReplyDirectives.mockResolvedValue(buildDirectiveResult());
    vi.mocked(runPreparedReplyMock).mockResolvedValue({ text: "ok" });
    mocks.initSessionState.mockResolvedValue({
      sessionCtx: {
        Body: "",
        BodyStripped: "",
        Provider: "telegram",
        ChatType: "direct",
      },
      sessionEntry: {},
      previousSessionEntry: {},
      sessionStore: {},
      sessionKey: "agent:main:telegram:123",
      sessionId: "session-1",
      isNewSession: false,
      resetTriggered: false,
      systemSent: false,
      abortedLastRun: false,
      storePath: "/tmp/sessions.json",
      sessionScope: "per-chat",
      groupResolution: undefined,
      isGroup: false,
      triggerBodyNormalized: "",
      bodyStripped: "",
    });
  });

  it("detects executive mode for terse urgent messages", async () => {
    await getReplyFromConfig(buildCtx("kod patladi loglara bak acil"));

    const call = vi.mocked(runPreparedReplyMock).mock.calls[0]?.[0] as
      | { cognitiveMode?: string }
      | undefined;
    expect(call?.cognitiveMode).toBe("executive");
  });

  it("detects companion mode for reflective questions", async () => {
    await getReplyFromConfig(
      buildCtx("Bunu birlikte dusunelim, sence neden boyle oldu ve sonraki adim ne olmali?"),
    );

    const call = vi.mocked(runPreparedReplyMock).mock.calls[0]?.[0] as
      | { cognitiveMode?: string }
      | undefined;
    expect(call?.cognitiveMode).toBe("companion");
  });
});
