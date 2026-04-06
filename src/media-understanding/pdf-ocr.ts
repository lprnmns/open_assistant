import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { logVerbose, shouldLogVerbose } from "../globals.js";
import { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";
import type { InputImageContent } from "../media/input-files.js";
import type { ActiveMediaModel } from "./runner.js";
import { describeImageFile } from "./runtime.js";

export const PDF_OCR_PROMPT =
  "Transcribe all visible document text from this page faithfully. Prefer exact text over description. If the page is mostly non-text, return only the readable text fragments.";

function buildPdfOcrConfig(cfg: OpenClawConfig): OpenClawConfig {
  return {
    ...cfg,
    tools: {
      ...cfg.tools,
      media: {
        ...cfg.tools?.media,
        image: {
          ...cfg.tools?.media?.image,
          prompt: PDF_OCR_PROMPT,
          maxChars: Math.max(cfg.tools?.media?.image?.maxChars ?? 0, 4_000) || 4_000,
        },
      },
    },
  };
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".png";
  }
}

export async function extractPdfImageFallbackText(params: {
  images: InputImageContent[];
  cfg: OpenClawConfig;
  agentDir?: string;
  activeModel?: ActiveMediaModel;
}): Promise<string | undefined> {
  const images = params.images.filter(
    (image) => image?.type === "image" && image.mimeType?.startsWith("image/"),
  );
  if (images.length === 0) {
    return undefined;
  }

  const tempDir = await fs.mkdtemp(
    path.join(resolvePreferredOpenClawTmpDir(), "openclaw-pdf-ocr-"),
  );
  try {
    const cfg = buildPdfOcrConfig(params.cfg);
    const pageTexts: string[] = [];
    for (const [index, image] of images.entries()) {
      const imagePath = path.join(tempDir, `page-${index + 1}${extensionForMime(image.mimeType)}`);
      await fs.writeFile(imagePath, Buffer.from(image.data, "base64"));
      try {
        const result = await describeImageFile({
          filePath: imagePath,
          mime: image.mimeType,
          cfg,
          agentDir: params.agentDir,
          activeModel: params.activeModel,
        });
        const text = result.text?.trim();
        if (!text) {
          continue;
        }
        pageTexts.push(images.length > 1 ? `[Page ${index + 1} OCR]\n${text}` : text);
      } catch (err) {
        if (shouldLogVerbose()) {
          logVerbose(`media: PDF OCR fallback skipped page ${index + 1}: ${String(err)}`);
        }
      }
    }
    return pageTexts.length > 0 ? pageTexts.join("\n\n") : undefined;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
