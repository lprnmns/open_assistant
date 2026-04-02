import { describe, expect, it } from "vitest";
import { createOpenClawCodingTools } from "./pi-tools.js";

describe("createOpenClawCodingTools — act-first", () => {
  it("keeps classic tool availability when act-first is disabled", () => {
    const tools = createOpenClawCodingTools();
    expect(tools.some((tool) => tool.name === "exec")).toBe(true);
    expect(tools.some((tool) => tool.name === "read")).toBe(true);
  });

  it("blocks low-reversibility exec calls when act-first is enabled", async () => {
    const execTool = createOpenClawCodingTools({ actFirstEnabled: true }).find(
      (tool) => tool.name === "exec",
    );
    expect(execTool).toBeTruthy();
    // oxlint-disable-next-line typescript/no-explicit-any
    await expect((execTool as any).execute("call-1", { command: "echo ok" })).rejects.toThrow(
      "too risky",
    );
  });
});
