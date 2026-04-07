import path from "node:path";
import { readPathWithinRoot } from "../infra/fs-safe.js";
import { extractOriginalFilename, getMediaDir } from "../media/store.js";

export const UPLOAD_FILE_REF_PREFIX = "upload:";
export const UPLOADS_SUBDIR = "uploads";

export function buildUploadFileRef(id: string): string {
  return `${UPLOAD_FILE_REF_PREFIX}${id}`;
}

export function resolveUploadFileRefId(fileRef: string): string | undefined {
  if (!fileRef.startsWith(UPLOAD_FILE_REF_PREFIX)) {
    return undefined;
  }
  const id = fileRef.slice(UPLOAD_FILE_REF_PREFIX.length).trim();
  if (!id) {
    return undefined;
  }
  const baseName = path.basename(id);
  if (baseName !== id) {
    return undefined;
  }
  return baseName;
}

export function getUploadsRootDir(): string {
  return path.join(getMediaDir(), UPLOADS_SUBDIR);
}

export async function readUploadFileRef(params: { fileRef: string; maxBytes: number }): Promise<{
  buffer: Buffer;
  fileName: string;
  realPath: string;
}> {
  const id = resolveUploadFileRefId(params.fileRef);
  if (!id) {
    throw new Error("invalid upload fileRef");
  }
  const safeRead = await readPathWithinRoot({
    rootDir: getUploadsRootDir(),
    filePath: id,
    maxBytes: params.maxBytes,
  });
  return {
    buffer: safeRead.buffer,
    fileName: extractOriginalFilename(safeRead.realPath),
    realPath: safeRead.realPath,
  };
}
