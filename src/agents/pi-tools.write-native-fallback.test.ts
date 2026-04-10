import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  __testing,
  wrapExecToolWithNativeActionFallback,
  wrapWriteToolWithNativeActionFallback,
} from "./pi-tools.write-native-fallback.js";
import type { AnyAgentTool } from "./tools/common.js";

const TEAM_SYNC_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenClaw//C-3PO//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:team-sync-20260421T100000@openclaw
DTSTAMP:20260410T140800Z
DTSTART:20260421T100000
DTEND:20260421T110000
SUMMARY:Team sync
DESCRIPTION:Event created from the PDF schedule.
END:VEVENT
END:VCALENDAR
`;

const REMINDER_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenClaw//C-3PO//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:pay-rent-reminder-20260425T090000@openclaw
DTSTAMP:20260410T155000Z
DTSTART:20260425T090000
DTEND:20260425T091500
SUMMARY:Pay rent reminder
DESCRIPTION:Reminder created from the PDF schedule.
BEGIN:VALARM
TRIGGER:PT0M
ACTION:DISPLAY
DESCRIPTION:Pay rent reminder
END:VALARM
END:VEVENT
END:VCALENDAR
`;

const cfg = {
  agents: {
    defaults: {
      userTimezone: "Europe/Istanbul",
    },
  },
} as OpenClawConfig;

function createWriteToolMock() {
  const execute = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "wrote file" }],
    details: { ok: true },
  });
  return {
    tool: { name: "write", execute } as unknown as AnyAgentTool,
    execute,
  };
}

function createExecToolMock() {
  const execute = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "exec ran" }],
    details: { ok: true },
  });
  return {
    tool: { name: "exec", execute } as unknown as AnyAgentTool,
    execute,
  };
}

