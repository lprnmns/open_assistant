import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../auto-reply/templating.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";

const extractFileContentFromSourceMock = vi.hoisted(() => vi.fn());
const extractPdfImageFallbackTextMock = vi.hoisted(() => vi.fn());

async function createTempPdfPath(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(resolvePreferredOpenClawTmpDir(), "openclaw-pdf-apply-"));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, Buffer.from("%PDF-fake"));
  return filePath;
}

describe("applyMediaUnderstanding PDF OCR fallback", () => {
  let applyMediaUnderstanding: typeof import("./apply.js").applyMediaUnderstanding;

  beforeEach(async () => {
    vi.resetModules();
    extractFileContentFromSourceMock.mockReset();
    extractPdfImageFallbackTextMock.mockReset();
    vi.doMock("../media/input-files.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../media/input-files.js")>();
      return {
        ...actual,
        extractFileContentFromSource: extractFileContentFromSourceMock,
      };
    });
    vi.doMock("./pdf-ocr.js", () => ({
      extractPdfImageFallbackText: extractPdfImageFallbackTextMock,
    }));
    ({ applyMediaUnderstanding } = await import("./apply.js"));
  });

  it("appends OCR text for scanned PDFs rendered to images", async () => {
    const pdfPath = await createTempPdfPath("scanned.pdf");
    extractFileContentFromSourceMock.mockResolvedValue({
      filename: "scanned.pdf",
      text: "",
      images: [
        { type: "image", data: Buffer.from("page-1").toString("base64"), mimeType: "image/png" },
      ],
    });
    extractPdfImageFallbackTextMock.mockResolvedValue("Invoice 2048\nTotal: 42");

    const ctx: MsgContext = {
      Body: "<media:document>",
      MediaPath: pdfPath,
      MediaType: "application/pdf",
    };

    const result = await applyMediaUnderstanding({
      ctx,
      cfg: {} as OpenClawConfig,
    });

    expect(extractPdfImageFallbackTextMock).toHaveBeenCalledTimes(1);
    expect(result.appliedFile).toBe(true);
    expect(ctx.Body).toContain('<file name="scanned.pdf" mime="application/pdf">');
    expect(ctx.Body).toContain("Invoice 2048");
    expect(ctx.Body).not.toContain("images not forwarded");
  });

  it("keeps a diagnostic when rendered pages still produce no OCR text", async () => {
    const pdfPath = await createTempPdfPath("empty-scan.pdf");
    extractFileContentFromSourceMock.mockResolvedValue({
      filename: "empty-scan.pdf",
      text: "",
      images: [
        { type: "image", data: Buffer.from("page-1").toString("base64"), mimeType: "image/png" },
      ],
    });
    extractPdfImageFallbackTextMock.mockResolvedValue(undefined);

    const ctx: MsgContext = {
      Body: "<media:document>",
      MediaPath: pdfPath,
      MediaType: "application/pdf",
    };

    await applyMediaUnderstanding({
      ctx,
      cfg: {} as OpenClawConfig,
    });

    expect(ctx.Body).toContain("Scanned PDF detected, but OCR fallback did not produce text");
  });
});
