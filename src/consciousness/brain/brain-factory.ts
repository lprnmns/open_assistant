import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { createCortex } from "./cortex.js";
import { createProductionEmbedder } from "./embedder-factory.js";
import { createHippocampus } from "./hippocampus.js";
import { createNoteIngestionPipeline } from "./ingestion.js";
import { createMemoryRecallPipeline } from "./recall.js";
import type {
  Cortex,
  Embedder,
  Hippocampus,
  MemoryRecallPipeline,
  NoteIngestionPipeline,
} from "./types.js";

export type ProductionBrain = {
  cortex: Cortex;
  hippocampus: Hippocampus;
  embedder: Embedder;
  ingestion: NoteIngestionPipeline;
  recall: MemoryRecallPipeline;
  sessionKey: string;
  dbPath: string;
  providerId: string;
  model: string;
  close: () => Promise<void>;
};

export async function createProductionBrain(
  params: {
    cfg: OpenClawConfig;
    dbPath: string;
    sessionKey: string;
    agentId?: string;
    cortexCapacity?: number;
    log?: (msg: string) => void;
  },
  deps: {
    createProductionEmbedder?: typeof createProductionEmbedder;
  } = {},
): Promise<ProductionBrain> {
  const embedderFactory = deps.createProductionEmbedder ?? createProductionEmbedder;
  const { embedder, providerId, model } = await embedderFactory({
    cfg: params.cfg,
    agentId: params.agentId,
  });

  if (params.dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(params.dbPath), { recursive: true });
  }

  const cortex = createCortex(params.cortexCapacity);
  const hippocampus = createHippocampus(params.dbPath, params.log);
  const ingestion = createNoteIngestionPipeline({
    cortex,
    embedder,
    hippocampus,
    log: params.log,
  });
  const recall = createMemoryRecallPipeline({
    cortex,
    embedder,
    hippocampus,
  });

  return {
    cortex,
    hippocampus,
    embedder,
    ingestion,
    recall,
    sessionKey: params.sessionKey,
    dbPath: params.dbPath,
    providerId,
    model,
    close: async () => {
      cortex.clear();
      await hippocampus.close();
    },
  };
}