describe("wrapWriteToolWithNativeActionFallback", () => {
  it("routes calendar .ics writes into native calendar.add when a sole node is connected", async () => {
    const { tool, execute } = createWriteToolMock();
    const gatewayCall = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Bu PDF'teki team sync etkinliğini takvime ekle." }],
          },
        ],
      })
      .mockResolvedValueOnce({
        nodes: [{ nodeId: "phone-1", connected: true, commands: ["calendar.add"] }],
      })
      .mockResolvedValueOnce({
        payload: {
          event: {
            identifier: "evt-1",
            title: "Team sync",
          },
        },
      });
    const wrapped = wrapWriteToolWithNativeActionFallback(
      tool,
      { config: cfg, sessionKey: "agent:main:main" },
      { callGateway: gatewayCall },
    );

    const result = await wrapped.execute?.(
      "call-1",
      {
        path: "C:\\Users\\manas\\.openclaw\\workspace-dev\\team-sync-2026-04-21-1000.ics",
        content: TEAM_SYNC_ICS,
      },
      undefined,
      undefined,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(gatewayCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "node.list",
      }),
    );
    expect(gatewayCall).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: "node.invoke",
        params: expect.objectContaining({
          nodeId: "phone-1",
          command: "calendar.add",
          idempotencyKey: expect.any(String),
          params: expect.objectContaining({
            title: "Team sync",
            startISO: "2026-04-21T07:00:00.000Z",
            endISO: "2026-04-21T08:00:00.000Z",
          }),
        }),
      }),
    );
    const resultText = result?.content.find((block) => block.type === "text")?.text ?? "";
    expect(resultText).toContain('Successfully added event "Team sync"');
    expect(resultText).toContain("native calendar.add");
    expect(result?.details).toMatchObject({
      via: "node.invoke/calendar.add",
      nodeId: "phone-1",
      skippedWritePath: "C:\\Users\\manas\\.openclaw\\workspace-dev\\team-sync-2026-04-21-1000.ics",
    });
  });

  it("routes reminder .ics writes into cron.add and relay when not explicitly asked for ICS", async () => {
    const { tool, execute } = createWriteToolMock();
    const gatewayCall = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "pay rent için 2026 04 25 09.00 reminder oluştur" }],
          },
        ],
      })
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({
        nodes: [{ nodeId: "phone-1", connected: true, commands: ["reminder.schedule"] }],
      })
      .mockResolvedValueOnce({ payload: {} });
    const wrapped = wrapWriteToolWithNativeActionFallback(
      tool,
      {
        config: cfg,
        sessionKey: "agent:main:main",
        nowMs: () => Date.parse("2026-04-10T12:00:00.000Z"),
      },
      { callGateway: gatewayCall },
    );

    const result = await wrapped.execute?.(
      "call-2",
      {
        path: "C:\\Users\\manas\\.openclaw\\workspace-dev\\pay-rent-reminder-2026-04-25-0900.ics",
        content: REMINDER_ICS,
      },
      undefined,
      undefined,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(gatewayCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "cron.add",
        params: expect.objectContaining({
          name: "Pay rent reminder",
          sessionKey: "agent:main:main",
          deleteAfterRun: true,
          schedule: { kind: "at", at: "2026-04-25T06:00:00.000Z" },
        }),
      }),
    );
    expect(gatewayCall).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        method: "node.invoke",
        params: expect.objectContaining({
          nodeId: "phone-1",
          command: "reminder.schedule",
          idempotencyKey: expect.any(String),
          params: expect.objectContaining({
            cronJobId: "job-1",
            dueAtMs: Date.parse("2026-04-25T06:00:00.000Z"),
          }),
        }),
      }),
    );
    const resultText = result?.content.find((block) => block.type === "text")?.text ?? "";
    expect(resultText).toContain('Successfully scheduled reminder "Pay rent reminder"');
    expect(resultText).toContain("Cron job ID: job-1");
    expect(result?.details).toMatchObject({
      via: "cron.add",
      jobId: "job-1",
      relayedToNodeId: "phone-1",
      skippedWritePath:
        "C:\\Users\\manas\\.openclaw\\workspace-dev\\pay-rent-reminder-2026-04-25-0900.ics",
    });
  });

  it("preserves explicit ICS requests", async () => {
    const { tool, execute } = createWriteToolMock();
    const gatewayCall = vi.fn().mockResolvedValueOnce({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Bana bunun .ics dosyasını hazırla." }],
        },
      ],
    });
    const wrapped = wrapWriteToolWithNativeActionFallback(
      tool,
      { config: cfg, sessionKey: "agent:main:main" },
      { callGateway: gatewayCall },
    );

    await wrapped.execute?.(
      "call-3",
      {
        path: "C:\\Users\\manas\\.openclaw\\workspace-dev\\team-sync-2026-04-21-1000.ics",
        content: TEAM_SYNC_ICS,
      },
      undefined,
      undefined,
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("falls through to write when no calendar-capable node is connected", async () => {
    const { tool, execute } = createWriteToolMock();
    const gatewayCall = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Bu PDF'teki team sync etkinliğini takvime ekle." }],
          },
        ],
      })
      .mockResolvedValueOnce({ nodes: [] });
    const wrapped = wrapWriteToolWithNativeActionFallback(
      tool,
      { config: cfg, sessionKey: "agent:main:main" },
      { callGateway: gatewayCall },
    );

    await wrapped.execute?.(
      "call-4",
      {
        path: "C:\\Users\\manas\\.openclaw\\workspace-dev\\team-sync-2026-04-21-1000.ics",
        content: TEAM_SYNC_ICS,
      },
      undefined,
      undefined,
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("wrapExecToolWithNativeActionFallback", () => {
  it("routes PowerShell event .ics writes into native calendar.add", async () => {
    const { tool, execute } = createExecToolMock();
    const gatewayCall = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Bu PDF'teki Team sync etkinliğini takvime ekle." }],
          },
        ],
      })
      .mockResolvedValueOnce({
        nodes: [{ nodeId: "phone-1", connected: true, commands: ["calendar.add"] }],
      })
      .mockResolvedValueOnce({ payload: { event: { identifier: "evt-1" } } });
    const wrapped = wrapExecToolWithNativeActionFallback(
      tool,
      { config: cfg, sessionKey: "agent:main:main" },
      { callGateway: gatewayCall },
    );

    const result = await wrapped.execute?.(
      "call-exec-1",
      {
        command: `@'
${TEAM_SYNC_ICS.trim()}
'@ | Set-Content -Path 'C:\\Users\\manas\\.openclaw\\workspace-dev\\team-sync-2026-04-21-1000.ics'`,
      },
      undefined,
      undefined,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(gatewayCall).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: "node.invoke",
        params: expect.objectContaining({
          nodeId: "phone-1",
          command: "calendar.add",
          idempotencyKey: expect.any(String),
        }),
      }),
    );
    const resultText = result?.content.find((block) => block.type === "text")?.text ?? "";
    expect(resultText).toContain('Successfully added event "Team sync"');
    expect(result?.details).toMatchObject({
      via: "node.invoke/calendar.add",
      skippedWritePath: "C:\\Users\\manas\\.openclaw\\workspace-dev\\team-sync-2026-04-21-1000.ics",
    });
  });

  it("routes PowerShell reminder .ics writes into cron.add and reminder relay", async () => {
    const { tool, execute } = createExecToolMock();
    const gatewayCall = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "pay rent için 2026 04 25 09.00 reminder kur" }],
          },
        ],
      })
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({
        nodes: [{ nodeId: "phone-1", connected: true, commands: ["reminder.schedule"] }],
      })
      .mockResolvedValueOnce({ payload: {} });
    const wrapped = wrapExecToolWithNativeActionFallback(
      tool,
      {
        config: cfg,
        sessionKey: "agent:main:main",
        nowMs: () => Date.parse("2026-04-10T12:00:00.000Z"),
      },
      { callGateway: gatewayCall },
    );

    const result = await wrapped.execute?.(
      "call-exec-2",
      {
        command: `@'
${REMINDER_ICS.trim()}
'@ | Set-Content -Path 'C:\\Users\\manas\\.openclaw\\workspace-dev\\pay-rent-reminder-2026-04-25-0900.ics'`,
      },
      undefined,
      undefined,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(gatewayCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "cron.add",
      }),
    );
    expect(gatewayCall).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        method: "node.invoke",
        params: expect.objectContaining({
          nodeId: "phone-1",
          command: "reminder.schedule",
          idempotencyKey: expect.any(String),
        }),
      }),
    );
    const resultText = result?.content.find((block) => block.type === "text")?.text ?? "";
    expect(resultText).toContain('Successfully scheduled reminder "Pay rent reminder"');
    expect(result?.details).toMatchObject({
      via: "cron.add",
      relayedToNodeId: "phone-1",
      skippedWritePath:
        "C:\\Users\\manas\\.openclaw\\workspace-dev\\pay-rent-reminder-2026-04-25-0900.ics",
    });
  });

  it("falls through when exec command is not an .ics file write", async () => {
    const { tool, execute } = createExecToolMock();
    const gatewayCall = vi.fn();
    const wrapped = wrapExecToolWithNativeActionFallback(
      tool,
      { config: cfg, sessionKey: "agent:main:main" },
      { callGateway: gatewayCall },
    );

    await wrapped.execute?.(
      "call-exec-3",
      {
        command: "Write-Host 'hello world'",
      },
      undefined,
      undefined,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(gatewayCall).not.toHaveBeenCalled();
  });
});

