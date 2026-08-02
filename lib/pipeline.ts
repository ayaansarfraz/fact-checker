/**
 * Part 5: the whole pipeline, wired together.
 *
 *   getTranscript(url) -> chunkTranscript(raw) -> [extractClaims -> verifyClaim]*
 *
 * This is the single source of truth for stage orchestration. Both consumers
 * build on it: the SSE route (`app/api/factcheck/route.ts`) forwards each
 * callback as a stream frame, and the CLI (`scripts/factcheck.ts`) prints them.
 */
import type { FeedError, FeedItem, Statement, VerifiedClaim } from "@/lib/types";
import { getTranscript } from "@/lib/transcript";
import { chunkTranscript } from "@/lib/chunk";
import { extractClaims } from "@/lib/extract";
import { verifyClaim } from "@/lib/verify";

/** How many statements to extract+verify at once (bounded fan-out). */
export const DEFAULT_CONCURRENCY = 4;

export interface PipelineCallbacks {
  /** One processed statement, with its verified claims (possibly empty). */
  onItem: (item: FeedItem) => void;
  /**
   * A stage failed. Transcript/chunk failures are fatal and end the run;
   * extract/verify failures are scoped to one statement and the run continues.
   */
  onError: (error: FeedError) => void;
  /** Optional human-readable progress, for the CLI. Ignored by the route. */
  onProgress?: (message: string) => void;
}

export interface PipelineOptions extends PipelineCallbacks {
  concurrency?: number;
  /**
   * Process only the first N statements. Verification runs a web search per
   * claim, so a full speech is slow and not free — the CLI exposes this to
   * keep a smoke test cheap. Undefined means the whole speech.
   */
  limit?: number;
}

/**
 * Run the full fact-check pipeline for one YouTube URL.
 *
 * Never throws: every failure is reported through `onError`. Resolves once the
 * speech has been processed (or a fatal stage failed).
 */
export async function runPipeline(
  url: string,
  options: PipelineOptions,
): Promise<void> {
  const { onItem, onError, onProgress } = options;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const fail = (stage: FeedError["stage"], err: unknown) => {
    onError({
      stage,
      message: err instanceof Error ? err.message : String(err),
    });
  };

  // 1. Transcript (fatal — nothing to do without it).
  let raw;
  try {
    raw = await getTranscript(url);
  } catch (err) {
    fail("transcript", err);
    return;
  }
  onProgress?.(
    `Transcript: ${raw.title ?? raw.videoId} — ${raw.segments.length} cues, ${raw.fullText.length} chars`,
  );

  // 2. Clean + chunk into statements (fatal).
  let statements: Statement[];
  try {
    statements = await chunkTranscript(raw);
  } catch (err) {
    fail("chunk", err);
    return;
  }
  onProgress?.(`Statements: ${statements.length}`);

  if (options.limit !== undefined && statements.length > options.limit) {
    statements = statements.slice(0, options.limit);
    onProgress?.(`Limited to the first ${statements.length} statements.`);
  }

  // 3 + 4. Per statement: extract claims, then verify each. A failure here is
  //        scoped to one statement/claim — report it and keep processing.
  const processStatement = async (statement: Statement) => {
    let claims;
    try {
      claims = await extractClaims(statement);
    } catch (err) {
      fail("extract", err);
      return;
    }

    const settled = await Promise.allSettled(
      claims.map((claim) => verifyClaim(claim)),
    );

    const verified: VerifiedClaim[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") verified.push(result.value);
      else fail("verify", result.reason);
    }

    // Emit the statement even if it produced no claims.
    onItem({ statement, claims: verified });
  };

  // Bounded worker pool: workers pull the next statement index until drained.
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < statements.length) {
      const index = nextIndex++;
      await processStatement(statements[index]);
    }
  };

  const poolSize = Math.min(concurrency, statements.length);
  try {
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
  } catch (err) {
    // Defensive: processStatement swallows its own errors, so this only trips
    // on something unexpected.
    fail("unknown", err);
  }
}
