import type { FeedError, FeedItem } from "@/lib/types";
import { DEFAULT_UI_LIMIT } from "@/lib/limits";
import { runPipeline } from "@/lib/pipeline";

/**
 * The Anthropic SDK + outbound web-search network calls need Node APIs, so this
 * route must run on the Node.js runtime, not the edge runtime.
 */
export const runtime = "nodejs";

/**
 * Streaming fact-check pipeline.
 *
 * POST { url, limit? } -> SSE stream of FeedItem / FeedError frames.
 *
 * `limit` caps how many statements are chunked/extracted/verified. Defaults to
 * DEFAULT_UI_LIMIT so a pasted full-length speech cannot burn unbounded API
 * spend. Pass `limit: null` (or 0) for the whole speech.
 *
 * Stage orchestration lives in `lib/pipeline.ts`; this route only turns the
 * pipeline's callbacks into SSE frames (see the contract in lib/types.ts):
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

  const parsed = body as { url?: unknown; limit?: unknown } | null;
  const url = parsed?.url;
  if (typeof url !== "string" || url.trim() === "") {
    return Response.json(
      { error: "Missing required field: url (string)." },
      { status: 400 },
    );
  }
  const videoUrl = url;

  let limit: number | undefined = DEFAULT_UI_LIMIT;
  if (parsed?.limit === null || parsed?.limit === 0) {
    // Explicit "no cap" — process the whole speech.
    limit = undefined;
  } else if (parsed?.limit !== undefined) {
    if (
      typeof parsed.limit !== "number" ||
      !Number.isInteger(parsed.limit) ||
      parsed.limit < 1
    ) {
      return Response.json(
        {
          error:
            "Invalid limit: use a positive integer, or null/0 for unlimited.",
        },
        { status: 400 },
      );
    }
    limit = parsed.limit;
  }

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

      await runPipeline(videoUrl, {
        limit,
        onItem: (item: FeedItem) => send("item", item),
        onError: (error: FeedError) => send("error", error),
      });

      if (!closed) {
        send("done", {});
        closed = true;
        try {
          controller.close();
        } catch {
          // Already torn down by a client disconnect.
        }
      }
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
