import path from "node:path";
import { readPathWithinRoot } from "../infra/fs-safe.js";
import { extractOriginalFilename, getMediaDir } from "../media/store.js";

export const UPLOAD_FILE_REF_PREFIX = "upload:";
export const UPLOADS_SUBDIR = "uploads";
const ACCOUNT_UPLOADS_SUBDIR = "accounts";

function encodeUploadAccountUserId(accountUserId: string): string {
  return encodeURIComponent(accountUserId.trim());
}

function resolveUploadFileRefRelativePath(fileRef: string): string | undefined {
  if (!fileRef.startsWith(UPLOAD_FILE_REF_PREFIX)) {
    return undefined;
  }
  const rawPath = fileRef.slice(UPLOAD_FILE_REF_PREFIX.length).trim();
  if (!rawPath || rawPath.includes("\\")) {
    return undefined;
  }
  const segments = rawPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }
  for (const segment of segments) {
    if (segment === "." || segment === ".." || path.basename(segment) !== segment) {
      return undefined;
    }
  }
  return path.join(...segments);
}

export function resolveUploadsSubdir(accountUserId?: string): string {
  const trimmedUserId = accountUserId?.trim();
  if (!trimmedUserId) {
    return UPLOADS_SUBDIR;
  }
  return path.join(UPLOADS_SUBDIR, ACCOUNT_UPLOADS_SUBDIR, encodeUploadAccountUserId(trimmedUserId));
}

export function buildUploadFileRef(id: string, accountUserId?: string): string {
  const baseName = path.basename(id.trim());
  if (!baseName) {
    throw new Error("upload fileRef id required");
  }
  const trimmedUserId = accountUserId?.trim();
  if (!trimmedUserId) {
    return `${UPLOAD_FILE_REF_PREFIX}${baseName}`;
  }
  return `${UPLOAD_FILE_REF_PREFIX}${ACCOUNT_UPLOADS_SUBDIR}/${encodeUploadAccountUserId(trimmedUserId)}/${baseName}`;
}

export function resolveUploadFileRefId(fileRef: string): string | undefined {
  return resolveUploadFileRefRelativePath(fileRef);
}

export function getUploadsRootDir(): string {
  return path.join(getMediaDir(), UPLOADS_SUBDIR);
}

export async function readUploadFileRef(params: { fileRef: string; maxBytes: number }): Promise<{
  buffer: Buffer;
  fileName: string;
  realPath: string;
}> {
  const relativePath = resolveUploadFileRefId(params.fileRef);
  if (!relativePath) {
    throw new Error("invalid upload fileRef");
  }
  const safeRead = await readPathWithinRoot({
    rootDir: getUploadsRootDir(),
    filePath: relativePath,
    maxBytes: params.maxBytes,
  });
  return {
    buffer: safeRead.buffer,
    fileName: extractOriginalFilename(safeRead.realPath),
    realPath: safeRead.realPath,
  };
}
