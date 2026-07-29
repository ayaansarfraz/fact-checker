import type { Statement, Claim } from "@/lib/types";

/**
 * STUB — implemented by Agent C (Part 3: Claim extraction).
 *
 * Extract discrete, checkable factual claims from a single statement.
 * - Send `statement.text` to Claude via `callJSON` from lib/anthropic.ts.
 * - Return Claim[] with stable ids ("<statementId>-c-0", ...) and statementId set.
 * - Skip opinions and predictions — return [] when there are no checkable claims.
 * - Prefer structured JSON output (pass a json_schema to callJSON).
 *
 * Use the shared client wrapper — do NOT construct your own Anthropic client.
 * Do NOT edit lib/types.ts or lib/anthropic.ts. Keep this signature exactly.
 */
export async function extractClaims(statement: Statement): Promise<Claim[]> {
  void statement;
  throw new Error("extractClaims not implemented yet (lib/extract.ts — Agent C).");
}
