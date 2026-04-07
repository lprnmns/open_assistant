import { createServer } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import type { ResolvedGatewayAuth } from "./auth.js";
import { withTempConfig } from "./test-temp-config.js";
import { readUploadFileRef } from "./upload-file-ref.js";
import { handleUploadHttpRequest } from "./upload-http.js";

const AUTH_TOKEN: ResolvedGatewayAuth = {
  mode: "token",
  token: "test-token",
  password: undefined,
  allowTailscale: false,
};

let currentServer: ReturnType<typeof createServer> | null = null;

afterEach(async () => {
  if (!currentServer) {
    return;
  }
  await new Promise<void>((resolve) => currentServer?.close(() => resolve()));
  currentServer = null;
});

async function listenUploadServer(): Promise<number> {
  currentServer = createServer((req, res) => {
    void handleUploadHttpRequest(req, res, { auth: AUTH_TOKEN });
  });
  await new Promise<void>((resolve, reject) => {
    currentServer?.once("error", reject);
    currentServer?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = currentServer.address();
  if (!address || typeof address === "string") {
    throw new Error("upload server address missing");
  }
  return address.port;
}

describe("upload http", () => {
  test("requires bearer auth", async () => {
    await withTempConfig({
      cfg: { gateway: { trustedProxies: [] } },
      prefix: "openclaw-upload-http-",
      run: async () => {
        const port = await listenUploadServer();
        const response = await fetch(`http://127.0.0.1:${port}/upload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/pdf",
          },
          body: Buffer.from("%PDF-1.4\n"),
        });
        expect(response.status).toBe(401);
      },
    });
  });

  test("stores uploaded bytes and returns a fileRef", async () => {
    await withTempConfig({
      cfg: { gateway: { trustedProxies: [] } },
      prefix: "openclaw-upload-http-",
      run: async () => {
        const port = await listenUploadServer();
        const pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
        const response = await fetch(`http://127.0.0.1:${port}/upload`, {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/pdf",
            "X-OpenClaw-File-Name": "exam.pdf",
          },
          body: pdfBuffer,
        });
        expect(response.status).toBe(200);
        const payload = (await response.json()) as {
          ok: boolean;
          fileRef: string;
          fileName: string;
          mimeType: string;
          size: number;
        };
        expect(payload.ok).toBe(true);
        expect(payload.fileRef.startsWith("upload:")).toBe(true);
        expect(payload.fileName).toBe("exam.pdf");
        expect(payload.mimeType).toBe("application/pdf");
        expect(payload.size).toBe(pdfBuffer.byteLength);

        const uploaded = await readUploadFileRef({
          fileRef: payload.fileRef,
          maxBytes: 1024 * 1024,
        });
        expect(uploaded.fileName).toBe("exam.pdf");
        expect(uploaded.buffer.equals(pdfBuffer)).toBe(true);
      },
    });
  });
});
