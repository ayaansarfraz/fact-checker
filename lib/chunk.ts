import type { RawTranscript, Statement } from "@/lib/types";

/**
 * STUB — implemented by Agent B (Part 2: Clean + chunk).
 *
 * Reconstruct sentences from raw, punctuation-free caption text and split into
 * discrete statements.
 * - Send `raw.fullText` to Claude via `callJSON` from lib/anthropic.ts.
 * - Return Statement[] with stable ids ("s-0", "s-1", ...) and cleaned text.
 * - Prefer structured JSON output (pass a json_schema to callJSON).
 *
 * Use the shared client wrapper — do NOT construct your own Anthropic client.
 * Do NOT edit lib/types.ts or lib/anthropic.ts. Keep this signature exactly.
 */
export async function chunkTranscript(raw: RawTranscript): Promise<Statement[]> {
  void raw;
  throw new Error("chunkTranscript not implemented yet (lib/chunk.ts — Agent B).");
}
