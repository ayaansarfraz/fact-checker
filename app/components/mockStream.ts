import type { FeedItem, FeedError } from "@/lib/types";

/**
 * A small inline mock of the SSE stream the real API route produces, so the UI
 * (and the SSE parser it feeds) is fully exercisable before the backend exists.
 *
 * It emits the exact same wire format as the route: `event: <type>` + `data: <JSON>`
 * frames separated by blank lines, and even splits frames mid-buffer to prove the
 * parser handles partial chunks. Toggle it on from the page via `USE_MOCK`.
 */

const MOCK_ITEMS: FeedItem[] = [
  {
    statement: { id: "s-0", text: "Our unemployment rate is the lowest it has been in fifty years.", startTime: 12 },
    claims: [
      {
        claim: { id: "s-0-c-0", statementId: "s-0", text: "The unemployment rate is the lowest in 50 years." },
        verdict: "misleading",
        confidence: "medium",
        explanation:
          "The rate briefly hit a multi-decade low, but the specific '50 years' framing omits comparable lows in earlier periods.",
        sources: [
          { title: "Bureau of Labor Statistics — Unemployment Rate", url: "https://www.bls.gov/cps/" },
          { title: "FRED — Civilian Unemployment Rate", url: "https://fred.stlouisfed.org/series/UNRATE" },
        ],
      },
    ],
  },
  {
    statement: { id: "s-1", text: "I think this is the most important election of our lifetime.", startTime: 40 },
    claims: [],
  },
  {
    statement: { id: "s-2", text: "We passed the largest tax cut in American history and crime fell by twenty percent.", startTime: 71 },
    claims: [
      {
        claim: { id: "s-2-c-0", statementId: "s-2", text: "It was the largest tax cut in American history." },
        verdict: "false",
        confidence: "high",
        explanation: "By share of GDP, several prior tax cuts were larger.",
        sources: [
          { title: "Committee for a Responsible Federal Budget", url: "https://www.crfb.org/" },
        ],
      },
      {
        claim: { id: "s-2-c-1", statementId: "s-2", text: "Crime fell by twenty percent." },
        verdict: "unverifiable",
        confidence: "low",
        explanation: "No time range or jurisdiction is specified, so the 20% figure cannot be checked against a source.",
        sources: [],
      },
    ],
  },
  {
    statement: { id: "s-3", text: "The bill I signed created two million new jobs in its first year.", startTime: 105 },
    claims: [
      {
        claim: { id: "s-3-c-0", statementId: "s-3", text: "The bill created two million jobs in its first year." },
        verdict: "true",
        confidence: "high",
        explanation: "Payroll data confirms roughly two million jobs added in the twelve months following enactment.",
        sources: [
          { title: "BLS — Employment Situation", url: "https://www.bls.gov/news.release/empsit.nr0.htm" },
        ],
      },
    ],
  },
];

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Build a ReadableStream of SSE bytes that mimics the real route. */
export function mockSSEStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Simulate network latency between statements.
      await new Promise((r) => setTimeout(r, 500));

      if (i < MOCK_ITEMS.length) {
        const text = frame("item", MOCK_ITEMS[i]);
        // Deliberately split one frame across two chunks to exercise buffering.
        if (i === 1) {
          const mid = Math.floor(text.length / 2);
          controller.enqueue(encoder.encode(text.slice(0, mid)));
          await new Promise((r) => setTimeout(r, 120));
          controller.enqueue(encoder.encode(text.slice(mid)));
        } else {
          controller.enqueue(encoder.encode(text));
        }
        i++;
        return;
      }

      controller.enqueue(encoder.encode(frame("done", {})));
      controller.close();
    },
  });
}

/** Optional: a stream that emits an error frame, for testing the error path. */
export function mockErrorStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const err: FeedError = { stage: "transcript", message: "Mock: no captions available for this video." };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frame("error", err)));
      controller.enqueue(encoder.encode(frame("done", {})));
      controller.close();
    },
  });
}
