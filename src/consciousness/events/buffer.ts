/**
 * src/consciousness/events/buffer.ts — Bounded Event Buffer
 *
 * Holds incoming events from two distinct surfaces and injects them into the
 * LLM prompt in a controlled, bounded form.
 *
 * ── Two surfaces ──────────────────────────────────────────────────────────────
 *
 *   owner_active_channel
 *     Events from the owner's own active channel (e.g. the owner's own messages,
 *     system notifications addressed to the owner).  The Loop Engine MAY respond
 *     to these via SEND_MESSAGE → routes to snap.activeChannelId.
 *
 *   third_party_contact
 *     Events from external contacts (e.g. a Telegram message from a friend,
 *     an incoming email from a colleague).
 *
 *     ── CRITICAL DPE RULE ─────────────────────────────────────────────────────
 *     The Loop Engine MUST NOT auto-send replies to third-party contacts.
 *     These events are surfaced as READ-ONLY context in the LLM prompt.
 *     Any reply to a third-party contact requires explicit owner approval
 *     through a separate human-in-the-loop path (not implemented here).
 *     SEND_MESSAGE from the loop ALWAYS routes to snap.activeChannelId (owner
 *     channel) — it has no path to third_party_contact sources.
 *     ──────────────────────────────────────────────────────────────────────────
 *
 * ── Deduplication ─────────────────────────────────────────────────────────────
 *
 *   Each event carries a caller-assigned `id`.  addEvent() drops incoming events
 *   whose (surface, id) pair already exists in the buffer.  This makes the buffer
 *   idempotent under repeated delivery — the caller may re-push any event without
 *   risk of duplicates.
 *
 * ── Bounded eviction ─────────────────────────────────────────────────────────
 *
 *   The buffer enforces capacityPerSurface independently for each surface.
 *   When a surface reaches capacity, the oldest event (smallest receivedAt) is
 *   evicted to make room for the incoming event.  The two surfaces do not share
 *   capacity — a flood of third-party events cannot evict owner-channel events.
 *
 * ── Prompt injection ─────────────────────────────────────────────────────────
 *
 *   buildEventPromptLines() renders at most maxPerSurface events per surface,
 *   each truncated to maxCharsPerEvent.  The third-party section is labelled
 *   explicitly as read-only to guide the LLM away from attempting auto-replies.
 *
 * ── Immutability ─────────────────────────────────────────────────────────────
 *
 *   All operations return new EventBuffer values.  No mutation in place.
 *   Consistent with the functional style used throughout the consciousness stack.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Which communication surface an event originated from.
 *
 *   owner_active_channel  — from/for the owner's own active channel
 *   third_party_contact   — from an external contact; auto-reply is FORBIDDEN
 */
export type EventSurface = "owner_active_channel" | "third_party_contact";

/**
 * A single buffered event from an external surface.
 * Immutable after creation — the buffer only holds, never modifies.
 */
export type BufferedEvent = {
  /**
   * Stable caller-assigned identifier.  Used for deduplication within a surface.
   * Two events with the same id on DIFFERENT surfaces are independent.
   * Example: "telegram:msg:42", "email:abc123".
   */
  readonly id: string;
  /** Which surface this event arrived on. */
  readonly surface: EventSurface;
  /**
   * Channel/source identifier.
   * Examples: "telegram:+14155552671", "email:alice@example.com", "whatsapp:channel-99".
   */
  readonly source: string;
  /**
   * Bounded human-readable summary of the event's content.
   * Pre-truncated by the caller; this field is injected verbatim into the LLM prompt.
   * Do not put PII beyond what is necessary for the LLM to reason about the event.
   */
  readonly summary: string;
  /** Unix ms when this event was buffered. */
  readonly receivedAt: number;
};

/** Immutable event buffer holding events from both surfaces. */
export type EventBuffer = {
  /**
   * All buffered events, ordered newest-first by receivedAt.
   * Invariant: at most capacityPerSurface events per surface.
   */
  readonly events: readonly BufferedEvent[];
  /** Maximum events retained per surface. */
  readonly capacityPerSurface: number;
};

// ── Defaults ──────────────────────────────────────────────────────────────────

export const BUFFER_DEFAULTS = {
  /** Max events retained per surface before oldest are evicted. */
  capacityPerSurface: 50,
  /** Max events per surface injected into the LLM prompt per tick. */
  maxPerSurface: 5,
  /** Max characters per event summary line in the prompt. */
  maxCharsPerEvent: 200,
} as const;

// ── Factory ───────────────────────────────────────────────────────────────────

/** Create an empty EventBuffer with the given (or default) per-surface capacity. */
export function makeEventBuffer(
  capacityPerSurface: number = BUFFER_DEFAULTS.capacityPerSurface,
): EventBuffer {
  return { events: [], capacityPerSurface };
}

// ── addEvent ──────────────────────────────────────────────────────────────────

/**
 * Add an event to the buffer.
 *
 * Behaviour:
 *   1. Dedup: if (surface, id) already exists → return buffer unchanged.
 *   2. Prepend the new event (newest-first ordering).
 *   3. Per-surface eviction: if that surface now exceeds capacityPerSurface,
 *      drop the oldest events (those with the largest slice index after sort).
 *
 * The two surfaces are evicted independently — a flood of third-party events
 * cannot displace owner-channel events.
 *
 * @returns New EventBuffer.  Input buffer is never mutated.
 */
