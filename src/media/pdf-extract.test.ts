import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("extractPdfContent", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("passes standardFontDataUrl to pdf.js document loading", async () => {
    const getTextContent = vi.fn().mockResolvedValue({
      items: [{ str: "Enough extracted text" }],
    });
    const getPage = vi.fn().mockResolvedValue({
      getTextContent,
    });
    const getDocument = vi.fn(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage,
      }),
    }));

    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
      getDocument,
    }));

    const { extractPdfContent } = await import("./pdf-extract.js");
    const result = await extractPdfContent({
      buffer: Buffer.from("%PDF-1.4"),
      maxPages: 1,
      maxPixels: 1_000,
      minTextChars: 1,
    });

    expect(result).toEqual({ text: "Enough extracted text", images: [] });
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        disableWorker: true,
        standardFontDataUrl: expect.stringMatching(/^file:.*\/standard_fonts\/$/),
      }),
    );
  });

  it("keeps extracted text when PDF image rendering fails", async () => {
    const render = vi.fn(() => ({
      promise: Promise.reject(new Error("render failed")),
    }));
    const getTextContent = vi.fn().mockResolvedValue({
      items: [{ str: "Short text" }],
    });
    const getPage = vi.fn().mockResolvedValue({
      getTextContent,
      getViewport: vi.fn(() => ({ width: 100, height: 100 })),
      render,
    });
    const getDocument = vi.fn(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage,
      }),
    }));
    const onImageExtractionError = vi.fn();

    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
      getDocument,
    }));
    vi.doMock("@napi-rs/canvas", () => ({
      createCanvas: vi.fn(() => ({
        getContext: vi.fn(() => ({})),
        toBuffer: vi.fn(() => Buffer.from("not used")),
      })),
    }));

    const { extractPdfContent } = await import("./pdf-extract.js");
    const result = await extractPdfContent({
      buffer: Buffer.from("%PDF-1.4"),
      maxPages: 1,
      maxPixels: 1_000,
      minTextChars: 200,
      onImageExtractionError,
    });

    expect(result).toEqual({ text: "Short text", images: [] });
    expect(onImageExtractionError).toHaveBeenCalledWith(expect.any(Error));
  });
});
