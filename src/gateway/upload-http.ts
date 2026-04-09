import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  requestBodyErrorToText,
} from "../infra/http-body.js";
import { extractOriginalFilename, saveMediaBuffer } from "../media/store.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import {
  authorizeHttpGatewayConnect,
  type GatewayAuthResult,
  type ResolvedGatewayAuth,
} from "./auth.js";
import {
  sendGatewayAuthFailure,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
} from "./http-common.js";
import { DEFAULT_UPLOAD_MAX_BYTES } from "./upload-constants.js";
import { getBearerToken, getHeader } from "./http-utils.js";
import { buildUploadFileRef, resolveUploadsSubdir } from "./upload-file-ref.js";

export async function handleUploadHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    maxBodyBytes?: number;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
    authorizeHttpGatewayConnectFn?: typeof authorizeHttpGatewayConnect;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/upload") {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return true;
  }

  const token = getBearerToken(req);
  const authorizeHttpGatewayConnectFn =
    opts.authorizeHttpGatewayConnectFn ?? authorizeHttpGatewayConnect;
  const authResult: GatewayAuthResult = await authorizeHttpGatewayConnectFn({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!authResult.ok) {
    sendGatewayAuthFailure(res, authResult);
    return true;
  }
  const accountUserId =
    authResult.method === "account-token" && typeof authResult.user === "string"
      ? authResult.user.trim() || undefined
      : undefined;

  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_UPLOAD_MAX_BYTES;
  let rawBody: string;
  try {
    rawBody = await readRequestBodyWithLimit(req, {
      maxBytes: maxBodyBytes,
      encoding: "latin1",
    });
  } catch (error) {
    if (isRequestBodyLimitError(error)) {
      sendJson(res, error.statusCode, {
        error: {
          message: requestBodyErrorToText(error.code),
          type: "invalid_request_error",
        },
      });
      return true;
    }
    sendInvalidRequest(res, error instanceof Error ? error.message : String(error));
    return true;
  }

  const buffer = Buffer.from(rawBody, "latin1");
  if (buffer.byteLength === 0) {
    sendInvalidRequest(res, "upload requires request body");
    return true;
  }

  const contentType = getHeader(req, "content-type")?.trim() || "application/octet-stream";
  const fileName = getHeader(req, "x-openclaw-file-name")?.trim() || undefined;
  const saved = await saveMediaBuffer(
    buffer,
    contentType,
    resolveUploadsSubdir(accountUserId),
    maxBodyBytes,
    fileName,
  );

  sendJson(res, 200, {
    ok: true,
    fileRef: buildUploadFileRef(saved.id, accountUserId),
    fileName: fileName ?? extractOriginalFilename(saved.path),
    mimeType: saved.contentType ?? contentType,
    size: saved.size,
  });
  return true;
}
