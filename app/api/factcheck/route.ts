import type { FeedItem, FeedError, Statement, VerifiedClaim } from "@/lib/types";
import { getTranscript } from "@/lib/transcript";
import { chunkTranscript } from "@/lib/chunk";
import { extractClaims } from "@/lib/extract";
import { verifyClaim } from "@/lib/verify";

/**
 * The Anthropic SDK + outbound web-search network calls need Node APIs, so this
 * route must run on the Node.js runtime, not the edge runtime.
 */
export const runtime = "nodejs";

/** How many statements to extract+verify at once (bounded fan-out). */
const CONCURRENCY = 4;

/**
 * Streaming fact-check pipeline.
 *
 * POST { url } -> SSE stream of FeedItem / FeedError frames.
 *
 * Pipeline:
 *   getTranscript(url) -> chunkTranscript(raw) -> [extractClaims -> verifyClaim]*
 *
 * Frames (see the SSE contract in lib/types.ts):
 *   event: item  / data: <FeedItem JSON>   — one per processed statement
 *   event: error / data: <FeedError JSON>  — a stage failed
 *   event: done  / data: {}                — pipeline finished
 */
export async function POST(req: Request): Promise<Response> {
  // --- Parse + validate the request body -----------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const url = (body as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || url.trim() === "") {
    return Response.json(
      { error: "Missing required field: url (string)." },
      { status: 400 },
    );
  }
  const videoUrl = url;

  // --- Build the SSE stream ------------------------------------------------
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Client hung up — enqueueing on the dead controller throws. Stop
          // writing, but let the in-flight pipeline unwind on its own.
          closed = true;
        }
      };

      const sendError = (stage: FeedError["stage"], err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        send("error", { stage, message } satisfies FeedError);
      };

      const finish = () => {
        if (closed) return;
        send("done", {});
        closed = true;
        try {
          controller.close();
        } catch {
          // Already torn down by a client disconnect.
        }
      };

      // 1. Transcript (fatal — nothing to do without it).
      let raw;
      try {
        raw = await getTranscript(videoUrl);
      } catch (err) {
        sendError("transcript", err);
        finish();
        return;
      }

      // 2. Clean + chunk into statements (fatal).
      let statements: Statement[];
      try {
        statements = await chunkTranscript(raw);
      } catch (err) {
        sendError("chunk", err);
        finish();
        return;
      }

      // 3 + 4. Per statement: extract claims, then verify each.
      //        A failure here is scoped to one statement/claim — emit an error
      //        frame for the failing stage and keep processing the rest.
      const processStatement = async (statement: Statement) => {
        let claims;
        try {
          claims = await extractClaims(statement);
        } catch (err) {
          sendError("extract", err);
          return;
        }

        const settled = await Promise.allSettled(
          claims.map((claim) => verifyClaim(claim)),
        );

        const verified: VerifiedClaim[] = [];
        for (const result of settled) {
          if (result.status === "fulfilled") verified.push(result.value);
          else sendError("verify", result.reason);
        }

        // Emit the statement even if it produced no claims.
        send("item", { statement, claims: verified } satisfies FeedItem);
      };

      // Bounded worker pool: workers pull the next statement index until drained.
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < statements.length) {
          const index = nextIndex++;
          await processStatement(statements[index]);
        }
      };

      const poolSize = Math.min(CONCURRENCY, statements.length);
      try {
        await Promise.all(Array.from({ length: poolSize }, () => worker()));
      } catch (err) {
        // Defensive: processStatement swallows its own errors, so this only
        // trips on something unexpected.
        sendError("unknown", err);
      }

      finish();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
