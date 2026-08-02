import type { FeedError, FeedItem } from "@/lib/types";
import { runPipeline } from "@/lib/pipeline";

/**
 * The Anthropic SDK + outbound web-search network calls need Node APIs, so this
 * route must run on the Node.js runtime, not the edge runtime.
 */
export const runtime = "nodejs";

/**
 * Streaming fact-check pipeline.
 *
 * POST { url } -> SSE stream of FeedItem / FeedError frames.
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

      await runPipeline(videoUrl, {
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
