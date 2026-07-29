import type { RawTranscript } from "@/lib/types";

/**
 * STUB — implemented by Agent A (Part 1: Transcript ingest).
 *
 * Pull the transcript for a YouTube speech and assemble a RawTranscript.
 * - Parse the 11-char video id from any common YouTube URL form.
 * - Use the `youtube-transcript` npm package to fetch caption cues.
 * - Concatenate cue text into `fullText` (expect no punctuation/sentences).
 * - Throw a clear error if captions are missing/disabled.
 * (Only fall back to a Python `youtube-transcript-api` subprocess if the npm
 *  package proves unreliable — note it, don't build it preemptively.)
 *
 * Do NOT edit lib/types.ts or lib/anthropic.ts. Keep this signature exactly.
 */
export async function getTranscript(url: string): Promise<RawTranscript> {
  void url;
  throw new Error("getTranscript not implemented yet (lib/transcript.ts — Agent A).");
}
