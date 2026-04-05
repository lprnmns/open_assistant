import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenClawReadTool } from "./pi-tools.read.js";
import type { AnyAgentTool } from "./pi-tools.types.js";

async function makeTempDir(prefix: string) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("createOpenClawReadTool project fallback", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("rewrites missing relative reads to the live project root when the fallback file exists", async () => {
    const workspaceRoot = await makeTempDir("openclaw-read-workspace-");
    const projectRoot = await makeTempDir("openclaw-read-project-");
    tempDirs.push(workspaceRoot, projectRoot);
    await fs.writeFile(path.join(projectRoot, "package.json"), '{"name":"project"}\n', "utf8");

    const execute = vi.fn(async (_toolCallId: string, args: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: String(args.path) }],
    }));
    const wrapped = createOpenClawReadTool(
      {
        name: "read",
        label: "read",
        description: "test read",
        inputSchema: { type: "object", properties: {} },
        parameters: { type: "object", properties: {} },
        execute,
      } as unknown as AnyAgentTool,
      {
        workspaceRoot,
        projectFallbackRoot: projectRoot,
      },
    );

    await wrapped.execute("read-project-fallback", { path: "package.json" });

    expect(execute).toHaveBeenCalledWith(
      "read-project-fallback",
      expect.objectContaining({
        path: path.join(projectRoot, "package.json"),
      }),
      undefined,
    );
  });

  it("keeps workspace-relative reads when the file already exists in the configured workspace", async () => {
    const workspaceRoot = await makeTempDir("openclaw-read-workspace-");
    const projectRoot = await makeTempDir("openclaw-read-project-");
    tempDirs.push(workspaceRoot, projectRoot);
    await fs.writeFile(path.join(workspaceRoot, "package.json"), '{"name":"workspace"}\n', "utf8");
    await fs.writeFile(path.join(projectRoot, "package.json"), '{"name":"project"}\n', "utf8");

    const execute = vi.fn(async (_toolCallId: string, args: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: String(args.path) }],
    }));
    const wrapped = createOpenClawReadTool(
      {
        name: "read",
        label: "read",
        description: "test read",
        inputSchema: { type: "object", properties: {} },
        parameters: { type: "object", properties: {} },
        execute,
      } as unknown as AnyAgentTool,
      {
        workspaceRoot,
        projectFallbackRoot: projectRoot,
      },
    );

    await wrapped.execute("read-workspace-first", { path: "package.json" });

    expect(execute).toHaveBeenCalledWith(
      "read-workspace-first",
      expect.objectContaining({
        path: "package.json",
      }),
      undefined,
    );
  });

  it("does not remap parent-relative paths through the project fallback", async () => {
    const workspaceRoot = await makeTempDir("openclaw-read-workspace-");
    const projectRoot = await makeTempDir("openclaw-read-project-");
    tempDirs.push(workspaceRoot, projectRoot);
    await fs.mkdir(path.join(projectRoot, "..", "shared"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "..", "shared", "package.json"), "{}", "utf8");

    const execute = vi.fn(async (_toolCallId: string, args: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: String(args.path) }],
    }));
    const wrapped = createOpenClawReadTool(
      {
        name: "read",
        label: "read",
        description: "test read",
        inputSchema: { type: "object", properties: {} },
        parameters: { type: "object", properties: {} },
        execute,
      } as unknown as AnyAgentTool,
      {
        workspaceRoot,
        projectFallbackRoot: projectRoot,
      },
    );

    await wrapped.execute("read-no-parent-remap", { path: "../shared/package.json" });

    expect(execute).toHaveBeenCalledWith(
      "read-no-parent-remap",
      expect.objectContaining({
        path: "../shared/package.json",
      }),
      undefined,
    );
  });
});