export function addEvent(buffer: EventBuffer, event: BufferedEvent): EventBuffer {
  // Step 1: dedup by (surface, id)
  const alreadyExists = buffer.events.some(
    (e) => e.surface === event.surface && e.id === event.id,
  );
  if (alreadyExists) return buffer;

  // Step 2: prepend (becomes newest)
  const withNew = [event, ...buffer.events];

  // Step 3: per-surface bounded eviction
  // Partition, cap each surface independently, then merge newest-first.
  const ownerEvents = withNew
    .filter((e) => e.surface === "owner_active_channel")
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, buffer.capacityPerSurface);

  const thirdEvents = withNew
    .filter((e) => e.surface === "third_party_contact")
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, buffer.capacityPerSurface);

  // Merge the two partitions maintaining newest-first global order.
  const merged = mergeNewestFirst(ownerEvents, thirdEvents);

  return { ...buffer, events: merged };
}

/** Merge two newest-first arrays into a single newest-first array. */
function mergeNewestFirst(
  a: readonly BufferedEvent[],
  b: readonly BufferedEvent[],
): readonly BufferedEvent[] {
  const result: BufferedEvent[] = [];
  let ai = 0;
  let bi = 0;
  while (ai < a.length && bi < b.length) {
    // newer (larger receivedAt) comes first
    if (a[ai]!.receivedAt >= b[bi]!.receivedAt) {
      result.push(a[ai]!);
      ai++;
    } else {
      result.push(b[bi]!);
      bi++;
    }
  }
  while (ai < a.length) result.push(a[ai++]!);
  while (bi < b.length) result.push(b[bi++]!);
  return result;
}

// ── listBySurface ─────────────────────────────────────────────────────────────

/**
 * Return buffered events for a specific surface, newest-first.
 * If `limit` is provided, returns at most that many events.
 */
export function listBySurface(
  buffer: EventBuffer,
  surface: EventSurface,
  limit?: number,
): readonly BufferedEvent[] {
  const filtered = buffer.events.filter((e) => e.surface === surface);
  return limit !== undefined ? filtered.slice(0, limit) : filtered;
}

// ── drainByIds ────────────────────────────────────────────────────────────────

/**
 * Remove events from the buffer by (surface, id) pairs.
 *
 * Used by the ack/consume flow: once the Loop Engine has acted on an event
 * (e.g. taken a note about it), drain it so it is not re-injected on the
 * next tick.
 *
 * Pairs not present in the buffer are silently ignored (idempotent).
 *
 * @returns New EventBuffer without the drained events.
 */
export function drainByIds(
  buffer: EventBuffer,
  ids: ReadonlyArray<{ surface: EventSurface; id: string }>,
): EventBuffer {
  if (ids.length === 0) return buffer;
  const keySet = new Set(ids.map((x) => `${x.surface}\0${x.id}`));
  return {
    ...buffer,
    events: buffer.events.filter((e) => !keySet.has(`${e.surface}\0${e.id}`)),
  };
}

// ── buildEventPromptLines ─────────────────────────────────────────────────────

export type BuildEventPromptOptions = {
  /**
   * Max events per surface to include.
   * Default: BUFFER_DEFAULTS.maxPerSurface
   */
  maxPerSurface?: number;
  /**
   * Max characters per summary line in the output.
   * Default: BUFFER_DEFAULTS.maxCharsPerEvent
   */
  maxCharsPerEvent?: number;
};

/**
 * Build a prompt-ready string representing buffered events for LLM injection.
 *
 * Returns an empty string when the buffer contains no events.
 *
 * ── DPE enforcement in the prompt ────────────────────────────────────────────
 * The third-party contact section is explicitly labelled:
 *   "read-only — reply requires owner approval via the human-approval path"
 * This instructs the LLM to treat these events as context only and not attempt
 * SEND_MESSAGE in response to them.  SEND_MESSAGE from the loop is architecturally
 * limited to snap.activeChannelId (owner channel); this label is a second guard.
 */
export function buildEventPromptLines(
  buffer: EventBuffer,
  opts: BuildEventPromptOptions = {},
): string {
  const maxPer = opts.maxPerSurface ?? BUFFER_DEFAULTS.maxPerSurface;
  const maxChars = opts.maxCharsPerEvent ?? BUFFER_DEFAULTS.maxCharsPerEvent;

  const ownerEvents = listBySurface(buffer, "owner_active_channel", maxPer);
  const thirdEvents = listBySurface(buffer, "third_party_contact", maxPer);

  if (ownerEvents.length === 0 && thirdEvents.length === 0) return "";

  const lines: string[] = ["Buffered events:"];

  if (ownerEvents.length > 0) {
    lines.push(`  Owner channel (${ownerEvents.length}):`);
    for (const e of ownerEvents) {
      lines.push(`    [${new Date(e.receivedAt).toISOString()}] ${e.source}: ${cap(e.summary, maxChars)}`);
    }
  }

  if (thirdEvents.length > 0) {
    // DPE label: third-party events are read-only context; SEND_MESSAGE must NOT target these sources.
    lines.push(
      `  Third-party contacts (${thirdEvents.length}) — read-only, reply requires owner approval:`,
    );
    for (const e of thirdEvents) {
      lines.push(`    [${new Date(e.receivedAt).toISOString()}] ${e.source}: ${cap(e.summary, maxChars)}`);
    }
  }

  return lines.join("\n");
}

function cap(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
