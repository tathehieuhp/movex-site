import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./system-prompt.js";

const MAX_MESSAGES = 20;
const MAX_CHARS_PER_MESSAGE = 2000;
const MAX_OUTPUT_TOKENS = 4096;
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
// Models that accept the server-side refusal fallback in its "default" form.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

function parseList(value) {
  return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin, env) {
  const allowed = parseList(env.ALLOWED_ORIGINS);
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

function pickModel(requested, env) {
  const allowed = parseList(env.ALLOWED_MODELS);
  if (requested && allowed.includes(requested)) return requested;
  return env.DEFAULT_MODEL;
}

// Accepts only alternating user/assistant plain-text turns, ending with the user.
function sanitizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const messages = input.slice(-MAX_MESSAGES).map((m) => ({
    role: m && m.role === "assistant" ? "assistant" : "user",
    content: typeof m?.content === "string" ? m.content.slice(0, MAX_CHARS_PER_MESSAGE).trim() : "",
  }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return null;
  for (let i = 0; i < messages.length; i++) {
    if (!messages[i].content) return null;
    if (i > 0 && messages[i].role === messages[i - 1].role) return null;
  }
  return messages;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
    if (!cors["Access-Control-Allow-Origin"]) return json({ error: "Origin not allowed" }, 403, cors);

    if (env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "Bạn gửi quá nhanh, vui lòng thử lại sau ít phút." }, 429, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }
    const messages = sanitizeMessages(body?.messages);
    if (!messages) return json({ error: "Invalid messages" }, 400, cors);

    const model = pickModel(body?.model, env);
    const effort = EFFORTS.has(env.EFFORT) ? env.EFFORT : "low";
    const params = {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      output_config: { effort },
      messages,
    };
    if (FALLBACK_MODELS.has(model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const send = (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

    const run = async () => {
      try {
        const stream = client.beta.messages.stream(params);
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            await send({ text: event.delta.text });
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          await send({ error: "Xin lỗi, tôi không thể trả lời câu hỏi này." });
        }
        await send({ done: true });
      } catch (err) {
        console.error("Claude API error", err instanceof Anthropic.APIError ? err.status : "", err?.message);
        const message =
          err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && err.status === 529)
            ? "Trợ lý đang quá tải, vui lòng thử lại sau."
            : "Đã có lỗi xảy ra, vui lòng thử lại.";
        await send({ error: message });
      } finally {
        await writer.close();
      }
    };
    // Keep the Worker alive until streaming finishes.
    ctx.waitUntil(run());

    return new Response(readable, {
      headers: {
        ...cors,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  },
};
