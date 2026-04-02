import { describe, expect, test } from "vitest";
import {
  applyToolPolicyPipeline,
  buildDefaultActFirstToolPolicyMeta,
} from "./tool-policy-pipeline.js";

type DummyTool = { name: string };

// ── helpers ───────────────────────────────────────────────────────────────────

function run(
  tools: DummyTool[],
  steps: Parameters<typeof applyToolPolicyPipeline>[0]["steps"],
  warn: (message: string) => void = () => {},
) {
  return applyToolPolicyPipeline({
    // oxlint-disable-next-line typescript/no-explicit-any
    tools: tools as any,
    // oxlint-disable-next-line typescript/no-explicit-any
    toolMeta: (t: any) => (t.name === "plugin_tool" ? { pluginId: "foo" } : undefined),
    warn,
    steps,
  });
}

// ── existing filtering tests (updated to use .tools) ─────────────────────────

describe("tool-policy-pipeline — filtering", () => {
  test("strips allowlists that would otherwise disable core tools", () => {
    const { tools } = run(
      [{ name: "exec" }, { name: "plugin_tool" }],
      [{ policy: { allow: ["plugin_tool"] }, label: "tools.allow", stripPluginOnlyAllowlist: true }],
    );
    expect(tools.map((t) => (t as unknown as DummyTool).name).toSorted()).toEqual([
      "exec",
      "plugin_tool",
    ]);
  });

  test("warns about unknown allowlist entries", () => {
    const warnings: string[] = [];
    run(
      [{ name: "exec" }],
      [{ policy: { allow: ["wat"] }, label: "tools.allow", stripPluginOnlyAllowlist: true }],
      (msg) => warnings.push(msg),
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("unknown entries (wat)");
  });

  test("warns gated core tools as unavailable instead of plugin-only unknowns", () => {
    const warnings: string[] = [];
    run(
      [{ name: "exec" }],
      [
        {
          policy: { allow: ["apply_patch"] },
          label: "tools.profile (coding)",
          stripPluginOnlyAllowlist: true,
        },
      ],
      (msg) => warnings.push(msg),
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("unknown entries (apply_patch)");
    expect(warnings[0]).toContain(
      "shipped core tools but unavailable in the current runtime/provider/model/config",
    );
    expect(warnings[0]).not.toContain("unless the plugin is enabled");
  });

  test("applies allowlist filtering when core tools are explicitly listed", () => {
    const { tools } = run(
      [{ name: "exec" }, { name: "process" }],
      [{ policy: { allow: ["exec"] }, label: "tools.allow", stripPluginOnlyAllowlist: true }],
    );
    expect(tools.map((t) => (t as unknown as DummyTool).name)).toEqual(["exec"]);
  });
});

// ── metadata accumulation ─────────────────────────────────────────────────────

describe("tool-policy-pipeline — metadata", () => {
  test("result.meta is defined even when no steps carry meta", () => {
    const { meta } = run(
      [{ name: "exec" }],
      [{ policy: undefined, label: "empty" }],
    );
    expect(meta.reversibilityScores).toEqual({});
    expect(meta.requiresHuman.size).toBe(0);
    expect(meta.rateLimits).toEqual({});
  });

  test("reversibilityScore flows through a step's meta", () => {
    const { meta } = run(
      [{ name: "exec" }],
      [
        {
          policy: undefined,
          label: "meta-only",
          meta: { reversibilityScore: { exec: 0.0, read: 1.0 } },
        },
      ],
    );
    expect(meta.reversibilityScores["exec"]).toBe(0.0);
    expect(meta.reversibilityScores["read"]).toBe(1.0);
  });

  test("later step's reversibilityScore overrides earlier for the same tool", () => {
    const { meta } = run(
      [{ name: "exec" }],
      [
        { policy: undefined, label: "step-1", meta: { reversibilityScore: { exec: 0.5 } } },
        { policy: undefined, label: "step-2", meta: { reversibilityScore: { exec: 0.2 } } },
      ],
    );
    expect(meta.reversibilityScores["exec"]).toBe(0.2);
  });

  test("requiresHuman is a cumulative union — entries cannot be removed by later steps", () => {
    const { meta } = run(
      [{ name: "exec" }, { name: "delete" }],
      [
        { policy: undefined, label: "step-1", meta: { requiresHuman: ["exec"] } },
        { policy: undefined, label: "step-2", meta: { requiresHuman: ["delete"] } },
      ],
    );
    expect(meta.requiresHuman.has("exec")).toBe(true);
    expect(meta.requiresHuman.has("delete")).toBe(true);
    expect(meta.requiresHuman.size).toBe(2);
  });

  test("rateLimits flow through and later step wins per tool", () => {
    const { meta } = run(
      [{ name: "exec" }],
      [
        {
          policy: undefined,
          label: "step-1",
          meta: { rateLimits: { exec: { perMinute: 10 } } },
        },
        {
          policy: undefined,
          label: "step-2",
          meta: { rateLimits: { exec: { perMinute: 5, perHour: 30 } } },
        },
      ],
    );
    expect(meta.rateLimits["exec"]).toEqual({ perMinute: 5, perHour: 30 });
  });

  test("metadata-only step (policy: undefined) still contributes meta", () => {
    const { tools, meta } = run(
      [{ name: "exec" }, { name: "read" }],
      [
        {
          policy: { allow: ["exec"] },
          label: "filter-step",
          stripPluginOnlyAllowlist: true,
        },
        {
          policy: undefined,
          label: "meta-only",
          meta: { requiresHuman: ["exec"], reversibilityScore: { exec: 0.1 } },
        },
      ],
    );
    // Filtering still applied by step-1
    expect(tools.map((t) => (t as unknown as DummyTool).name)).toEqual(["exec"]);
    // Meta accumulated from the policy-less step
    expect(meta.requiresHuman.has("exec")).toBe(true);
    expect(meta.reversibilityScores["exec"]).toBe(0.1);
  });

  test("tool names in meta are normalized (case-insensitive)", () => {
    const { meta } = run(
      [{ name: "exec" }],
      [
        {
          policy: undefined,
          label: "step",
          meta: {
            reversibilityScore: { EXEC: 0.0 },
            requiresHuman: ["Exec"],
            rateLimits: { Exec: { perMinute: 1 } },
          },
        },
      ],
    );
    expect(meta.reversibilityScores["exec"]).toBe(0.0);
    expect(meta.requiresHuman.has("exec")).toBe(true);
    expect(meta.rateLimits["exec"]).toEqual({ perMinute: 1 });
  });

  test("meta from all steps is accumulated regardless of step order", () => {
    const { meta } = run(
      [{ name: "exec" }],
      [
        { policy: undefined, label: "a", meta: { reversibilityScore: { read: 1.0 } } },
        { policy: undefined, label: "b", meta: { rateLimits: { write: { perHour: 100 } } } },
        { policy: undefined, label: "c", meta: { requiresHuman: ["exec"] } },
      ],
    );
    expect(meta.reversibilityScores["read"]).toBe(1.0);
    expect(meta.rateLimits["write"]).toEqual({ perHour: 100 });
    expect(meta.requiresHuman.has("exec")).toBe(true);
  });
});

describe("buildDefaultActFirstToolPolicyMeta", () => {
  test("assigns auto score to calendar add tools", () => {
    const meta = buildDefaultActFirstToolPolicyMeta([{ name: "calendar_add" }]);
    expect(meta?.reversibilityScore?.calendar_add).toBe(0.8);
  });

  test("assigns blocked score to external send tools", () => {
    const meta = buildDefaultActFirstToolPolicyMeta([{ name: "email_send" }]);
    expect(meta?.reversibilityScore?.email_send).toBe(0.2);
  });

  test("assigns auto score to read tools", () => {
    const meta = buildDefaultActFirstToolPolicyMeta([{ name: "read" }]);
    expect(meta?.reversibilityScore?.read).toBe(1.0);
  });

  test("assigns confirm score to write-like tools", () => {
    const meta = buildDefaultActFirstToolPolicyMeta([{ name: "write_file" }]);
    expect(meta?.reversibilityScore?.write_file).toBe(0.5);
  });
});
