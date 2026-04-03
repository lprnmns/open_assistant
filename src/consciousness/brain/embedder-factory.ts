import {
  resolveAgentDir,
  resolveSessionAgentId,
} from "../../agents/agent-scope.js";
import {
  resolveMemorySearchConfig,
  type ResolvedMemorySearchConfig,
} from "../../agents/memory-search.js";
import type { OpenClawConfig } from "../../config/config.js";
import { createEmbeddingProvider } from "../../memory/embeddings.js";
import type { Embedder } from "./types.js";

export type ProductionEmbedder = {
  embedder: Embedder;
  settings: ResolvedMemorySearchConfig;
  providerId: string;
  model: string;
};

export async function createProductionEmbedder(params: {
  cfg: OpenClawConfig;
  agentId?: string;
}): Promise<ProductionEmbedder> {
  const agentId = params.agentId ?? resolveSessionAgentId({ config: params.cfg }) ?? "main";
  const settings = resolveMemorySearchConfig(params.cfg, agentId);
  if (!settings) {
    throw new Error(
      "Consciousness brain requires agents.defaults.memorySearch to be enabled.",
    );
  }

  const result = await createEmbeddingProvider({
    config: params.cfg,
    agentDir: resolveAgentDir(params.cfg, agentId),
    provider: settings.provider,
    remote: settings.remote,
    model: settings.model,
    outputDimensionality: settings.outputDimensionality,
    fallback: settings.fallback,
    local: settings.local,
  });
  const provider = result.provider;
  if (!provider) {
    throw new Error(
      result.providerUnavailableReason ??
        "Consciousness brain could not initialize an embedding provider.",
    );
  }

  return {
    settings,
    providerId: provider.id,
    model: provider.model,
    embedder: {
      embed: async (text: string) => await provider.embedQuery(text),
    },
  };
}
