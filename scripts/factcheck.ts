/**
 * Part 5: the end-to-end proof of concept. YouTube URL in, verdicts out.
 *
 *   npm run factcheck -- "<youtube-url>" [--limit N] [--concurrency N] [--json out.json]
 *
 * No UI — this is the console/JSON harness for the pipeline in lib/pipeline.ts,
 * and the fastest way to check a real speech end to end.
 */
import { writeFile } from "node:fs/promises";
import type { FeedError, FeedItem, Verdict } from "@/lib/types";
import { DEFAULT_CONCURRENCY, runPipeline } from "@/lib/pipeline";

interface Args {
  url: string;
  limit?: number;
  concurrency: number;
  jsonPath?: string;
}

const USAGE = `Usage: npm run factcheck -- "<youtube-url>" [options]

Options:
  --limit N         Only process the first N statements (default: all).
  --concurrency N   Statements processed at once (default: ${DEFAULT_CONCURRENCY}).
  --json <path>     Also write the full run to a JSON file.`;

function parseArgs(argv: string[]): Args {
  let url: string | undefined;
  let limit: number | undefined;
  let concurrency = DEFAULT_CONCURRENCY;
  let jsonPath: string | undefined;

  const number = (flag: string, value: string | undefined): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`${flag} needs a positive integer, got: ${value}`);
    }
    return parsed;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--limit":
        limit = number("--limit", argv[++i]);
        break;
      case "--concurrency":
        concurrency = number("--concurrency", argv[++i]);
        break;
      case "--json":
        jsonPath = argv[++i];
        if (!jsonPath) throw new Error("--json needs a file path.");
        break;
      case "-h":
      case "--help":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        if (url) throw new Error(`Unexpected second URL: ${arg}`);
        url = arg;
    }
  }

  if (!url) throw new Error(`Missing the YouTube URL.\n\n${USAGE}`);
  return { url, limit, concurrency, jsonPath };
}

/** Verdict badges. "misleading" is the point of the product — make it visible. */
const BADGE: Record<Verdict, string> = {
  true: "\x1b[32m[TRUE]\x1b[0m",
  false: "\x1b[31m[FALSE]\x1b[0m",
  misleading: "\x1b[33m[MISLEADING]\x1b[0m",
  unverifiable: "\x1b[90m[UNVERIFIABLE]\x1b[0m",
};

function printItem(item: FeedItem): void {
  const time =
    item.statement.startTime !== undefined
      ? ` (${formatTime(item.statement.startTime)})`
      : "";
  console.log(`\n── ${item.statement.id}${time} ─────────────────────────────`);
  console.log(`"${item.statement.text}"`);

  if (item.claims.length === 0) {
    console.log("   no checkable claims");
    return;
  }

  for (const { claim, verdict, confidence, explanation, sources } of item.claims) {
    console.log(`\n   ${BADGE[verdict]} (${confidence} confidence) ${claim.text}`);
    console.log(`   ${explanation}`);
    for (const source of sources) {
      console.log(`     - ${source.title}: ${source.url}`);
    }
  }
}

function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.local.example to .env.local and fill it in.",
    );
  }

  const items: FeedItem[] = [];
  const errors: FeedError[] = [];
  const startedAt = Date.now();

  console.log(`Fact-checking ${args.url}\n`);

  await runPipeline(args.url, {
    concurrency: args.concurrency,
    limit: args.limit,
    onProgress: (message) => console.log(message),
    onItem: (item) => {
      items.push(item);
      printItem(item);
    },
    onError: (error) => {
      errors.push(error);
      console.error(`\n!! [${error.stage}] ${error.message}`);
    },
  });

  // --- Summary -------------------------------------------------------------
  const claims = items.flatMap((item) => item.claims);
  const counts = claims.reduce<Record<string, number>>((acc, { verdict }) => {
    acc[verdict] = (acc[verdict] ?? 0) + 1;
    return acc;
  }, {});

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n═══ Done in ${elapsed}s ═══`);
  console.log(`Statements: ${items.length}   Claims: ${claims.length}`);
  for (const verdict of ["true", "false", "misleading", "unverifiable"] as const) {
    console.log(`  ${verdict.padEnd(13)} ${counts[verdict] ?? 0}`);
  }
  if (errors.length > 0) console.log(`Errors: ${errors.length}`);

  if (args.jsonPath) {
    await writeFile(
      args.jsonPath,
      JSON.stringify({ url: args.url, items, errors }, null, 2),
    );
    console.log(`\nWrote ${args.jsonPath}`);
  }

  // A run that produced nothing is a failure, even though no stage threw.
  if (items.length === 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
