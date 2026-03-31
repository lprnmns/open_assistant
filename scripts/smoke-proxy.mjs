/**
 * scripts/smoke-proxy.mjs — Minimal OpenRouter passthrough proxy for smoke testing
 *
 * Starts a local HTTP server on port 4000 that:
 *   - Accepts POST /v1/chat/completions with any Bearer token
 *   - Maps model aliases (openrouter-strong, openrouter-cheap) → real OpenRouter model
 *   - Forwards to OpenRouter API with OPENROUTER_API_KEY from env
 *   - Returns the response verbatim
 *
 * This is a local-only smoke testing aid — NOT production code.
 * Never commit OPENROUTER_API_KEY into this file.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-v1-... node scripts/smoke-proxy.mjs
 */

import http from "node:http";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = "qwen/qwen3.6-plus-preview:free";
const PORT = process.env.SMOKE_PROXY_PORT ?? 4000;

// Model alias → real OpenRouter model name
const MODEL_MAP = {
  "openrouter-strong": OPENROUTER_MODEL,
  "openrouter-cheap": OPENROUTER_MODEL,
};

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("[smoke-proxy] OPENROUTER_API_KEY is not set — exiting.");
  process.exit(1);
}

// Never log the key value
console.log("[smoke-proxy] OPENROUTER_API_KEY present:", "YES (value masked)");
console.log(`[smoke-proxy] Listening on http://localhost:${PORT}`);

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy" }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  // Read body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyStr = Buffer.concat(chunks).toString("utf8");

  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }

  // Map alias → real model
  const alias = body.model ?? "";
  const realModel = MODEL_MAP[alias] ?? alias;
  const forwardBody = { ...body, model: realModel };

  console.log(`[smoke-proxy] ${alias} → ${realModel} | tokens_max=${body.max_tokens ?? "?"}`);

  try {
    const upstream = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://open-assistant.local",
        "X-Title": "OpenAssistant Smoke Test",
      },
      body: JSON.stringify(forwardBody),
    });

    const upstreamText = await upstream.text();
    console.log(`[smoke-proxy] upstream status=${upstream.status}`);

    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(upstreamText);
  } catch (err) {
    console.error("[smoke-proxy] upstream error:", err instanceof Error ? err.message : String(err));
    res.writeHead(502);
    res.end(JSON.stringify({ error: "upstream error", message: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`[smoke-proxy] Ready — proxying to ${OPENROUTER_BASE}`);
});

// Keep alive — killed by SIGTERM/SIGINT
process.on("SIGTERM", () => { server.close(); process.exit(0); });
process.on("SIGINT",  () => { server.close(); process.exit(0); });
