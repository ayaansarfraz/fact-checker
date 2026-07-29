import { callJSON, type JSONSchema } from "@/lib/anthropic";
import type { RawTranscript, Statement, TranscriptSegment } from "@/lib/types";

/**
 * Part 2: Clean + chunk.
 *
 * YouTube auto-captions arrive as one long run of unpunctuated words. This
 * stage asks Claude to reconstruct sentence boundaries and punctuation, then
 * splits the result into discrete statements the claim-extraction stage can
 * work on one at a time.
 *
 * The transcript is sent in windows rather than one call: a full speech is
 * easily 40k+ characters, which would truncate against the output token cap
 * and silently drop the back half of the speech. Windows are cut on
 * whitespace, so a sentence occasionally straddles a boundary — acceptable
 * for v1.
 */

/** Roughly how many characters of raw caption text to send per model call. */
const WINDOW_CHARS = 6000;

/** Output cap per call. Reconstructed text runs longer than the raw input. */
const MAX_TOKENS = 16000;

/** Shape Claude returns; private to this stage. */
interface ChunkResponse {
  statements: { text: string }[];
}

const RESPONSE_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  required: ["statements"],
  properties: {
    statements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: {
            type: "string",
            description:
              "One discrete, self-contained, properly-punctuated statement.",
          },
        },
      },
    },
  },
};

const SYSTEM = [
  "You clean up raw YouTube auto-caption text from a political speech.",
  "The input has NO punctuation and NO sentence boundaries.",
  "Your job:",
  "1. Reconstruct proper punctuation, capitalization, and sentence boundaries.",
  "2. Split the text into discrete, self-contained statements, each expressing",
  "   a single idea and readable on its own out of context (resolve obvious",
  "   pronouns/references where a statement would otherwise be ambiguous).",
  "3. Preserve the speaker's original meaning and wording. Do NOT summarize,",
  "   paraphrase away substance, add facts, or invent content that was not said.",
  '4. Drop pure filler ("um", "uh", crowd-noise markers) but keep all',
  "   substantive content, including opinions — a later stage decides what is",
  "   checkable.",
  "The text is one excerpt from a longer speech, so it may begin or end",
  "mid-sentence. Punctuate a partial sentence as best you can and keep it;",
  "do not invent words to complete it.",
  "Return every statement in original spoken order.",
].join("\n");

/**
 * Reconstruct sentences from raw caption text and split into statements.
 *
 * Ids are assigned in speech order: "s-0", "s-1", ... `startTime` is an
 * approximation (see `approxStartTime`) and is omitted when the transcript
 * carries no caption cues.
 */
export async function chunkTranscript(raw: RawTranscript): Promise<Statement[]> {
  const fullText = raw.fullText?.trim();
  if (!fullText) return [];

  const statements: Statement[] = [];

  for (const window of splitIntoWindows(fullText, WINDOW_CHARS)) {
    const prompt = [
      "Reconstruct and split the following raw auto-caption transcript excerpt",
      "into discrete statements. Return JSON matching the schema.",
      "",
      "RAW TRANSCRIPT:",
      window.text,
    ].join("\n");

    const { statements: chunked } = await callJSON<ChunkResponse>({
      prompt,
      schema: RESPONSE_SCHEMA,
      system: SYSTEM,
      maxTokens: MAX_TOKENS,
    });

    // Statements come back in order, so their running length gives a usable
    // position within the window to hang a timestamp off.
    const windowChars = chunked.reduce((sum, s) => sum + (s.text?.length ?? 0), 0);
    let charsBefore = 0;

    for (const { text } of chunked) {
      const cleaned = text?.trim();
      const offsetInWindow =
        windowChars > 0 ? (charsBefore / windowChars) * window.text.length : 0;
      charsBefore += text?.length ?? 0;
      if (!cleaned) continue;

      statements.push({
        id: `s-${statements.length}`,
        text: cleaned,
        startTime: approxStartTime(
          raw.segments,
          (window.start + offsetInWindow) / fullText.length,
        ),
      });
    }
  }

  return statements;
}

interface Window {
  text: string;
  /** Character offset of this window's first character within the full text. */
  start: number;
}

/** Split text into ~`size`-character windows, cutting on whitespace. */
function splitIntoWindows(text: string, size: number): Window[] {
  const windows: Window[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + size, text.length);

    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start) end = lastSpace;
    }

    windows.push({ text: text.slice(start, end).trim(), start });
    start = end;
  }

  return windows.filter((w) => w.text.length > 0);
}

/**
 * Estimate a statement's start time from how far through the speech it sits.
 *
 * `fullText` is a concatenation of the caption cue texts, so a given fraction
 * of the way through it lands at roughly the same fraction of the way through
 * the cues. Good enough to cite or seek against; not frame-accurate.
 */
function approxStartTime(
  segments: TranscriptSegment[],
  fraction: number,
): number | undefined {
  if (segments.length === 0) return undefined;

  const totalChars = segments.reduce((sum, s) => sum + s.text.length, 0);
  if (totalChars === 0) return segments[0].offset;

  const target = Math.min(Math.max(fraction, 0), 1) * totalChars;

  let seen = 0;
  for (const segment of segments) {
    seen += segment.text.length;
    if (seen > target) return segment.offset;
  }

  return segments[segments.length - 1].offset;
}
