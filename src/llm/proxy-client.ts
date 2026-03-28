/**
 * src/llm/proxy-client.ts — LiteLLM Proxy abstraction layer
 *
 * Thin OpenAI-compatible HTTP client that routes all LLM calls through the
 * LiteLLM proxy sidecar.  This module does NOT replace the existing
 * model-selection / auth-profile surface; it sits alongside it and is used
 * exclusively by the Consciousness Loop, Sleep Phase, and Extraction paths.
 *
 * Environment variables consumed:
 *   LITELLM_PROXY_URL      Base URL of the LiteLLM proxy  (default: http://localhost:4000)
 *   LITELLM_MASTER_KEY     Bearer token for the proxy     (default: sk-local-master)
 *
 * Model alias → LiteLLM name mapping (mirrors litellm_config.yaml):
 *   strong tier: claude-sonnet | gpt-4o | gemini-pro
 *   cheap  tier: claude-haiku  | gpt-4o-mini | gemini-flash
 */

import { BYOK_KEY_NAMES } from "../config/byok-secrets.js";
import type { ByokProvider, LlmSource, ProxyCallOptions, ProxyCallResult, ProxyModelTier } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_PROXY_URL = "http://localhost:4000";
const DEFAULT_MASTER_KEY = "sk-local-master";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.7;

/** LiteLLM model alias used for each provider × tier combination. */
const MODEL_ALIASES: Record<ByokProvider, Record<ProxyModelTier, string>> = {
  anthropic: {
    strong: "claude-sonnet",
    cheap: "claude-haiku",
  },
  openai: {
    strong: "gpt-4o",
    cheap: "gpt-4o-mini",
  },
  google: {
    strong: "gemini-pro",
    cheap: "gemini-flash",
  },
};

/** ENV var that holds each provider's API key (used for availability check). */
const PROVIDER_ENV_KEYS: Record<ByokProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
};

/** Priority order — first available provider wins. */
const PROVIDER_PRIORITY: ByokProvider[] = ["anthropic", "openai", "google"];

// ── Source → tier mapping ─────────────────────────────────────────────────────

/**
 * Chat calls get the strong model; all background subsystems get the cheap
 * model to keep Consciousness Loop operating costs low.
 */
export function sourceTier(source: LlmSource): ProxyModelTier {
  return source === "chat" ? "strong" : "cheap";
}

// ── Model selection ───────────────────────────────────────────────────────────

/**
 * Return the LiteLLM model alias for the given source, based on which BYOK
 * provider keys are available in process.env.
 *
 * Throws if no provider key is configured — the caller must ensure at least
 * one key was injected by loadAndInjectByokSecrets() at boot.
 */
export function selectModel(source: LlmSource): string {
  const tier = sourceTier(source);
  for (const provider of PROVIDER_PRIORITY) {
    if (process.env[PROVIDER_ENV_KEYS[provider]]) {
      return MODEL_ALIASES[provider][tier];
    }
  }
  const keyNames = BYOK_KEY_NAMES.join(", ");
  throw new Error(
    `No BYOK provider key found in environment. ` +
      `Set at least one of: ${keyNames}. ` +
      `Run scripts/init-secrets.ts to configure keys.`,
  );
}

// ── Low-level HTTP call ───────────────────────────────────────────────────────

function getProxyUrl(): string {
  return (process.env.LITELLM_PROXY_URL ?? DEFAULT_PROXY_URL).replace(/\/$/, "");
}

function getMasterKey(): string {
  return process.env.LITELLM_MASTER_KEY ?? DEFAULT_MASTER_KEY;
}

/**
 * Make a chat completion call through the LiteLLM proxy.
 *
 * @throws {Error} on HTTP error or malformed response
 */
export async function proxyCall(options: ProxyCallOptions): Promise<ProxyCallResult> {
  const model = options.modelOverride ?? selectModel(options.source);
  const url = `${getProxyUrl()}/v1/chat/completions`;

  const body = JSON.stringify({
    model,
    messages: options.messages,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    // Pass source as a custom header so LiteLLM logs can tag it
    // (belt-and-suspenders alongside the x-source header set by the gateway)
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getMasterKey()}`,
      // Source tag for LiteLLM access logs
      "x-source": options.source,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `LiteLLM proxy error ${response.status} ${response.statusText}: ${text}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await response.json()) as any;

  const choice = data?.choices?.[0];
  if (!choice) {
    throw new Error("LiteLLM proxy returned no choices in response");
  }

  const content: string =
    typeof choice.message?.content === "string" ? choice.message.content : "";

  return {
    content,
    model: typeof data.model === "string" ? data.model : model,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
  };
}
