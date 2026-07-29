import type { Claim, VerifiedClaim } from "@/lib/types";

/**
 * STUB — implemented by Agent D (Part 4: Verification).
 *
 * Verify one claim against real-time web sources.
 * - Use `getClient()` + `MODEL` from lib/anthropic.ts with the web search tool
 *   enabled: `{ type: "web_search_20260209", name: "web_search" }`
 *   (the newer `web_search_20260318` is also available; either works on Opus 4.8).
 * - Ask for a JSON verdict; parse it with `extractJSON` (or defensively).
 * - Return VerifiedClaim: verdict MUST allow "misleading" (technically-true-but-
 *   misleading / missing context), plus confidence, a short explanation, and real
 *   Source[] (bias toward primary sources — official records, government data).
 * - Handle `stop_reason === "pause_turn"` by re-sending to continue.
 *
 * Do NOT edit lib/types.ts or lib/anthropic.ts. Keep this signature exactly.
 */
export async function verifyClaim(claim: Claim): Promise<VerifiedClaim> {
  void claim;
  throw new Error("verifyClaim not implemented yet (lib/verify.ts — Agent D).");
}
