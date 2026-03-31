import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyCall, selectModel, sourceTier } from "./proxy-client.js";

// ── helpers ────────────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

function setOnlyProvider(provider: "anthropic" | "openai" | "google" | "openrouter") {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  if (provider === "anthropic") process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  if (provider === "openai") process.env.OPENAI_API_KEY = "sk-proj-test";
  if (provider === "google") process.env.GEMINI_API_KEY = "AIzaTest";
  // Synthetic test value — never a real credential
  if (provider === "openrouter") process.env.OPENROUTER_API_KEY = "sk-or-v1-" + "0".repeat(64);
}

function restoreEnv() {
  for (const k of [
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY",
    "LITELLM_PROXY_URL", "LITELLM_MASTER_KEY",
  ]) {
    if (ORIGINAL_ENV[k] !== undefined) {
      process.env[k] = ORIGINAL_ENV[k];
    } else {
      delete process.env[k];
    }
  }
}

// ── sourceTier ─────────────────────────────────────────────────────────────────

describe("sourceTier", () => {
  it("maps chat → strong", () => {
    expect(sourceTier("chat")).toBe("strong");
  });

  it("maps consciousness → cheap", () => {
    expect(sourceTier("consciousness")).toBe("cheap");
  });

  it("maps extraction → cheap", () => {
    expect(sourceTier("extraction")).toBe("cheap");
  });

  it("maps sleep → cheap", () => {
    expect(sourceTier("sleep")).toBe("cheap");
  });
});

// ── selectModel ────────────────────────────────────────────────────────────────

describe("selectModel", () => {
  afterEach(restoreEnv);

  it("selects claude-sonnet for chat when Anthropic key is present", () => {
    setOnlyProvider("anthropic");
    expect(selectModel("chat")).toBe("claude-sonnet");
  });

  it("selects claude-haiku for consciousness when Anthropic key is present", () => {
    setOnlyProvider("anthropic");
    expect(selectModel("consciousness")).toBe("claude-haiku");
  });

  it("selects gpt-4o for chat when only OpenAI key is present", () => {
    setOnlyProvider("openai");
    expect(selectModel("chat")).toBe("gpt-4o");
  });

  it("selects gpt-4o-mini for sleep when only OpenAI key is present", () => {
    setOnlyProvider("openai");
    expect(selectModel("sleep")).toBe("gpt-4o-mini");
  });

  it("selects gemini-pro for chat when only Google key is present", () => {
    setOnlyProvider("google");
    expect(selectModel("chat")).toBe("gemini-pro");
  });

  it("selects gemini-flash for extraction when only Google key is present", () => {
    setOnlyProvider("google");
    expect(selectModel("extraction")).toBe("gemini-flash");
  });

  it("prefers Anthropic over OpenAI when both are set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OPENAI_API_KEY = "sk-proj-test";
    expect(selectModel("chat")).toBe("claude-sonnet");
  });

  it("throws when no provider key is configured", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    expect(() => selectModel("chat")).toThrow(/No BYOK provider key/);
  });

  // ── OpenRouter-specific selectModel tests ──────────────────────────────────

  it("selects openrouter-strong for chat when only OpenRouter key is present", () => {
    setOnlyProvider("openrouter");
    expect(selectModel("chat")).toBe("openrouter-strong");
  });

  it("selects openrouter-cheap for consciousness when only OpenRouter key is present", () => {
    setOnlyProvider("openrouter");
    expect(selectModel("consciousness")).toBe("openrouter-cheap");
  });

  it("selects openrouter-cheap for sleep when only OpenRouter key is present", () => {
    setOnlyProvider("openrouter");
    expect(selectModel("sleep")).toBe("openrouter-cheap");
  });

  it("selects openrouter-cheap for extraction when only OpenRouter key is present", () => {
    setOnlyProvider("openrouter");
    expect(selectModel("extraction")).toBe("openrouter-cheap");
  });

  it("Anthropic key takes priority over OpenRouter (openrouter does NOT override existing providers)", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-" + "0".repeat(64);
    expect(selectModel("chat")).toBe("claude-sonnet");
    expect(selectModel("consciousness")).toBe("claude-haiku");
  });

  it("OpenAI key takes priority over OpenRouter", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "sk-proj-test";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-" + "0".repeat(64);
    expect(selectModel("chat")).toBe("gpt-4o");
  });

  it("Google key takes priority over OpenRouter", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = "AIzaTest";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-" + "0".repeat(64);
    expect(selectModel("chat")).toBe("gemini-pro");
  });
});

// ── proxyCall ─────────────────────────────────────────────────────────────────

