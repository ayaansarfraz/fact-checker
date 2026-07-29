"use client";

import { useCallback, useRef, useState } from "react";
import type { FeedItem, FeedError } from "@/lib/types";
import { mockSSEStream } from "./mockStream";

/**
 * Drives the fact-check feed: POSTs a YouTube URL to /api/factcheck and parses
 * the SSE frames off the response body by hand.
 *
 * EventSource can't POST, so we do the streaming read ourselves: fetch ->
 * response.body.getReader() -> decode -> split frames on the blank line.
 * See the SSE wire contract in lib/types.ts.
 */

export type StreamStatus = "idle" | "streaming" | "done";

/** One parsed SSE frame. */
interface SSEFrame {
  event: string;
  data: string;
}

/**
 * Split a raw frame ("event: item\ndata: {...}") into its fields.
 * Comment lines (starting with ":") are ignored; multiple `data:` lines are
 * joined with newlines, per the SSE spec.
 */
function parseFrame(raw: string): SSEFrame | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // A single space after the colon is part of the delimiter, not the value.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/** Read an SSE body to completion, invoking `onFrame` for each complete frame. */
async function readSSE(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SSEFrame) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // Normalize CRLF so frames always end in a bare blank line.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const frame = parseFrame(raw);
        if (frame) onFrame(frame);
      }
    }

    // Flush a trailing frame that wasn't terminated by a blank line.
    const frame = parseFrame(buffer);
    if (frame) onFrame(frame);
  } finally {
    reader.releaseLock();
  }
}

export function useFactCheckStream() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [errors, setErrors] = useState<FeedError[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);

  const pushError = useCallback((error: FeedError) => {
    setErrors((prev) => [...prev, error]);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("done");
  }, []);

  /** Start a run. `useMock` swaps in the local mock stream instead of the API. */
  const start = useCallback(
    async (url: string, useMock = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setItems([]);
      setErrors([]);
      setStatus("streaming");

      try {
        let body: ReadableStream<Uint8Array>;

        if (useMock) {
          body = mockSSEStream();
        } else {
          const res = await fetch("/api/factcheck", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url }),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            // The route returns plain JSON (not SSE) for request-level failures.
            const message = await res
              .json()
              .then((j: { error?: string }) => j.error ?? res.statusText)
              .catch(() => res.statusText || `HTTP ${res.status}`);
            pushError({ stage: "unknown", message });
            setStatus("done");
            return;
          }

          body = res.body;
        }

        await readSSE(body, (frame) => {
          if (controller.signal.aborted) return;

          if (frame.event === "done") {
            setStatus("done");
            return;
          }

          let payload: unknown;
          try {
            payload = JSON.parse(frame.data);
          } catch {
            pushError({
              stage: "unknown",
              message: `Malformed ${frame.event} frame from the server.`,
            });
            return;
          }

          if (frame.event === "item") {
            setItems((prev) => [...prev, payload as FeedItem]);
          } else if (frame.event === "error") {
            pushError(payload as FeedError);
          }
        });
      } catch (err) {
        // An abort is a user action, not a failure worth reporting.
        if (!controller.signal.aborted) {
          pushError({
            stage: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setStatus("done");
      }
    },
    [pushError],
  );

  return { items, errors, status, start, stop };
}
