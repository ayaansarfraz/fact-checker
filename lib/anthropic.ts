/**
 * Shared, SERVER-ONLY Anthropic client wrapper.
 *
 * This file is READ-ONLY for the stage agents. Import from it; do not edit it,
 * and do NOT construct your own `new Anthropic()` in a stage — use `callJSON`
 * (structured extraction, stages B/C) or `getClient()` + `MODEL` + `extractJSON`
 * (web-search verification, stage D).
 *
 * The API key is never exposed to the client bundle: this module must only be
 * imported from server code (API routes / server components / lib fns called
 * from them). The `import "server-only"` guard turns an accidental client
 * import into a build error.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Default model for every stage. Sonnet keeps cost down vs Opus for this call-heavy pipeline. */
export const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;

/**
 * Lazily construct the shared client. Throws a clear error (rather than failing
 * at import time) if the API key is missing, so agents can import this module
 * before a key is configured.
 */
export function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

/** A JSON Schema object describing the expected structured output. */
export type JSONSchema = Record<string, unknown>;

/**
 * Pull the first text block out of a completed message and JSON.parse it.
 * When `output_config.format` is a `json_schema`, the API guarantees the first
 * text block is valid JSON matching the schema. Throws on a refusal or if no
 * parseable text block is present.
 */
export function extractJSON<T>(message: Anthropic.Message): T {
  if (message.stop_reason === "refusal") {
    throw new Error("Model refused to answer (stop_reason: refusal).");
  }
  const text = message.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  )?.text;
  if (!text) {
    throw new Error("No text block in model response to parse as JSON.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Model output was not valid JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Run a single structured-extraction call and return the parsed JSON.
 *
 * Use this for pure text -> structured-data stages (clean+chunk, claim
 * extraction). It does not enable any tools. For web-search verification, use
 * `getClient()` directly so you can add the web_search tool and handle
 * `pause_turn`.
 *
 * @param schema  JSON Schema the output must match (use additionalProperties:false).
 */
export async function callJSON<T>(opts: {
  /** User prompt / task text. */
  prompt: string;
  /** JSON Schema for the structured response. */
  schema: JSONSchema;
  /** Optional system prompt. */
  system?: string;
  /** Output token cap. Default 8000. */
  maxTokens?: number;
}): Promise<T> {
  const { prompt, schema, system, maxTokens = 8000 } = opts;
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema } },
  });
  return extractJSON<T>(message);
}

// Re-export the SDK namespace so stages can reference Anthropic.* types
// (e.g. tool definitions, Message) without adding their own import.
export { Anthropic };