describe("proxyCall", () => {
  beforeEach(() => {
    setOnlyProvider("anthropic");
    process.env.LITELLM_PROXY_URL = "http://litellm-test:4000";
    process.env.LITELLM_MASTER_KEY = "sk-test-master";
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("makes POST to /v1/chat/completions with correct model and headers", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        model: "claude-haiku-4-5-20251001",
        choices: [{ message: { content: "Hello from haiku" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as Response);

    const result = await proxyCall({
      source: "consciousness",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://litellm-test:4000/v1/chat/completions");

    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("claude-haiku"); // cheap tier for consciousness
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);

    const headers = init!.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test-master");
    expect(headers["x-source"]).toBe("consciousness");

    expect(result.content).toBe("Hello from haiku");
    expect(result.usage.totalTokens).toBe(15);
  });

  it("uses modelOverride when provided", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        model: "gpt-4o",
        choices: [{ message: { content: "override" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as Response);

    await proxyCall({
      source: "chat",
      messages: [{ role: "user", content: "hi" }],
      modelOverride: "gpt-4o",
    });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe("gpt-4o");
  });

  it("throws on HTTP error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "invalid key",
    } as Response);

    await expect(
      proxyCall({ source: "chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/401/);
  });

  it("throws when proxy returns no choices", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ model: "claude-sonnet", choices: [] }),
    } as Response);

    await expect(
      proxyCall({ source: "chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/no choices/);
  });

  it("throws when LITELLM_MASTER_KEY is not set", async () => {
    delete process.env.LITELLM_MASTER_KEY;
    await expect(
      proxyCall({ source: "chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/LITELLM_MASTER_KEY/);
  });

  it("throws when proxy returns an unexpected response shape (no choices key)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ error: "bad shape" }),
    } as Response);

    await expect(
      proxyCall({ source: "chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("throws when a choice is missing message.content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-sonnet",
        // message exists but content is a number, not a string
        choices: [{ message: { content: 42 } }],
      }),
    } as Response);

    await expect(
      proxyCall({ source: "chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("throws when a choice has no message field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-sonnet",
        choices: [{ index: 0 }],
      }),
    } as Response);

    await expect(
      proxyCall({ source: "chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("throws when model field is not a string", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 123,
        choices: [{ message: { content: "ok" } }],
      }),
    } as Response);

    await expect(
      proxyCall({ source: "chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("throws when usage.total_tokens is a string instead of a number", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-sonnet",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: "12" },
      }),
    } as Response);

    await expect(
      proxyCall({ source: "chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  it("accepts response with no usage field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-sonnet",
        choices: [{ message: { content: "ok" } }],
        // no usage — should not throw
      }),
    } as Response);

    const result = await proxyCall({
      source: "chat",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.usage.totalTokens).toBe(0);
  });

  it("uses LITELLM_PROXY_URL env var for base URL", async () => {
    process.env.LITELLM_PROXY_URL = "http://custom-proxy:9000";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-sonnet",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as Response);

    await proxyCall({ source: "chat", messages: [{ role: "user", content: "hi" }] });
    expect(fetchSpy.mock.calls[0]![0]).toContain("http://custom-proxy:9000");
  });

  it("strips trailing slash from LITELLM_PROXY_URL", async () => {
    process.env.LITELLM_PROXY_URL = "http://litellm:4000/";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "claude-sonnet",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as Response);

    await proxyCall({ source: "chat", messages: [{ role: "user", content: "hi" }] });
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).not.toContain("//v1");
    expect(url).toBe("http://litellm:4000/v1/chat/completions");
  });

  // ── OpenRouter integration path ────────────────────────────────────────────

  it("sends openrouter-cheap model when only OpenRouter key is present (consciousness source)", async () => {
    setOnlyProvider("openrouter");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "openrouter/qwen/qwen3.6-plus-preview:free",
        choices: [{ message: { content: "pong from openrouter" } }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      }),
    } as Response);

    const result = await proxyCall({
      source: "consciousness",
      messages: [{ role: "user", content: "ping" }],
    });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("openrouter-cheap");
    expect(result.content).toBe("pong from openrouter");
    expect(result.usage.totalTokens).toBe(12);
  });

  it("sends openrouter-strong model when only OpenRouter key is present (chat source)", async () => {
    setOnlyProvider("openrouter");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "openrouter/qwen/qwen3.6-plus-preview:free",
        choices: [{ message: { content: "strong reply" } }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
    } as Response);

    const result = await proxyCall({
      source: "chat",
      messages: [{ role: "user", content: "hello" }],
    });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("openrouter-strong");
    expect(result.content).toBe("strong reply");
  });

  it("x-source header is preserved for OpenRouter path", async () => {
    setOnlyProvider("openrouter");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "openrouter/qwen/qwen3.6-plus-preview:free",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as Response);

    await proxyCall({ source: "sleep", messages: [{ role: "user", content: "hi" }] });

    const headers = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["x-source"]).toBe("sleep");
    expect(headers["Authorization"]).toBe("Bearer sk-test-master");
  });
});
