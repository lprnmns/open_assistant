import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TickResult } from "./loop.js";
import { makeEventBuffer } from "./events/buffer.js";
import {
  _resetConsciousnessAuditStateForTest,
  ConsciousnessAuditLog,
  createDispatchAuditEntry,
  createTickAuditEntry,
  recordCognitiveModeTransition,
} from "./audit.js";
import { makeInitialConsciousnessState } from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  _resetConsciousnessAuditStateForTest();
  await Promise.all(
    tempDirs.splice(0).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
  );
});

describe("ConsciousnessAuditLog", () => {
  it("records dispatch entries with contentLength and success", () => {
    const entry = createDispatchAuditEntry({
      channelId: "telegram:123",
      channelType: "telegram",
      content: "Hello again",
      decision: "rate_limited",
      timestamp: 1_700_000_000_000,
    });

    expect(entry).toMatchObject({
      kind: "dispatch",
      channelId: "telegram:123",
      channelType: "telegram",
      contentLength: "Hello again".length,
      contentPreview: "Hello again",
      decision: "rate_limited",
      success: false,
    });
  });

  it("records tick entries with wake, decision, phase, and llmCallCount", () => {
    const state = makeInitialConsciousnessState();
    const result: TickResult = {
      state: {
        ...state,
        phase: "THINKING",
        llmCallCount: 3,
      },
      watchdogResult: {
        wake: true,
        reason: "TRIGGER_FIRED",
        context: "trigger fired",
      },
      decision: {
        action: "SEND_MESSAGE",
        messageContent: "hello",
      },
      nextDelayMs: 30_000,
      eventBuffer: makeEventBuffer(),
    };

    expect(createTickAuditEntry({ result, timestamp: 1_700_000_000_000 })).toMatchObject({
      kind: "tick",
      wake: true,
      decision: "SEND_MESSAGE",
      phase: "THINKING",
      llmCallCount: 3,
    });
  });

  it("persists JSONL entries when filePath is configured", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-audit-"));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, "consciousness.audit.jsonl");
    const log = new ConsciousnessAuditLog({ filePath });

    log.append(
      createDispatchAuditEntry({
        channelId: "web-chat",
        content: "Hello",
        decision: "sent",
        timestamp: 1_700_000_000_000,
      }),
    );
    await log.flush();

    const persisted = await readFile(filePath, "utf8");
    const entries = persisted
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(entries).toEqual([
      expect.objectContaining({
        kind: "dispatch",
        channelId: "web-chat",
        contentLength: 5,
        success: true,
      }),
    ]);
  });

  it("logs only real cognitive mode transitions for a session", () => {
    const log = new ConsciousnessAuditLog();

    recordCognitiveModeTransition({
      auditLog: log,
      sessionKey: "agent:main:webchat:1",
      mode: "executive",
      signals: {
        messageLength: 10,
        punctuationDensity: 0,
        urgencyHits: 1,
        typoCompressionRatio: 0.5,
        capsRatio: 0,
        hasQuestion: false,
        imperativeHits: 1,
        companionHits: 0,
      },
      timestamp: 1_700_000_000_000,
    });
    recordCognitiveModeTransition({
      auditLog: log,
      sessionKey: "agent:main:webchat:1",
      mode: "executive",
      signals: {
        messageLength: 11,
        punctuationDensity: 0,
        urgencyHits: 1,
        typoCompressionRatio: 0.5,
        capsRatio: 0,
        hasQuestion: false,
        imperativeHits: 1,
        companionHits: 0,
      },
      timestamp: 1_700_000_010_000,
    });
    recordCognitiveModeTransition({
      auditLog: log,
      sessionKey: "agent:main:webchat:1",
      mode: "companion",
      signals: {
        messageLength: 120,
        punctuationDensity: 0.03,
        urgencyHits: 0,
        typoCompressionRatio: 0.1,
        capsRatio: 0,
        hasQuestion: true,
        imperativeHits: 0,
        companionHits: 2,
      },
      timestamp: 1_700_000_020_000,
    });

    expect(log.list()).toEqual([
      expect.objectContaining({
        kind: "cognitive_mode",
        sessionKey: "agent:main:webchat:1",
        mode: "executive",
        previousMode: undefined,
      }),
      expect.objectContaining({
        kind: "cognitive_mode",
        sessionKey: "agent:main:webchat:1",
        mode: "companion",
        previousMode: "executive",
      }),
    ]);
  });
});
