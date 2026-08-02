import { YoutubeTranscript } from "youtube-transcript";
import type { RawTranscript, TranscriptSegment } from "@/lib/types";

/** A YouTube video id is exactly 11 url-safe base64 chars. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Path prefixes that put the video id in the *next* path segment. */
const ID_IN_PATH = new Set(["shorts", "live", "embed", "v", "e"]);

/**
 * Pull the 11-char video id out of any common YouTube URL form:
 *   watch?v=ID (with any extra params), youtu.be/ID, /shorts/ID, /live/ID,
 *   /embed/ID, /v/ID, m. and music. subdomains, or a bare id.
 */
export function parseVideoId(input: string): string {
  const trimmed = input.trim();
  if (VIDEO_ID.test(trimmed)) return trimmed;

  let url: URL;
  try {
    // Tolerate "youtube.com/watch?v=..." pasted without a scheme.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(`Not a YouTube URL or video id: "${input}"`);
  }

  const host = url.hostname.replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  let candidate: string | undefined;
  if (host === "youtu.be") {
    candidate = segments[0];
  } else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    candidate = ID_IN_PATH.has(segments[0])
      ? segments[1]
      : (url.searchParams.get("v") ?? undefined);
  } else {
    throw new Error(`Not a YouTube URL: "${input}"`);
  }

  if (!candidate || !VIDEO_ID.test(candidate)) {
    throw new Error(`Could not find an 11-char video id in: "${input}"`);
  }
  return candidate;
}

/**
 * Decode HTML entities the caption XML leaves behind.
 *
 * The package already decodes once, but YouTube frequently double-encodes
 * (`&amp;#39;` -> `&#39;`), so this runs a second pass over the result.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/**
 * `youtube-transcript` reports milliseconds for srv3 captions (`<p t d>`) and
 * seconds for the older format (`<text start dur>`), and which one you get
 * depends on the video. Our TranscriptSegment times are always seconds.
 *
 * The median cue duration is a reliable tell: a caption cue never stays on
 * screen for 100 seconds, but in milliseconds it always measures in the
 * thousands.
 */
function timesAreMilliseconds(raw: { offset: number; duration: number }[]): boolean {
  const durations = raw.map((r) => r.duration).filter((d) => d > 0).sort((a, b) => a - b);
  if (durations.length > 0) {
    return durations[Math.floor(durations.length / 2)] > 100;
  }
  // No usable durations — fall back to the last start time (10h+ isn't seconds).
  return Math.max(...raw.map((r) => r.offset), 0) > 36_000;
}

/** Best-effort video title via YouTube's public oEmbed endpoint. Never throws. */
async function fetchTitle(videoId: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { title?: string };
    return data.title;
  } catch {
    return undefined;
  }
}

/**
 * Pull the transcript for a YouTube speech and assemble a RawTranscript.
 *
 * Expect messy output: auto-captions have no punctuation or sentence
 * boundaries. Reconstructing sentences is the clean+chunk stage's job.
 *
 * Throws a clear error if the URL is unparseable or the video has no captions.
 */
export async function getTranscript(url: string): Promise<RawTranscript> {
  const videoId = parseVideoId(url);

  let raw;
  try {
    // Pass the bare id: the package's own URL regex misses /shorts/ and /live/.
    raw = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not fetch captions for video ${videoId}: ${message}`);
  }

  if (raw.length === 0) {
    throw new Error(
      `No captions found for video ${videoId}. Captions may be disabled, or the video may have none.`,
    );
  }

  const divisor = timesAreMilliseconds(raw) ? 1000 : 1;
  const segments: TranscriptSegment[] = raw.map((cue) => ({
    text: decodeEntities(cue.text).replace(/\s+/g, " ").trim(),
    offset: cue.offset / divisor,
    duration: cue.duration / divisor,
  }));

  const fullText = segments
    .map((s) => s.text)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!fullText) {
    throw new Error(`Captions for video ${videoId} were empty after cleaning.`);
  }

  return {
    videoId,
    title: await fetchTitle(videoId),
    segments,
    fullText,
  };
}
