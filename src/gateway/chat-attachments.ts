import { estimateBase64DecodedBytes } from "../media/base64.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";
import { DEFAULT_UPLOAD_MAX_BYTES } from "./upload-constants.js";
import { readUploadFileRef } from "./upload-file-ref.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  fileRef?: string;
  content?: unknown;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type ChatPersistedAttachment = {
  type: string;
  data: string;
  mimeType: string;
  fileName?: string;
};

export type ParsedMessageWithAttachments = {
  message: string;
  images: ChatImageContent[];
  attachments: ChatPersistedAttachment[];
};

type AttachmentLog = {
  warn: (message: string) => void;
};

type NormalizedAttachment = {
  label: string;
  mime: string;
  base64: string;
  fileName?: string;
  source: "inline" | "fileRef";
};

function normalizeMime(mime?: string): string | undefined {
  if (!mime) {
    return undefined;
  }
  const cleaned = mime.split(";")[0]?.trim().toLowerCase();
  return cleaned || undefined;
}

function isImageMime(mime?: string): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

function isValidBase64(value: string): boolean {
  // Minimal validation; avoid full decode allocations for large payloads.
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function normalizeAttachment(
  att: ChatAttachment,
  idx: number,
  opts: { stripDataUrlPrefix: boolean; requireImageMime: boolean },
): NormalizedAttachment {
  const mime = att.mimeType ?? "";
  const content = att.content;
  const label = att.fileName || att.type || `attachment-${idx + 1}`;

  if (typeof content !== "string") {
    throw new Error(`attachment ${label}: content must be base64 string`);
  }
  if (opts.requireImageMime && !mime.startsWith("image/")) {
    throw new Error(`attachment ${label}: only image/* supported`);
  }

  let base64 = content.trim();
  if (opts.stripDataUrlPrefix) {
    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,...").
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(base64);
    if (dataUrlMatch) {
      base64 = dataUrlMatch[1];
    }
  }
  return { label, mime, base64, source: "inline" };
}

async function normalizeAttachmentForParsing(
  att: ChatAttachment,
  idx: number,
  opts: { stripDataUrlPrefix: boolean; fileRefMaxBytes: number },
): Promise<NormalizedAttachment> {
  if (typeof att.content === "string") {
    return normalizeAttachment(att, idx, {
      stripDataUrlPrefix: opts.stripDataUrlPrefix,
      requireImageMime: false,
    });
  }

  const fileRef = typeof att.fileRef === "string" ? att.fileRef.trim() : "";
  const label = att.fileName || att.type || `attachment-${idx + 1}`;
  if (!fileRef) {
    throw new Error(`attachment ${label}: content must be base64 string`);
  }

  const uploaded = await readUploadFileRef({
    fileRef,
    maxBytes: opts.fileRefMaxBytes,
  });
  return {
    label: att.fileName || uploaded.fileName || label,
    mime: att.mimeType ?? "",
    base64: uploaded.buffer.toString("base64"),
    fileName: att.fileName ?? uploaded.fileName,
    source: "fileRef",
  };
}

function validateAttachmentBase64OrThrow(
  normalized: NormalizedAttachment,
  opts: { inlineMaxBytes: number; fileRefMaxBytes: number },
): number {
  if (!isValidBase64(normalized.base64)) {
    throw new Error(`attachment ${normalized.label}: invalid base64 content`);
  }
  const sizeBytes = estimateBase64DecodedBytes(normalized.base64);
  const maxBytes =
    normalized.source === "fileRef" ? opts.fileRefMaxBytes : opts.inlineMaxBytes;
  if (sizeBytes <= 0 || sizeBytes > maxBytes) {
    throw new Error(
      `attachment ${normalized.label}: exceeds size limit (${sizeBytes} > ${maxBytes} bytes)`,
    );
  }
  return sizeBytes;
}

/**
 * Parse attachments and extract images as structured content blocks.
 * Returns the message text and an array of image content blocks
 * compatible with Claude API's image format.
 */
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: {
    maxBytes?: number;
    inlineMaxBytes?: number;
    fileRefMaxBytes?: number;
    log?: AttachmentLog;
  },
): Promise<ParsedMessageWithAttachments> {
  const inlineMaxBytes = opts?.inlineMaxBytes ?? opts?.maxBytes ?? 5_000_000;
  const fileRefMaxBytes = opts?.fileRefMaxBytes ?? opts?.maxBytes ?? DEFAULT_UPLOAD_MAX_BYTES;
  const log = opts?.log;
  if (!attachments || attachments.length === 0) {
    return { message, images: [], attachments: [] };
  }

  const images: ChatImageContent[] = [];
  const persistedAttachments: ChatPersistedAttachment[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const normalized = await normalizeAttachmentForParsing(att, idx, {
      stripDataUrlPrefix: true,
      fileRefMaxBytes,
    });
    validateAttachmentBase64OrThrow(normalized, { inlineMaxBytes, fileRefMaxBytes });
    const { base64: b64, label, mime } = normalized;

    const providedMime = normalizeMime(mime);
    const sniffedMime = normalizeMime(await sniffMimeFromBase64(b64));
    const resolvedMime = sniffedMime ?? providedMime;
    if (!resolvedMime) {
      log?.warn(`attachment ${label}: unable to detect image mime type, dropping`);
      continue;
    }
    if (sniffedMime && !isImageMime(sniffedMime)) {
      log?.warn(
        `attachment ${label}: detected non-image (${sniffedMime}), keeping for file persistence`,
      );
    } else if (sniffedMime && providedMime && sniffedMime !== providedMime) {
      log?.warn(
        `attachment ${label}: mime mismatch (${providedMime} -> ${sniffedMime}), using sniffed`,
      );
    }

    const resolvedType = isImageMime(resolvedMime) ? "image" : (att.type ?? "document");
    persistedAttachments.push({
      type: resolvedType,
      data: b64,
      mimeType: resolvedMime,
      fileName: normalized.fileName ?? att.fileName,
    });
    if (!isImageMime(resolvedMime)) {
      continue;
    }
    images.push({
      type: "image",
      data: b64,
      mimeType: resolvedMime,
    });
  }

  return { message, images, attachments: persistedAttachments };
}

/**
 * @deprecated Use parseMessageWithAttachments instead.
 * This function converts images to markdown data URLs which Claude API cannot process as images.
 */
export function buildMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number },
): string {
  const maxBytes = opts?.maxBytes ?? 2_000_000; // 2 MB
  if (!attachments || attachments.length === 0) {
    return message;
  }

  const blocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: false,
      requireImageMime: true,
    });
    validateAttachmentBase64OrThrow(normalized, {
      inlineMaxBytes: maxBytes,
      fileRefMaxBytes: maxBytes,
    });
    const { base64, label, mime } = normalized;

    const safeLabel = label.replace(/\s+/g, "_");
    const dataUrl = `![${safeLabel}](data:${mime};base64,${base64})`;
    blocks.push(dataUrl);
  }

  if (blocks.length === 0) {
    return message;
  }
  const separator = message.trim().length > 0 ? "\n\n" : "";
  return `${message}${separator}${blocks.join("\n\n")}`;
}
