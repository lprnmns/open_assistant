/**
 * src/llm/types.ts — Shared types for the LLM Proxy abstraction layer.
 *
 * These types are intentionally narrow: they cover only what the
 * Consciousness Loop, Sleep Phase, and Chat paths need to make a call
 * through the LiteLLM proxy.  They do NOT replace or wrap the existing
 * model-selection / auth-profile surface — they sit alongside it.
 */

// ── Source tag ────────────────────────────────────────────────────────────────

/**
 * Where an LLM call originates.  Used for:
 *   1. Source-aware model tier selection (strong vs cheap)
 *   2. Cost logging (Sub-Task 1.4) — each call is tagged in SQLite
 */
export type LlmSource = "chat" | "consciousness" | "extraction" | "sleep";

// ── Model tier ────────────────────────────────────────────────────────────────

/**
 * Tier maps to the LiteLLM model aliases defined in litellm_config.yaml:
 *   strong → claude-sonnet / gpt-4o / gemini-pro
 *   cheap  → claude-haiku  / gpt-4o-mini / gemini-flash
 */
export type ProxyModelTier = "strong" | "cheap";

// ── Call I/O ──────────────────────────────────────────────────────────────────

export type ProxyMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProxyCallOptions = {
  /** Originating subsystem — drives tier selection and cost tagging. */
  source: LlmSource;
  messages: ProxyMessage[];
  /** Defaults to 2048. */
  maxTokens?: number;
  /** Defaults to 0.7. */
  temperature?: number;
  /**
   * Override the auto-selected LiteLLM model alias.
   * Useful for callers that need a specific model regardless of tier.
   */
  modelOverride?: string;
};

export type ProxyCallResult = {
  /** Full text of the first completion choice. */
  content: string;
  /** The model name echoed back by LiteLLM (may include provider prefix). */
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

// ── Provider priority ─────────────────────────────────────────────────────────

/**
 * Ordered list of providers checked when auto-selecting a model.
 * First provider that has its API key in process.env wins.
 * Priority: anthropic → openai → google → openrouter
 *
 * OpenRouter is last — it activates only when none of the first three are
 * configured.  Existing production deployments with Anthropic/OpenAI/Google
 * keys are completely unaffected.
 */
export type ByokProvider = "anthropic" | "openai" | "google" | "openrouter";
