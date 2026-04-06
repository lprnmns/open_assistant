import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetInteractionTrackerForTest,
  getActiveDeliveryTarget,
  getActiveChannelId,
  getActiveChannelType,
  getLastUserInteractionAt,
  recordUserInteraction,
} from "./interaction-tracker.js";
import {
  __resetInteractionPersistenceForTest,
  maybeStartInteractionPersistence,
} from "./interaction-persistence.js";

function makeStatePath(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-interaction-persistence-"),
  );
  return path.join(dir, "consciousness-state.json");
}

afterEach(async () => {
  _resetInteractionTrackerForTest();
  await __resetInteractionPersistenceForTest();
});

describe("maybeStartInteractionPersistence", () => {
  it("returns null when CONSCIOUSNESS_STATE_PATH is explicitly disabled", () => {
    expect(
      maybeStartInteractionPersistence({
        CONSCIOUSNESS_STATE_PATH: "",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("seeds the interaction tracker from persisted state", async () => {
    const statePath = makeStatePath();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          lastUserInteractionAt: 1_700_000_000_000,
          activeChannelId: "telegram:owner",
          activeChannelType: "telegram",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const lifecycle = maybeStartInteractionPersistence({
      CONSCIOUSNESS_STATE_PATH: statePath,
    } as NodeJS.ProcessEnv);

    expect(lifecycle).not.toBeNull();
    expect(getLastUserInteractionAt()).toBe(1_700_000_000_000);
    expect(getActiveDeliveryTarget()).toEqual({
      kind: "channel",
      id: "telegram:owner",
      channelType: "telegram",
    });
    expect(getActiveChannelId()).toBe("telegram:owner");
    expect(getActiveChannelType()).toBe("telegram");

    await lifecycle?.stop();
  });

  it("persists inbound interaction state even without the consciousness loop", async () => {
    const statePath = makeStatePath();
    const lifecycle = maybeStartInteractionPersistence({
      CONSCIOUSNESS_STATE_PATH: statePath,
    } as NodeJS.ProcessEnv);

    expect(lifecycle).not.toBeNull();

    recordUserInteraction("whatsapp:+15550001111", "whatsapp");
    await lifecycle?.stop();

    const persisted = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
      lastUserInteractionAt?: number;
      activeDeliveryTarget?: unknown;
      activeChannelId?: string;
      activeChannelType?: string;
    };
    expect(typeof persisted.lastUserInteractionAt).toBe("number");
    expect(persisted.activeDeliveryTarget).toEqual({
      kind: "channel",
      id: "whatsapp:+15550001111",
      channelType: "whatsapp",
    });
    expect(persisted.activeChannelId).toBe("whatsapp:+15550001111");
    expect(persisted.activeChannelType).toBe("whatsapp");
  });

  it("reuses a single lifecycle within one process", async () => {
    const statePath = makeStatePath();
    const lifecycleA = maybeStartInteractionPersistence({
      CONSCIOUSNESS_STATE_PATH: statePath,
    } as NodeJS.ProcessEnv);
    const lifecycleB = maybeStartInteractionPersistence({
      CONSCIOUSNESS_STATE_PATH: statePath,
    } as NodeJS.ProcessEnv);

    expect(lifecycleA).toBe(lifecycleB);

    await lifecycleA?.stop();
  });
});
