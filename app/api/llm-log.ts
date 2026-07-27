import path from "path";
import { createStream, type RotatingFileStream } from "rotating-file-stream";

/**
 * Conversation logging is opt-in: it stays completely disabled unless
 * `LLM_LOG_FILE` is set to a non-empty path.
 *
 * Supported env vars:
 * - LLM_LOG_FILE      target file, e.g. `./logs/llm.log` (enables the feature)
 * - LLM_LOG_MAX_SIZE  rotate once the file reaches this size, default `100M`
 * - LLM_LOG_MAX_FILES how many rotated files to keep, default `20`
 */
const LOG_FILE = (process.env.LLM_LOG_FILE ?? "").trim();

export function isLLMLogEnabled() {
  return LOG_FILE.length > 0;
}

let stream: RotatingFileStream | null = null;
let initialized = false;

function getStream() {
  if (initialized) {
    return stream;
  }
  initialized = true;

  if (!isLLMLogEnabled()) {
    return null;
  }

  try {
    const target = path.resolve(LOG_FILE);
    stream = createStream(path.basename(target), {
      path: path.dirname(target),
      size: process.env.LLM_LOG_MAX_SIZE || "100M",
      maxFiles: Number(process.env.LLM_LOG_MAX_FILES ?? 20),
      compress: "gzip",
    });
    stream.on("error", (e) => console.error("[LLM Log] stream error", e));
    console.log("[LLM Log] writing conversations to", target);
  } catch (e) {
    console.error("[LLM Log] failed to initialize", e);
    stream = null;
  }

  return stream;
}

function write(record: Record<string, unknown>) {
  const s = getStream();
  if (!s) {
    return;
  }
  try {
    s.write(JSON.stringify(record) + "\n");
  } catch (e) {
    console.error("[LLM Log] failed to write", e);
  }
}

export function newTraceId() {
  return crypto.randomUUID();
}

export interface LLMLogContext {
  /** unique per request */
  traceId: string;
  /** stable per conversation, comes from the `X-Session-Id` header */
  sessionId: string | null;
}

export function logLLMRequest(
  ctx: LLMLogContext,
  url: string,
  bodyText: string | null,
) {
  if (!isLLMLogEnabled()) {
    return;
  }

  let body: unknown = bodyText;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    // keep the raw text when it is not valid json
  }

  write({
    time: new Date().toISOString(),
    sessionId: ctx.sessionId,
    traceId: ctx.traceId,
    phase: "request",
    url,
    model: (body as { model?: string } | null)?.model,
    body,
  });
}

/**
 * Collect the completion out of either a plain json response or an SSE stream.
 */
function parseCompletion(raw: string) {
  try {
    const json = JSON.parse(raw);
    const message = json?.choices?.[0]?.message;
    if (message) {
      return {
        content: message.content ?? "",
        reasoning: message.reasoning_content ?? "",
      };
    }
    return { content: raw, reasoning: "" };
  } catch {
    // not json, fall through to SSE parsing
  }

  const contents: string[] = [];
  const reasonings: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      const delta = JSON.parse(data)?.choices?.[0]?.delta;
      if (delta?.content) {
        contents.push(delta.content);
      }
      if (delta?.reasoning_content) {
        reasonings.push(delta.reasoning_content);
      }
    } catch {
      // ignore malformed chunks
    }
  }

  return { content: contents.join(""), reasoning: reasonings.join("") };
}

export async function logLLMResponse(
  ctx: LLMLogContext,
  status: number,
  startedAt: number,
  body: ReadableStream<Uint8Array>,
) {
  if (!isLLMLogEnabled()) {
    return;
  }

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let raw = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch (e) {
    write({
      time: new Date().toISOString(),
      sessionId: ctx.sessionId,
      traceId: ctx.traceId,
      phase: "response",
      status,
      durationMs: Date.now() - startedAt,
      error: String(e),
    });
    return;
  }

  const { content, reasoning } = parseCompletion(raw);

  write({
    time: new Date().toISOString(),
    sessionId: ctx.sessionId,
    traceId: ctx.traceId,
    phase: "response",
    status,
    durationMs: Date.now() - startedAt,
    reasoning: reasoning || undefined,
    content,
  });
}
