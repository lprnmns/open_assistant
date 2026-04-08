import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";
import {
  formatValidationErrors,
  validateAgentParams,
  validateChatSendParams,
  validateConnectParams,
  validateSessionsSendParams,
  validateTalkConfigResult,
} from "./index.js";

const makeError = (overrides: Partial<ErrorObject>): ErrorObject => ({
  keyword: "type",
  instancePath: "",
  schemaPath: "#/",
  params: {},
  message: "validation error",
  ...overrides,
});

describe("formatValidationErrors", () => {
  it("returns unknown validation error when missing errors", () => {
    expect(formatValidationErrors(undefined)).toBe("unknown validation error");
    expect(formatValidationErrors(null)).toBe("unknown validation error");
  });

  it("returns unknown validation error when errors list is empty", () => {
    expect(formatValidationErrors([])).toBe("unknown validation error");
  });

  it("formats additionalProperties at root", () => {
    const err = makeError({
      keyword: "additionalProperties",
      params: { additionalProperty: "token" },
    });

    expect(formatValidationErrors([err])).toBe("at root: unexpected property 'token'");
  });

  it("formats additionalProperties with instancePath", () => {
    const err = makeError({
      keyword: "additionalProperties",
      instancePath: "/auth",
      params: { additionalProperty: "token" },
    });

    expect(formatValidationErrors([err])).toBe("at /auth: unexpected property 'token'");
  });

  it("formats message with path for other errors", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "/auth",
      message: "must have required property 'token'",
    });

    expect(formatValidationErrors([err])).toBe("at /auth: must have required property 'token'");
  });

  it("de-dupes repeated entries", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "/auth",
      message: "must have required property 'token'",
    });

    expect(formatValidationErrors([err, err])).toBe(
      "at /auth: must have required property 'token'",
    );
  });
});

describe("validateTalkConfigResult", () => {
  it("accepts Talk SecretRef payloads", () => {
    expect(
      validateTalkConfigResult({
        config: {
          talk: {
            provider: "elevenlabs",
            providers: {
              elevenlabs: {
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "ELEVENLABS_API_KEY",
                },
              },
            },
            resolved: {
              provider: "elevenlabs",
              config: {
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "ELEVENLABS_API_KEY",
                },
              },
            },
            apiKey: {
              source: "env",
              provider: "default",
              id: "ELEVENLABS_API_KEY",
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects normalized talk payloads without talk.resolved", () => {
    expect(
      validateTalkConfigResult({
        config: {
          talk: {
            provider: "elevenlabs",
            providers: {
              elevenlabs: {
                voiceId: "voice-normalized",
              },
            },
          },
        },
      }),
    ).toBe(false);
  });
});

describe("attachment RPC validators", () => {
  it("accepts connect auth payloads with accountToken", () => {
    expect(
      validateConnectParams({
        minProtocol: 1,
        maxProtocol: 1,
        client: {
          id: "test",
          version: "1.0.0",
          platform: "test",
          mode: "test",
        },
        auth: {
          accountToken: "acct_token_123",
        },
      }),
    ).toBe(true);
  });

  it("accepts fileRef-based chat.send attachments", () => {
    expect(
      validateChatSendParams({
        sessionKey: "main",
        message: "review this staged pdf",
        idempotencyKey: "idem-file-ref-1",
        attachments: [
          {
            type: "document",
            fileName: "exam.pdf",
            fileRef: "upload:test-file",
          },
        ],
      }),
    ).toBe(true);
  });

  it("accepts nested source attachments for sessions.send", () => {
    expect(
      validateSessionsSendParams({
        key: "main",
        message: "see image",
        attachments: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "Zm9v",
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects malformed attachment entries for agent.send", () => {
    expect(
      validateAgentParams({
        message: "hello",
        idempotencyKey: "idem-agent-1",
        attachments: [
          {
            fileRef: "upload:test-file",
            unexpected: true,
          },
        ],
      }),
    ).toBe(false);
  });
});
