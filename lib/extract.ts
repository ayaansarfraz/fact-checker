import type { Statement, Claim } from "@/lib/types";
import { callJSON, type JSONSchema } from "@/lib/anthropic";

/**
 * Part 3: Claim extraction.
 *
 * Read a single reconstructed statement and pull out the discrete, checkable
 * FACTUAL claims it contains. Each returned claim is one self-contained
 * assertion that could be verified against real-world sources.
 *
 * Opinions, values, rhetoric, and predictions about the future are skipped — a
 * statement made entirely of those returns an empty array, which is a valid and
 * expected result (the feed still shows the statement was processed).
 *
 * Uses the shared `callJSON` wrapper (no own Anthropic client). Output is
 * structured JSON constrained by a json_schema with additionalProperties:false.
 */

/** Shape the model must return: a flat list of claim texts. */
interface ExtractionResult {
  claims: { text: string }[];
}

const EXTRACTION_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: {
            type: "string",
            description:
              "A single, self-contained factual assertion in plain language, verifiable against sources.",
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You extract discrete, checkable FACTUAL claims from a single sentence or short passage of political speech.

A factual claim is a specific, self-contained assertion about the world that could be checked against real sources (official records, government data, reputable reporting) and found true or false. Examples: statistics, historical events, votes cast, amounts spent, who did or said what, dates, comparisons of measurable quantities.

Rules:
- Each claim must stand on its own. Resolve pronouns and vague references using the statement's context so the claim is verifiable without the surrounding text (e.g. rewrite "he raised them" as "Senator X raised taxes").
- Split a statement that bundles several distinct assertions into separate claims.
- Rephrase into a clear, neutral declarative sentence. Do not editorialize or add facts that are not stated or clearly implied.
- SKIP and do not return: opinions, value judgments, moral or aesthetic claims ("this is the greatest country"), rhetoric and applause lines, vague generalities, questions, calls to action, and PREDICTIONS about the future ("we will create a million jobs") — these are not checkable against existing sources.
- If the statement contains no checkable factual claim, return an empty claims array. Do not invent claims to fill it.`;

export async function extractClaims(statement: Statement): Promise<Claim[]> {
  const text = statement.text?.trim();
  if (!text) return [];

  const prompt = `Extract the checkable factual claims from the following statement. Return JSON matching the schema; return an empty array if there are none.

Statement:
"""
${text}
"""`;

  const result = await callJSON<ExtractionResult>({
    prompt,
    schema: EXTRACTION_SCHEMA,
    system: SYSTEM_PROMPT,
  });

  const rawClaims = Array.isArray(result?.claims) ? result.claims : [];

  return rawClaims
    .map((c) => c?.text?.trim())
    .filter((t): t is string => Boolean(t))
    .map((claimText, i) => ({
      id: `${statement.id}-c-${i}`,
      statementId: statement.id,
      text: claimText,
    }));
}
