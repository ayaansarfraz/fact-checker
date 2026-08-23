/**
 * Part 5: the whole pipeline, wired together.
 *
 *   getTranscript(url) -> chunkTranscript(raw) -> [extractClaimsBatch -> verifyClaim]*
 *
 * This is the single source of truth for stage orchestration. Both consumers
 * build on it: the SSE route (`app/api/factcheck/route.ts`) forwards each
 * callback as a stream frame, and the CLI (`scripts/factcheck.ts`) prints them.
 */
import type {
  Claim,
  FeedError,
  FeedItem,
  Statement,
  VerifiedClaim,
} from "@/lib/types";
import { getTranscript } from "@/lib/transcript";
import { chunkTranscript } from "@/lib/chunk";
import { EXTRACT_BATCH_SIZE, extractClaimsBatch } from "@/lib/extract";
import { verifyClaim } from "@/lib/verify";
import { DEFAULT_UI_LIMIT } from "@/lib/limits";

export { DEFAULT_UI_LIMIT };

/** How many claims to verify at once (bounded fan-out). */
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
   * Process only the first N statements. Applied *before* chunking so a
   * limited run does not pay to reconstruct the whole speech. Verification
   * still runs a web search per claim. Undefined means the whole speech.
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

  // 2. Clean + chunk into statements (fatal). Limit is applied here so we do
  //    not spend N windowed model calls reconstructing text we will discard.
  let statements: Statement[];
  try {
    statements = await chunkTranscript(raw, {
      maxStatements: options.limit,
    });
  } catch (err) {
    fail("chunk", err);
    return;
  }

  if (options.limit !== undefined && statements.length > options.limit) {
    statements = statements.slice(0, options.limit);
  }
  onProgress?.(
    options.limit !== undefined
      ? `Statements: ${statements.length} (limit ${options.limit})`
      : `Statements: ${statements.length}`,
  );

  if (statements.length === 0) return;

  // 3 + 4. Extract in batches (one call per ~15 statements), then verify each
  //        claim. Emit items as each batch finishes so the UI still streams.
  for (let i = 0; i < statements.length; i += EXTRACT_BATCH_SIZE) {
    const batch = statements.slice(i, i + EXTRACT_BATCH_SIZE);

    let claimsByStatement: Map<string, Claim[]>;
    try {
      claimsByStatement = await extractClaimsBatch(batch);
      onProgress?.(
        `Extracted claims for statements ${i + 1}–${i + batch.length} of ${statements.length}`,
      );
    } catch (err) {
      fail("extract", err);
      continue;
    }

    const verifiedByIndex: VerifiedClaim[][] = batch.map(() => []);
    const verifyJobs: { batchIndex: number; claim: Claim }[] = [];

    for (let j = 0; j < batch.length; j++) {
      for (const claim of claimsByStatement.get(batch[j].id) ?? []) {
        verifyJobs.push({ batchIndex: j, claim });
      }
    }

    let nextJob = 0;
    const verifyWorker = async () => {
      while (nextJob < verifyJobs.length) {
        const job = verifyJobs[nextJob++];
        try {
          verifiedByIndex[job.batchIndex].push(await verifyClaim(job.claim));
        } catch (err) {
          fail("verify", err);
        }
      }
    };

    if (verifyJobs.length > 0) {
      const poolSize = Math.min(concurrency, verifyJobs.length);
      try {
        await Promise.all(
          Array.from({ length: poolSize }, () => verifyWorker()),
        );
      } catch (err) {
        fail("unknown", err);
      }
    }

    for (let j = 0; j < batch.length; j++) {
      onItem({ statement: batch[j], claims: verifiedByIndex[j] });
    }
  }
}
