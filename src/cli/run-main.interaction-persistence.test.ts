import { beforeEach, describe, expect, it, vi } from "vitest";

const tryRouteCliMock = vi.hoisted(() => vi.fn());
const loadDotEnvMock = vi.hoisted(() => vi.fn());
const normalizeEnvMock = vi.hoisted(() => vi.fn());
const ensurePathMock = vi.hoisted(() => vi.fn());
const assertRuntimeMock = vi.hoisted(() => vi.fn());
const enableConsoleCaptureMock = vi.hoisted(() => vi.fn());
const closeAllMemorySearchManagersMock = vi.hoisted(() => vi.fn(async () => {}));
const maybeStartInteractionPersistenceMock = vi.hoisted(() => vi.fn());
const maybeStartConsciousnessLoopMock = vi.hoisted(() => vi.fn(async () => null));
const buildProgramMock = vi.hoisted(() => vi.fn());
const installUnhandledRejectionHandlerMock = vi.hoisted(() => vi.fn());
const getProgramContextMock = vi.hoisted(() => vi.fn(() => null));
const registerCoreCliByNameMock = vi.hoisted(() => vi.fn(async () => {}));
const registerSubCliByNameMock = vi.hoisted(() => vi.fn(async () => {}));
const maybeRunCliInContainerMock = vi.hoisted(() =>
  vi.fn<
    (argv: string[]) => { handled: true; exitCode: number } | { handled: false; argv: string[] }
  >((argv: string[]) => ({ handled: false, argv })),
);

vi.mock("./route.js", () => ({
  tryRouteCli: tryRouteCliMock,
}));

vi.mock("./container-target.js", () => ({
  maybeRunCliInContainer: maybeRunCliInContainerMock,
  parseCliContainerArgs: (argv: string[]) => ({ ok: true, container: null, argv }),
}));

vi.mock("./dotenv.js", () => ({
  loadCliDotEnv: loadDotEnvMock,
}));

vi.mock("../infra/env.js", () => ({
  normalizeEnv: normalizeEnvMock,
}));

vi.mock("../infra/path-env.js", () => ({
  ensureOpenClawCliOnPath: ensurePathMock,
}));

vi.mock("../infra/runtime-guard.js", () => ({
  assertSupportedRuntime: assertRuntimeMock,
}));

vi.mock("../logging.js", () => ({
  enableConsoleCapture: enableConsoleCaptureMock,
}));

vi.mock("../memory/search-manager.js", () => ({
  closeAllMemorySearchManagers: closeAllMemorySearchManagersMock,
}));

vi.mock("../consciousness/interaction-persistence.js", () => ({
  maybeStartInteractionPersistence: maybeStartInteractionPersistenceMock,
}));

vi.mock("../consciousness/boot-lifecycle.js", () => ({
  maybeStartConsciousnessLoop: maybeStartConsciousnessLoopMock,
}));

vi.mock("./program.js", () => ({
  buildProgram: buildProgramMock,
}));

vi.mock("../infra/unhandled-rejections.js", () => ({
  installUnhandledRejectionHandler: installUnhandledRejectionHandlerMock,
}));

vi.mock("./program/program-context.js", () => ({
  getProgramContext: getProgramContextMock,
}));

vi.mock("./program/command-registry.js", () => ({
  registerCoreCliByName: registerCoreCliByNameMock,
}));

vi.mock("./program/register.subclis.js", () => ({
  registerSubCliByName: registerSubCliByNameMock,
}));

const { runCli } = await import("./run-main.js");

describe("runCli interaction persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tryRouteCliMock.mockResolvedValue(false);
    buildProgramMock.mockReturnValue({
      commands: [{ name: () => "status" }],
      parseAsync: vi.fn(async () => {}),
    });
  });

  it("starts interaction persistence for command runs and stops it on shutdown", async () => {
    const stopMock = vi.fn(async () => {});
    maybeStartInteractionPersistenceMock.mockReturnValue({
      stop: stopMock,
    });

    await runCli(["node", "openclaw", "status"]);

    expect(maybeStartInteractionPersistenceMock).toHaveBeenCalledTimes(1);
    expect(maybeStartConsciousnessLoopMock).toHaveBeenCalledTimes(1);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(closeAllMemorySearchManagersMock).toHaveBeenCalledTimes(1);
  });
});
