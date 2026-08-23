/**
 * Shared contracts for the fact-checker pipeline.
 *
 * This file is the single source of truth every pipeline stage builds against.
 * It is READ-ONLY for the stage agents — do not edit these types to fit an
 * implementation. If a type genuinely needs to change, stop and flag it so the
 * change lands in one place rather than diverging across stages.
 *
 * Data flow:
 *   YouTube URL
 *     -> getTranscript(url)      -> RawTranscript      (lib/transcript.ts)
 *     -> chunkTranscript(raw)    -> Statement[]        (lib/chunk.ts, Claude)
 *     -> extractClaimsBatch(...) -> Claim[] per stmt   (lib/extract.ts, Claude)
 *     -> verifyClaim(claim)      -> VerifiedClaim      (lib/verify.ts, Claude + web search)
 *     -> streamed as FeedItem    (app/api/factcheck/route.ts -> app/page.tsx)
 */

/** One raw caption cue from YouTube. Times are in seconds. */
export interface TranscriptSegment {
  text: string;
  /** Start time of this cue, in seconds from the video start. */
  offset: number;
  /** Duration of this cue, in seconds. */
  duration: number;
}

/** The full pulled transcript for one video. */
export interface RawTranscript {
  /** The YouTube video id (11 chars), parsed from the input URL. */
  videoId: string;
  /** Video title, if available. */
  title?: string;
  /** Ordered raw caption cues. */
  segments: TranscriptSegment[];
  /**
   * The concatenated caption text, no punctuation/sentence boundaries.
   * This is what the clean+chunk stage reconstructs into statements.
   */
  fullText: string;
}

/** A single reconstructed, punctuated statement from the speech. */
export interface Statement {
  /** Stable id, unique within a run (e.g. "s-0", "s-1", ...). */
  id: string;
  /** The cleaned, properly-punctuated sentence(s). */
  text: string;
  /** Approx. start time in the video, in seconds, for reference/citation. */
  startTime?: number;
}

/** A discrete, checkable factual claim extracted from a statement. */
export interface Claim {
  /** Stable id, unique within a run (e.g. "s-0-c-0"). */
  id: string;
  /** The id of the Statement this claim came from. */
  statementId: string;
  /** The single checkable factual assertion, in plain language. */
  text: string;
}

/**
 * The verdict for a claim. NEVER collapse to a plain true/false — "misleading"
 * (technically-true-but-misleading / missing context) is the whole point of the
 * product, and "unverifiable" covers claims that can't be settled from sources.
 */
export type Verdict = "true" | "false" | "misleading" | "unverifiable";

/** How confident the verification is in its verdict. */
export type Confidence = "high" | "medium" | "low";

/** A cited source backing a verdict. Prefer primary sources. */
export interface Source {
  title: string;
  url: string;
}

/** A claim after verification: verdict + reasoning + cited sources. */
export interface VerifiedClaim {
  claim: Claim;
  verdict: Verdict;
  confidence: Confidence;
  /** Short, plain-language justification for the verdict. */
  explanation: string;
  /** Sources consulted; should be non-empty for true/false/misleading. */
  sources: Source[];
}

/**
 * One unit streamed to the UI: an original statement together with the
 * verified claim(s) extracted from it. A statement with no checkable claims
 * is still emitted (with an empty `claims` array) so the feed shows it was
 * processed and skipped.
 */
export interface FeedItem {
  statement: Statement;
  claims: VerifiedClaim[];
}

/**
 * SSE wire contract between the API route and the UI.
 *
 * The route (`app/api/factcheck/route.ts`) writes newline-delimited SSE frames:
 *   - `event: item`  / `data: <FeedItem JSON>`   — one per processed statement
 *   - `event: error` / `data: <FeedError JSON>`  — a stage failed
 *   - `event: done`  / `data: {}`                — pipeline finished
 */
export interface FeedError {
  /** Which stage failed, for display/debugging. */
  stage: "transcript" | "chunk" | "extract" | "verify" | "unknown";
  message: string;
}
