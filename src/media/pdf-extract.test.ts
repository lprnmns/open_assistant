import { writeFileSync } from "node:fs";
import path from "node:path";
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
    vi.doMock("node:child_process", () => ({
      execFile: vi.fn((...args: unknown[]) => {
        const callback = args.at(-1);
        if (typeof callback === "function") {
          callback(new Error("python unavailable"));
        }
        return {};
      }),
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

  it("uses PyMuPDF when PDF canvas rendering produces no images", async () => {
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

    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
      getDocument,
    }));
    vi.doMock("@napi-rs/canvas", () => ({
      createCanvas: vi.fn(() => ({
        getContext: vi.fn(() => ({})),
        toBuffer: vi.fn(() => Buffer.from("not used")),
      })),
    }));
    vi.doMock("node:child_process", () => ({
      execFile: vi.fn((...args: unknown[]) => {
        const execArgs = args[1] as string[];
        const callback = args.at(-1);
        const tempDir = execArgs[3];
        const outputPath = path.join(tempDir, "page-1.png");
        writeFileSync(outputPath, Buffer.from("png data"));
        if (typeof callback === "function") {
          callback(null, JSON.stringify([{ page: 1, path: outputPath }]), "");
        }
        return {};
      }),
    }));

    const { extractPdfContent } = await import("./pdf-extract.js");
    const result = await extractPdfContent({
      buffer: Buffer.from("%PDF-1.4"),
      maxPages: 1,
      maxPixels: 1_000,
      minTextChars: 200,
    });

    expect(result).toEqual({
      text: "Short text",
      images: [
        { type: "image", data: Buffer.from("png data").toString("base64"), mimeType: "image/png" },
      ],
    });
  });
});
