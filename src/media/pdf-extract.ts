import { execFile, type ExecFileOptions } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CanvasModule = typeof import("@napi-rs/canvas");
type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let canvasModulePromise: Promise<CanvasModule> | null = null;
let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

const PYTHON_RENDER_SCRIPT = String.raw`
import fitz
import json
import math
import os
import sys

input_path = sys.argv[1]
output_dir = sys.argv[2]
max_pixels = float(sys.argv[3])
page_numbers = [int(page) for page in sys.argv[4:]]

doc = fitz.open(input_path)
rendered = []
for page_number in page_numbers:
    page = doc.load_page(page_number - 1)
    rect = page.rect
    page_pixels = max(float(rect.width) * float(rect.height), 1.0)
    scale = max(0.1, min(2.0, math.sqrt(max_pixels / page_pixels)))
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    output_path = os.path.join(output_dir, f"page-{page_number}.png")
    pixmap.save(output_path)
    rendered.append({"page": page_number, "path": output_path})

print(json.dumps(rendered))
`;

async function loadCanvasModule(): Promise<CanvasModule> {
  if (!canvasModulePromise) {
    canvasModulePromise = import("@napi-rs/canvas").catch((err) => {
      canvasModulePromise = null;
      throw new Error(
        `Optional dependency @napi-rs/canvas is required for PDF image extraction: ${String(err)}`,
      );
    });
  }
  return canvasModulePromise;
}

async function loadPdfJsModule(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs").catch((err) => {
      pdfJsModulePromise = null;
      throw new Error(
        `Optional dependency pdfjs-dist is required for PDF extraction: ${String(err)}`,
      );
    });
  }
  return pdfJsModulePromise;
}

type PythonRenderedPage = {
  page: number;
  path: string;
};

function execFileText(
  file: string,
  args: string[],
  options: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        stdout: Buffer.isBuffer(stdout) ? stdout.toString("utf8") : stdout,
        stderr: Buffer.isBuffer(stderr) ? stderr.toString("utf8") : stderr,
      });
    });
  });
}

function parsePythonRenderedPages(stdout: string): PythonRenderedPage[] {
  const jsonStart = stdout.indexOf("[");
  if (jsonStart < 0) {
    throw new Error("PyMuPDF renderer did not return JSON output.");
  }

  const parsed = JSON.parse(stdout.slice(jsonStart)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("PyMuPDF renderer returned invalid JSON output.");
  }

  return parsed.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as { page?: unknown }).page === "number" &&
      typeof (item as { path?: unknown }).path === "string"
    ) {
      return [{ page: (item as { page: number }).page, path: (item as { path: string }).path }];
    }
    return [];
  });
}

async function renderPdfImagesWithPython(params: {
  buffer: Buffer;
  pageNumbers: number[];
  maxPixels: number;
  onImageExtractionError?: (error: unknown) => void;
}): Promise<PdfExtractedImage[]> {
  if (params.pageNumbers.length === 0) {
    return [];
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "openclaw-pdf-render-"));
  try {
    const inputPath = path.join(tempDir, "input.pdf");
    await writeFile(inputPath, params.buffer);

    const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
    for (const candidate of candidates) {
      try {
        const { stdout } = await execFileText(
          candidate,
          [
            "-c",
            PYTHON_RENDER_SCRIPT,
            inputPath,
            tempDir,
            String(Math.max(1, params.maxPixels)),
            ...params.pageNumbers.map(String),
          ],
          { maxBuffer: 1024 * 1024, timeout: 20_000 },
        );
        const renderedPages = parsePythonRenderedPages(stdout);
        const images: PdfExtractedImage[] = [];
        for (const renderedPage of renderedPages) {
          const png = await readFile(renderedPage.path);
          images.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
        }
        return images;
      } catch (err) {
        params.onImageExtractionError?.(err);
      }
    }
    return [];
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

export type PdfExtractedImage = {
  type: "image";
  data: string;
  mimeType: string;
};

export type PdfExtractedContent = {
  text: string;
  images: PdfExtractedImage[];
};

export async function extractPdfContent(params: {
  buffer: Buffer;
  maxPages: number;
  maxPixels: number;
  minTextChars: number;
  pageNumbers?: number[];
  onImageExtractionError?: (error: unknown) => void;
}): Promise<PdfExtractedContent> {
  const { buffer, maxPages, maxPixels, minTextChars, pageNumbers, onImageExtractionError } = params;
  const { getDocument } = await loadPdfJsModule();
  const require = createRequire(import.meta.url);
  const pdfJsEntry = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = `${pathToFileURL(path.resolve(path.dirname(pdfJsEntry), "..", "..", "standard_fonts")).href}/`;
  const documentParams = {
    data: new Uint8Array(buffer),
    disableWorker: true,
    standardFontDataUrl,
  } as Parameters<typeof getDocument>[0];
  const pdf = await getDocument(documentParams).promise;

  const effectivePages: number[] = pageNumbers
    ? pageNumbers.filter((p) => p >= 1 && p <= pdf.numPages).slice(0, maxPages)
    : Array.from({ length: Math.min(pdf.numPages, maxPages) }, (_, i) => i + 1);

  const textParts: string[] = [];
  for (const pageNum of effectivePages) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .filter(Boolean)
      .join(" ");
    if (pageText) {
      textParts.push(pageText);
    }
  }

  const text = textParts.join("\n\n");
  if (text.trim().length >= minTextChars) {
    return { text, images: [] };
  }

  let canvasModule: CanvasModule;
  try {
    canvasModule = await loadCanvasModule();
  } catch (err) {
    onImageExtractionError?.(err);
    return {
      text,
      images: await renderPdfImagesWithPython({
        buffer,
        pageNumbers: effectivePages,
        maxPixels,
        onImageExtractionError,
      }),
    };
  }

  const { createCanvas } = canvasModule;
  const images: PdfExtractedImage[] = [];
  const pixelBudget = Math.max(1, maxPixels);

  for (const pageNum of effectivePages) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const pagePixels = viewport.width * viewport.height;
    const scale = Math.min(1, Math.sqrt(pixelBudget / Math.max(1, pagePixels)));
    const scaled = page.getViewport({ scale: Math.max(0.1, scale) });
    const canvas = createCanvas(Math.ceil(scaled.width), Math.ceil(scaled.height));
    try {
      const canvasContext = (
        canvas as unknown as { getContext: (contextType: "2d") => unknown }
      ).getContext("2d");
      await page.render({
        canvasContext,
        viewport: scaled,
      } as unknown as Parameters<typeof page.render>[0]).promise;
      const png = canvas.toBuffer("image/png");
      images.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
    } catch (err) {
      onImageExtractionError?.(err);
    }
  }

  if (images.length > 0) {
    return { text, images };
  }

  return {
    text,
    images: await renderPdfImagesWithPython({
      buffer,
      pageNumbers: effectivePages,
      maxPixels,
      onImageExtractionError,
    }),
  };
}
