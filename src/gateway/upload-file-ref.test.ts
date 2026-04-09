import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildUploadFileRef, resolveUploadFileRefId, resolveUploadsSubdir } from "./upload-file-ref.js";

describe("upload file refs", () => {
  it("keeps legacy flat upload refs stable", () => {
    expect(buildUploadFileRef("file-1.pdf")).toBe("upload:file-1.pdf");
    expect(resolveUploadFileRefId("upload:file-1.pdf")).toBe("file-1.pdf");
    expect(resolveUploadsSubdir()).toBe("uploads");
  });

  it("namespaces account-scoped upload refs under uploads/accounts", () => {
    expect(buildUploadFileRef("file-1.pdf", "user-123")).toBe("upload:accounts/user-123/file-1.pdf");
    expect(resolveUploadFileRefId("upload:accounts/user-123/file-1.pdf")).toBe(
      path.join("accounts", "user-123", "file-1.pdf"),
    );
    expect(resolveUploadsSubdir("user-123")).toBe(path.join("uploads", "accounts", "user-123"));
  });

  it("rejects traversal in upload file refs", () => {
    expect(resolveUploadFileRefId("upload:../file-1.pdf")).toBeUndefined();
    expect(resolveUploadFileRefId("upload:accounts/../file-1.pdf")).toBeUndefined();
    expect(resolveUploadFileRefId("upload:accounts\\user-123\\file-1.pdf")).toBeUndefined();
  });
});
