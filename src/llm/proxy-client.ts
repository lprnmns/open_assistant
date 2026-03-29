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
 *   LITELLM_MASTER_KEY     Bearer token for the proxy     (REQUIRED — no default; throws if absent)
 *
 * Model alias → LiteLLM name mapping (mirrors litellm_config.yaml):
 *   strong tier: claude-sonnet | gpt-4o | gemini-pro
 *   cheap  tier: claude-haiku  | gpt-4o-mini | gemini-flash
 */

import { BYOK_KEY_NAMES } from "../config/byok-secrets.js";
import type {
  ByokProvider,
  LlmSource,
  ProxyCallOptions,
  ProxyCallResult,
  ProxyModelTier,
} from "./types.js";

// ── Response type guard ────────────────────────────────────────────────────────

type ProxyResponseShape = {
  model: string;
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function isProxyChoice(value: unknown): value is ProxyResponseShape["choices"][number] {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const msg = v["message"];
  return (
    !!msg &&
    typeof msg === "object" &&
    typeof (msg as Record<string, unknown>)["content"] === "string"
  );
}

function isOptionalNumber(v: unknown): boolean {
  return v === undefined || typeof v === "number";
}

function isProxyResponse(value: unknown): value is ProxyResponseShape {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  // model: must be a string if present (empty string is allowed; we fall back
  // to the locally-known model name in that case)
  if (v["model"] !== undefined && typeof v["model"] !== "string") return false;

  // choices: must be an array where every element passes isProxyChoice
  if (!Array.isArray(v["choices"])) return false;
  if (!(v["choices"] as unknown[]).every(isProxyChoice)) return false;

  // usage: if present, must be an object with optional numeric fields
  const usage = v["usage"];
  if (usage !== undefined) {
    if (!usage || typeof usage !== "object") return false;
    const u = usage as Record<string, unknown>;
    if (!isOptionalNumber(u["prompt_tokens"])) return false;
    if (!isOptionalNumber(u["completion_tokens"])) return false;
    if (!isOptionalNumber(u["total_tokens"])) return false;
  }

  return true;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_PROXY_URL = "http://localhost:4000";
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
  const key = process.env.LITELLM_MASTER_KEY;
  if (!key) {
    throw new Error(
      "LITELLM_MASTER_KEY is not set. " +
        "Set this env var to the LiteLLM proxy master key before making LLM calls.",
    );
  }
  return key;
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

  const raw: unknown = await response.json();
  if (!isProxyResponse(raw)) {
    throw new Error("LiteLLM proxy returned an unexpected response shape");
  }

  const choice = raw.choices[0];
  if (!choice) {
    throw new Error("LiteLLM proxy returned no choices in response");
  }

  return {
    content: choice.message.content,
    model: raw.model || model,
    usage: {
      promptTokens: raw.usage?.prompt_tokens ?? 0,
      completionTokens: raw.usage?.completion_tokens ?? 0,
      totalTokens: raw.usage?.total_tokens ?? 0,
    },
  };
}
