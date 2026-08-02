/**
 * Stage D — verification.
 *
 * Takes a single extracted `Claim`, checks it against real-time web sources
 * using Claude with the web search tool enabled, and returns a `VerifiedClaim`
 * with a verdict, confidence, plain-language explanation, and cited sources.
 *
 * This is the one stage that runs a server-side tool loop, so it uses
 * `getClient()` + `MODEL` directly (rather than `callJSON`) to enable the
 * web_search tool and to handle the `pause_turn` stop reason.
 */
import "server-only";
import {
  getClient,
  MODEL,
  extractJSON,
  Anthropic,
  type JSONSchema,
} from "@/lib/anthropic";
import type {
  Claim,
  VerifiedClaim,
  Verdict,
  Confidence,
  Source,
} from "@/lib/types";

/** Max times to resume a paused server-side search loop before giving up. */
const MAX_PAUSE_CONTINUATIONS = 5;

/** Cap on web searches per claim, so one claim can't run away with the budget. */
const MAX_SEARCHES = 6;

const VERDICTS: readonly Verdict[] = [
  "true",
  "false",
  "misleading",
  "unverifiable",
];
const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];

/** Shape returned by the model (the schema below), before we attach `claim`. */
interface VerificationResult {
  verdict: Verdict;
  confidence: Confidence;
  explanation: string;
  sources: Source[];
}

/**
 * JSON Schema for the structured verification result. Mirrors `VerifiedClaim`
 * minus the `claim` field (which we attach ourselves from the input).
 */
const RESULT_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: VERDICTS,
      description:
        "The verdict. Use 'misleading' for claims that are technically true " +
        "but leave out context or create a false impression, and " +
        "'unverifiable' when the available sources can't settle the claim. " +
        "Never collapse a nuanced claim to a plain true/false.",
    },
    confidence: {
      type: "string",
      enum: CONFIDENCES,
      description:
        "How confident you are in the verdict, given the evidence found. " +
        "Use 'low' when the evidence is thin, indirect, or conflicting.",
    },
    explanation: {
      type: "string",
      description:
        "A short, plain-language justification for the verdict (2-4 sentences). " +
        "Reference what the sources show. Avoid jargon. For a 'misleading' " +
        "verdict, say explicitly what is accurate and what context is missing.",
    },
    sources: {
      type: "array",
      description:
        "The real sources you actually used to reach the verdict, best/most " +
        "authoritative first. Prefer primary sources. Empty only for " +
        "'unverifiable'.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "The page/document title." },
          url: { type: "string", description: "The real source URL." },
        },
        required: ["title", "url"],
      },
    },
  },
  required: ["verdict", "confidence", "explanation", "sources"],
};

const SYSTEM_PROMPT = `You are a rigorous, non-partisan fact-checker verifying a single factual claim from a political speech.

How to work:
- Use the web_search tool to find current, relevant evidence. Do not answer from memory: figures, records, and rankings move, and a stale number is the main way this goes wrong. Search more than once if the first results are thin or conflicting.
- Weigh the evidence you find. Bias STRONGLY toward primary sources — official government data (BLS, CBO, Census, Treasury, Fed), legislative and voting records, court filings, agency reports, official transcripts, company filings — over news aggregators, opinion pieces, or partisan blogs. When a primary source and an aggregator disagree, trust the primary source. Use reputable news outlets for events with no primary record yet, or to locate the primary record — never as the sole basis for a numerical claim a primary source could settle.
- Check the claim as a listener would hear it, not the most charitable or the most damning reading.
- Decide a verdict:
  - "true": the claim is accurate and fairly stated.
  - "false": the claim is contradicted by the evidence.
  - "misleading": the claim is technically true but omits key context, cherry-picks, or creates a false impression. This category is the whole point of this product and is the right verdict more often than people expect — cherry-picked start dates, missing denominators, causation implied from correlation, real figures attributed to the wrong cause or actor. Do not round a technically-accurate-but-misleading claim up to "true".
  - "unverifiable": the claim cannot be settled from available sources (e.g. it is vague, about private facts, or the evidence is genuinely absent or contradictory). Do not guess to avoid it.
- Set confidence (high/medium/low) based on how strong and consistent the evidence is.
- Cite the specific pages you actually relied on, primary sources first, not a site's front page. Do not fabricate URLs.
- Keep the explanation short and in plain language.`;

/** The web search tool, enabled on every request in the verification loop. */
const WEB_SEARCH_TOOL: Anthropic.ToolUnion = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: MAX_SEARCHES,
};

/**
 * Verify a single claim against web sources.
 *
 * @param claim The extracted claim to check.
 * @returns The claim with a verdict, confidence, explanation, and sources.
 */
export async function verifyClaim(claim: Claim): Promise<VerifiedClaim> {
  const client = getClient();

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Verify this factual claim from a political speech:\n\n"${claim.text}"\n\nSearch for evidence, then return your verdict.`,
    },
  ];

  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages,
    tools: [WEB_SEARCH_TOOL],
    output_config: { format: { type: "json_schema", schema: RESULT_SCHEMA } },
  };

  let message = await client.messages.create(request);

  // The web_search tool runs a server-side loop. If it reaches the iteration
  // cap the turn pauses (`pause_turn`); re-send the conversation with the
  // paused assistant turn appended so the server resumes where it left off.
  // No extra user message — the API sees the trailing server tool use and
  // continues on its own.
  for (
    let i = 0;
    message.stop_reason === "pause_turn" && i < MAX_PAUSE_CONTINUATIONS;
    i++
  ) {
    messages.push({ role: "assistant", content: message.content });
    message = await client.messages.create({ ...request, messages });
  }

  if (message.stop_reason === "pause_turn") {
    throw new Error(
      `Web search did not finish for claim ${claim.id} after ${MAX_PAUSE_CONTINUATIONS} continuations.`,
    );
  }

  const result = parseResult(message, claim);

  return {
    claim,
    verdict: result.verdict,
    confidence: result.confidence,
    explanation: result.explanation,
    sources: result.sources,
  };
}

/**
 * Pull the structured result out of the completed message.
 *
 * `extractJSON` reads the first text block, which is right for a plain
 * structured-output call. With web search enabled the model sometimes narrates
 * before searching, so the JSON can land in a later text block — fall back to
 * scanning from the end when the first block isn't parseable.
 */
function parseResult(
  message: Anthropic.Message,
  claim: Claim,
): VerificationResult {
  let result: VerificationResult;
  try {
    result = extractJSON<VerificationResult>(message);
  } catch (err) {
    const fallback = lastParseableJSON(message);
    if (!fallback) throw err;
    result = fallback;
  }

  // The json_schema output format should guarantee these, but the verdict is
  // the core contract of this product — fail loudly rather than let a bad
  // value flow into the feed.
  if (!VERDICTS.includes(result.verdict)) {
    throw new Error(
      `Model returned an unknown verdict "${result.verdict}" for claim ${claim.id}.`,
    );
  }
  if (!CONFIDENCES.includes(result.confidence)) {
    throw new Error(
      `Model returned an unknown confidence "${result.confidence}" for claim ${claim.id}.`,
    );
  }

  return {
    ...result,
    sources: (result.sources ?? []).filter((s) => s?.title && s?.url),
  };
}

function lastParseableJSON(
  message: Anthropic.Message,
): VerificationResult | null {
  const texts = message.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  for (let i = texts.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(texts[i].text) as VerificationResult;
    } catch {
      // Not the JSON block — keep looking.
    }
  }
  return null;
}