describe("pi-tools.write-native-fallback parsing", () => {
  it("parses floating ICS timestamps in user timezone", () => {
    const event = __testing.parseFirstIcsEvent(TEAM_SYNC_ICS, "Europe/Istanbul");
    expect(event).toMatchObject({
      summary: "Team sync",
      startIso: "2026-04-21T07:00:00.000Z",
      endIso: "2026-04-21T08:00:00.000Z",
    });
  });

  it("parses ISO 8601 timestamps inside ICS event content", () => {
    const isoEvent = __testing.parseFirstIcsEvent(
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:2026-04-21T10:00:00+03:00
DTEND:2026-04-21T11:00:00+03:00
SUMMARY:ISO event
END:VEVENT
END:VCALENDAR
`,
      "Europe/Istanbul",
    );

    expect(isoEvent).toMatchObject({
      summary: "ISO event",
      startIso: "2026-04-21T07:00:00.000Z",
      endIso: "2026-04-21T08:00:00.000Z",
    });
  });

  it("extracts .ics payloads from PowerShell exec writes", () => {
    expect(
      __testing.extractIcsWritePayloadFromExecCommand(`@'
${TEAM_SYNC_ICS.trim()}
'@ | Set-Content -Path 'C:\\Users\\manas\\.openclaw\\workspace-dev\\team-sync-2026-04-21-1000.ics'`),
    ).toMatchObject({
      filePath: "C:\\Users\\manas\\.openclaw\\workspace-dev\\team-sync-2026-04-21-1000.ics",
    });
  });
});
