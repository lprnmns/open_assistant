const DEFAULT_BROWSER_TOOL_UNHEALTHY_MS = 5 * 60 * 1000;

let unhealthyUntilMs = 0;
let lastReason: string | null = null;

function normalizeReason(reason: unknown): string | null {
  if (typeof reason !== "string") {
    return null;
  }
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message.trim();
  }
  return String(err);
}

export function getBrowserToolAvailability(nowMs = Date.now()) {
  const available = nowMs >= unhealthyUntilMs;
  return {
    available,
    unhealthyUntilMs: available ? 0 : unhealthyUntilMs,
    reason: available ? null : lastReason,
  };
}

export function shouldExposeBrowserTool(nowMs = Date.now()): boolean {
  return getBrowserToolAvailability(nowMs).available;
}

export function markBrowserToolHealthy() {
  unhealthyUntilMs = 0;
  lastReason = null;
}

export function markBrowserToolUnhealthy(params: {
  reason?: string;
  cooldownMs?: number;
  nowMs?: number;
}) {
  const baseNowMs =
    typeof params.nowMs === "number" && Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
  const cooldownMs =
    typeof params.cooldownMs === "number" &&
    Number.isFinite(params.cooldownMs) &&
    params.cooldownMs > 0
      ? Math.floor(params.cooldownMs)
      : DEFAULT_BROWSER_TOOL_UNHEALTHY_MS;
  unhealthyUntilMs = Math.max(unhealthyUntilMs, baseNowMs + cooldownMs);
  lastReason = normalizeReason(params.reason) ?? lastReason;
}

export function shouldMarkBrowserToolUnhealthy(err: unknown): boolean {
  const message = normalizeErrorMessage(err).toLowerCase();
  return (
    message.includes("do not retry the browser tool") ||
    message.includes("can't reach the openclaw browser control service") ||
    message.includes("chrome mcp existing-session attach failed") ||
    message.includes("browser proxy failed")
  );
}

export const __testing = {
  defaultCooldownMs: DEFAULT_BROWSER_TOOL_UNHEALTHY_MS,
  resetBrowserToolAvailability() {
    unhealthyUntilMs = 0;
    lastReason = null;
  },
};
