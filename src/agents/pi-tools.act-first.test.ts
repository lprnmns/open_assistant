import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenClawCodingTools } from "./pi-tools.js";

describe("createOpenClawCodingTools — act-first", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("keeps classic tool availability when act-first is disabled", () => {
    const tools = createOpenClawCodingTools();
    expect(tools.some((tool) => tool.name === "exec")).toBe(true);
    expect(tools.some((tool) => tool.name === "read")).toBe(true);
  });

  it("blocks low-reversibility exec calls when act-first is enabled (no approval surface)", async () => {
    const execTool = createOpenClawCodingTools({ actFirstEnabled: true }).find(
      (tool) => tool.name === "exec",
    );
    expect(execTool).toBeTruthy();
    // oxlint-disable-next-line typescript/no-explicit-any
    await expect((execTool as any).execute("call-1", { command: "echo ok" })).rejects.toThrow(
      "no approval surface",
    );
  });

  it("routes apply_patch approvals through the provided approval surface", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-act-first-"));
    tempDirs.push(workspaceDir);
    const approvalSurface = { onApprovalRequest: vi.fn().mockResolvedValue(true) };

    const applyPatchTool = createOpenClawCodingTools({
      actFirstEnabled: true,
      approvalSurface,
      workspaceDir,
      agentDir: workspaceDir,
      config: {
        tools: {
          allow: ["exec"],
          exec: {
            applyPatch: { enabled: true },
          },
        },
      },
      modelProvider: "openai-codex",
      modelId: "gpt-5.4",
    }).find((tool) => tool.name === "apply_patch");

    expect(applyPatchTool).toBeTruthy();
    // oxlint-disable-next-line typescript/no-explicit-any
    await (applyPatchTool as any).execute(
      "call-2",
      {
        input: "*** Begin Patch\n*** Add File: hello.txt\n+hi\n*** End Patch",
      },
    );

    expect(approvalSurface.onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "apply_patch" }),
    );
    await expect(fs.readFile(path.join(workspaceDir, "hello.txt"), "utf8")).resolves.toBe("hi\n");
  });
});
