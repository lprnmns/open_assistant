import { describe, expect, it } from "vitest";
import { sanitizeExecutiveOutput, sanitizeExecutiveReplyPayload } from "./executive-sanitizer.js";

describe("executive-sanitizer", () => {
  it("strips emoji and filler while preserving code blocks and urls", () => {
    const input = [
      "Tabii ki \u{1F60A}",
      "Kok neden bu.",
      "",
      "```ts",
      "console.log('\\u{1F642}');",
      "```",
      "",
      "https://example.com/path?q=1",
      "Baska bir sey var mi?",
    ].join("\n");

    const output = sanitizeExecutiveOutput(input);

    expect(output).toBe(
      [
        "Kok neden bu.",
        "",
        "```ts",
        "console.log('\\u{1F642}');",
        "```",
        "",
        "https://example.com/path?q=1",
      ].join("\n"),
    );
  });

  it("sanitizes reply payload text without mutating non-text payloads", () => {
    expect(
      sanitizeExecutiveReplyPayload({
        text: "Of course \u{1F60A}\nDeploy failed.",
      }),
    ).toEqual({
      text: "Deploy failed.",
    });

    const payload = { mediaUrl: "file:///tmp/out.mp3" };
    expect(sanitizeExecutiveReplyPayload(payload)).toBe(payload);
  });

  it("strips emoji shortcodes and text emoticons", () => {
    const output = sanitizeExecutiveOutput("Sure thing :wave: :)\nService is back.");
    expect(output).toBe("Service is back.");
  });
});
