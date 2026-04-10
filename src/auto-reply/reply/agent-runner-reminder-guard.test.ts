import { describe, expect, it, vi } from "vitest";
import {
  autoScheduleReminderCommitment,
  findConnectedReminderNode,
  relayAutoReminderToConnectedNode,
} from "./agent-runner-reminder-guard.js";

describe("findConnectedReminderNode", () => {
  it("prefers connected nodes that advertise reminder scheduling", () => {
    expect(
      findConnectedReminderNode([
        {
          nodeId: "ios-1",
          connected: true,
          commands: ["system.notify"],
          caps: ["system"],
        },
        {
          nodeId: "android-1",
          connected: true,
          commands: ["reminder.schedule", "reminder.cancel"],
          caps: ["reminder"],
        },
      ]),
    ).toBe("android-1");
  });

  it("returns null when no connected reminder-capable node exists", () => {
    expect(
      findConnectedReminderNode([
        {
          nodeId: "android-1",
          connected: false,
          commands: ["reminder.schedule"],
        },
      ]),
    ).toBeNull();
  });
});

describe("relayAutoReminderToConnectedNode", () => {
  it("invokes reminder.schedule on a connected reminder-capable node", async () => {
    const gatewayCall = vi
      .fn()
      .mockResolvedValueOnce({
        nodes: [
          {
            nodeId: "android-1",
            connected: true,
            commands: ["reminder.schedule"],
            caps: ["reminder"],
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true });

    const relayed = await relayAutoReminderToConnectedNode({
      commitment: {
        delayMs: 2 * 60 * 60 * 1_000,
        dueAtMs: 1_744_657_200_000,
        sourceText: "I'll remind you in 2 hours",
      },
      cronJobId: "cron-1",
      callGatewayImpl: gatewayCall as never,
    });

    expect(relayed).toBe(true);
    expect(gatewayCall).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "node.list",
      }),
    );
    expect(gatewayCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "node.invoke",
        params: {
          nodeId: "android-1",
          command: "reminder.schedule",
          idempotencyKey: expect.any(String),
          params: {
            id: "cron-1",
            title: "OpenClaw follow-up",
            body: "I'll remind you in 2 hours",
            dueAtMs: 1_744_657_200_000,
            precision: "exact",
            priority: "active",
            cronJobId: "cron-1",
          },
        },
      }),
    );
  });
});

describe("autoScheduleReminderCommitment", () => {
  it("creates a cron job and relays the reminder to a connected node", async () => {
    const gatewayCall = vi
      .fn()
      .mockResolvedValueOnce({ id: "cron-1" })
      .mockResolvedValueOnce({
        nodes: [
          {
            nodeId: "android-1",
            connected: true,
            commands: ["reminder.schedule"],
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true });

    const scheduled = await autoScheduleReminderCommitment({
      sessionKey: "main",
      payloads: [{ text: "I'll remind you in 2 hours", isError: false }],
      callGatewayImpl: gatewayCall as never,
    });

    expect(scheduled).toBe(1);
    expect(gatewayCall).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "cron.add",
      }),
    );
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
          idempotencyKey: expect.any(String),
        }),
      }),
    );
  });

  it("keeps the cron creation successful when device relay fails", async () => {
    const gatewayCall = vi
      .fn()
      .mockResolvedValueOnce({ id: "cron-1" })
      .mockResolvedValueOnce({
        nodes: [
          {
            nodeId: "android-1",
            connected: true,
            commands: ["reminder.schedule"],
          },
        ],
      })
      .mockRejectedValueOnce(new Error("node not connected"));

    const scheduled = await autoScheduleReminderCommitment({
      sessionKey: "main",
      payloads: [{ text: "I'll remind you in 2 hours", isError: false }],
      callGatewayImpl: gatewayCall as never,
    });

    expect(scheduled).toBe(1);
    expect(gatewayCall).toHaveBeenCalledTimes(3);
  });
});
