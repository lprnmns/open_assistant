import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const describeImageFileMock = vi.hoisted(() => vi.fn());

describe("extractPdfImageFallbackText", () => {
  let extractPdfImageFallbackText: typeof import("./pdf-ocr.js").extractPdfImageFallbackText;
  let PDF_OCR_PROMPT: typeof import("./pdf-ocr.js").PDF_OCR_PROMPT;

  beforeEach(async () => {
    vi.resetModules();
    describeImageFileMock.mockReset();
    vi.doMock("./runtime.js", () => ({
      describeImageFile: describeImageFileMock,
    }));
    ({ extractPdfImageFallbackText, PDF_OCR_PROMPT } = await import("./pdf-ocr.js"));
  });

  it("uses an OCR-oriented image prompt and joins page text", async () => {
    describeImageFileMock
      .mockResolvedValueOnce({ text: "Invoice 2048" })
      .mockResolvedValueOnce({ text: "Total: 42" });

    const text = await extractPdfImageFallbackText({
      images: [
        { type: "image", data: Buffer.from("page-1").toString("base64"), mimeType: "image/png" },
        { type: "image", data: Buffer.from("page-2").toString("base64"), mimeType: "image/png" },
      ],
      cfg: {} as OpenClawConfig,
      agentDir: "/tmp/agent",
    });

    expect(text).toBe("[Page 1 OCR]\nInvoice 2048\n\n[Page 2 OCR]\nTotal: 42");
    expect(describeImageFileMock).toHaveBeenCalledTimes(2);
    const firstCall = describeImageFileMock.mock.calls[0]?.[0] as {
      mime?: string;
      cfg?: { tools?: { media?: { image?: { prompt?: string; maxChars?: number } } } };
    };
    expect(firstCall.mime).toBe("image/png");
    expect(firstCall.cfg?.tools?.media?.image?.prompt).toBe(PDF_OCR_PROMPT);
    expect(firstCall.cfg?.tools?.media?.image?.maxChars).toBe(4000);
  });

  it("returns undefined when OCR produces no text", async () => {
    describeImageFileMock.mockResolvedValue({ text: "" });

    const text = await extractPdfImageFallbackText({
      images: [
        { type: "image", data: Buffer.from("page-1").toString("base64"), mimeType: "image/png" },
      ],
      cfg: {} as OpenClawConfig,
    });

    expect(text).toBeUndefined();
  });
});
