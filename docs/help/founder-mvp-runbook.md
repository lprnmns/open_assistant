---
summary: "Founder-only living-assistant runbook: environment, approval preflight, memory wiring, and live smoke."
read_when:
  - You are preparing a founder demo for the living-assistant MVP
  - You need the exact preflight and smoke steps before a live session
title: "Founder MVP Runbook"
---

# Founder MVP Runbook

This runbook is the operator checklist for the founder-only living-assistant MVP.

Use it before a live demo or a production-ish VPS restart. The goal is not just "tests pass". The goal is:

- restart-safe silence state
- restart-safe proactive cooldown
- real transcript memory
- reactive temporal recall
- hard-sanitized executive replies
- real approval routing for high-risk tools

## Hard gate

Before you start:

- Node must be `22.16+`
- Configure the consciousness env vars in your `.env`
- Ensure your gateway channel is healthy
- Ensure approval routing is ready before testing irreversible tools

Recommended first checks:

```bash
pnpm build
pnpm check
pnpm test
openclaw doctor
openclaw channels status --probe
```

## Founder env

Minimum founder MVP env:

```bash
CONSCIOUSNESS_ENABLED=1
CONSCIOUSNESS_SILENCE_THRESHOLD_MS=259200000
CONSCIOUSNESS_STATE_PATH=data/consciousness-state.json
CONSCIOUSNESS_DB_PATH=data/consciousness.db
CONSCIOUSNESS_AUDIT_LOG_PATH=data/consciousness-audit.jsonl
```

Notes:

- `CONSCIOUSNESS_SILENCE_THRESHOLD_MS=259200000` means 3 days.
- `CONSCIOUSNESS_STATE_PATH` stores silence, channel, and proactive cooldown state.
- `CONSCIOUSNESS_DB_PATH` stores transcript memory and recall data.
- `CONSCIOUSNESS_AUDIT_LOG_PATH` is the append-only timeline for tick and proactive behavior.

## Approval preflight

Run the full founder preflight before any live demo. It validates the Node version, consciousness storage paths, required MCP-backed tools, and approval routing in one report.

Basic form:

```bash
pnpm tsx scripts/check-founder-mvp.ts --channel telegram --to <chat-id> --account-id <account-id>
```

If your forwarding mode uses the origin session, give the real session key too:

```bash
pnpm tsx scripts/check-founder-mvp.ts \
  --channel telegram \
  --to <chat-id> \
  --account-id <account-id> \
  --session-key agent:main:main
```

What a good result means:

- a connected operator approval client exists
- or a forwarded approval route is ready for this request

What a blocked result means:

- no connected approval client was found
- and no forwarded approval route could be resolved for the supplied request context

Do not demo irreversible tools while this script reports `BLOCKED`.

If you only need the narrow approval-route diagnosis, keep using `pnpm tsx scripts/check-approval-routes.ts ...`.

## Startup sequence

1. Start or restart the gateway.
2. Run `openclaw doctor`.
3. Run `openclaw channels status --probe`.
4. Run `pnpm tsx scripts/check-founder-mvp.ts ...` for the real founder channel.
5. Confirm the report says `READY`.

## Live acceptance

Run these in order.

### 1. Restart-safe silence and cooldown

- Send one founder message.
- Confirm `data/consciousness-state.json` is updated.
- Trigger one proactive send.
- Restart the gateway.
- Confirm a second proactive send does not bypass cooldown immediately.

Expected result:

- last interaction survives restart
- last proactive send survives restart
- silence logic resumes from persisted state

### 2. Reactive temporal recall

- Have a short conversation.
- Let both user and assistant turns be ingested.
- Ask a temporal question such as `gecen sali ne konustuk`.

Expected result:

- the reply uses transcript memory
- recall is time-scoped, not generic semantic drift
- a temporal miss does not pull unrelated old notes

### 3. Executive mode hard filter

- Send a high-load message such as `kod patladi acil bak`.

Expected result:

- final reply is short
- no emoji
- no filler
- no motivational closing

### 4. Real approval flow

- Run a low-risk tool path such as `calendar.create`.
- Run an approval-gated path such as `email.send`.

Expected result:

- low-risk path executes directly
- high-risk path requests approval
- `/approve <id> allow-once` resumes the real tool execution

## Deterministic smoke vs live smoke

Keep these separate in reports:

- deterministic smoke proves wiring contracts and regressions
- live smoke proves the operator can actually run the product today

Passing deterministic smoke does not replace founder live smoke.

## If something is off

- Run [Doctor](/cli/doctor)
- Review [Testing](/help/testing)
- Review [Gateway troubleshooting](/gateway/troubleshooting)
- Review [Telegram](/channels/telegram) or [Discord](/channels/discord) channel-specific setup if approval routing depends on those surfaces
