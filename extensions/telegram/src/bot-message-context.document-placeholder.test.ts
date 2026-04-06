import { beforeAll, describe, expect, it } from "vitest";

let buildTelegramMessageContextForTest: typeof import("./bot-message-context.test-harness.js").buildTelegramMessageContextForTest;

describe("buildTelegramMessageContext document placeholder fallback", () => {
  beforeAll(async () => {
    ({ buildTelegramMessageContextForTest } =
      await import("./bot-message-context.test-harness.js"));
  });

  it("keeps document-only media from falling back to an image placeholder", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: {
        text: "",
        caption: "",
        chat: { id: 42, type: "private" },
      },
      allMedia: [
        {
          path: "/tmp/invoice.pdf",
          contentType: "application/pdf",
          placeholder: "<media:document>",
        },
      ],
    });

    expect(ctx).not.toBeNull();
    expect(ctx?.ctxPayload?.BodyForAgent).toBe("<media:document>");
    expect(ctx?.ctxPayload?.Body).toContain("<media:document>");
    expect(ctx?.ctxPayload?.Body).not.toContain("<media:image>");
  });

  it("infers a document placeholder from MIME type when Telegram did not supply one", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: {
        text: "",
        caption: "",
        chat: { id: 42, type: "private" },
      },
      allMedia: [
        {
          path: "/tmp/spec.pdf",
          contentType: "application/pdf",
        },
      ],
    });

    expect(ctx).not.toBeNull();
    expect(ctx?.ctxPayload?.BodyForAgent).toBe("<media:document>");
    expect(ctx?.ctxPayload?.Body).toContain("<media:document>");
    expect(ctx?.ctxPayload?.Body).not.toContain("<media:image>");
  });
});
