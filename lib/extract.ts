import type { Statement, Claim } from "@/lib/types";
import { callJSON, type JSONSchema } from "@/lib/anthropic";

/**
 * Part 3: Claim extraction.
 *
 * Pull discrete, checkable FACTUAL claims from reconstructed statements.
 * Opinions, values, rhetoric, and predictions are skipped — a statement made
 * entirely of those returns an empty claims array (still a valid result).
 *
 * Batched by default: many statements share one model call so a long speech
 * does not mean one API call per sentence. `extractClaims` remains as a
 * single-statement convenience wrapper.
 */

/** How many statements to send in one extraction call. */
export const EXTRACT_BATCH_SIZE = 15;

/** Shape the model must return for a single statement. */
interface ExtractionResult {
  claims: { text: string }[];
}

/** Shape for a batch: claims keyed by the statement id we sent. */
interface BatchExtractionResult {
  results: {
    statementId: string;
    claims: { text: string }[];
  }[];
}

const CLAIM_ITEM_SCHEMA = {
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
} as const;

const EXTRACTION_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: CLAIM_ITEM_SCHEMA,
    },
  },
};

const BATCH_EXTRACTION_SCHEMA: JSONSchema = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statementId", "claims"],
        properties: {
          statementId: {
            type: "string",
            description: "The exact id of the input statement (e.g. s-0).",
          },
          claims: {
            type: "array",
            items: CLAIM_ITEM_SCHEMA,
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You extract discrete, checkable FACTUAL claims from political speech.

A factual claim is a specific, self-contained assertion about the world that could be checked against real sources (official records, government data, reputable reporting) and found true or false. Examples: statistics, historical events, votes cast, amounts spent, who did or said what, dates, comparisons of measurable quantities.

Rules:
- Each claim must stand on its own. Resolve pronouns and vague references using the statement's context so the claim is verifiable without the surrounding text (e.g. rewrite "he raised them" as "Senator X raised taxes").
- Split a statement that bundles several distinct assertions into separate claims.
- Rephrase into a clear, neutral declarative sentence. Do not editorialize or add facts that are not stated or clearly implied.
- SKIP and do not return: opinions, value judgments, moral or aesthetic claims ("this is the greatest country"), rhetoric and applause lines, vague generalities, questions, calls to action, and PREDICTIONS about the future ("we will create a million jobs") — these are not checkable against existing sources.
- If a statement contains no checkable factual claim, return an empty claims array for it. Do not invent claims to fill it.`;

function toClaims(statement: Statement, raw: { text?: string }[]): Claim[] {
  return raw
    .map((c) => c?.text?.trim())
    .filter((t): t is string => Boolean(t))
    .map((claimText, i) => ({
      id: `${statement.id}-c-${i}`,
      statementId: statement.id,
      text: claimText,
    }));
}

/** Extract claims from one statement (one model call). Prefer `extractClaimsBatch`. */
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

  return toClaims(statement, Array.isArray(result?.claims) ? result.claims : []);
}

/**
 * Extract claims from many statements in one model call.
 *
 * Returns a Map keyed by statement id. Every input statement gets an entry
 * (possibly an empty array) so the caller can emit feed items for skips too.
 */
export async function extractClaimsBatch(
  statements: Statement[],
): Promise<Map<string, Claim[]>> {
  const out = new Map<string, Claim[]>();
  const nonempty = statements.filter((s) => s.text?.trim());

  for (const s of statements) {
    if (!s.text?.trim()) out.set(s.id, []);
  }
  if (nonempty.length === 0) return out;

  if (nonempty.length === 1) {
    out.set(nonempty[0].id, await extractClaims(nonempty[0]));
    return out;
  }

  const listed = nonempty
    .map((s) => `[${s.id}]\n${s.text.trim()}`)
    .join("\n\n");

  const prompt = `Extract checkable factual claims from EACH of the following statements.
Return one results entry per statement, using the exact statementId in brackets.
If a statement has no checkable claims, return an empty claims array for it.
Do not invent statement ids that were not provided.

Statements:
${listed}`;

  const result = await callJSON<BatchExtractionResult>({
    prompt,
    schema: BATCH_EXTRACTION_SCHEMA,
    system: SYSTEM_PROMPT,
    // Batches of ~15 statements need more headroom than a single extraction.
    maxTokens: 8000,
  });

  const byId = new Map(nonempty.map((s) => [s.id, s]));
  const rawResults = Array.isArray(result?.results) ? result.results : [];

  for (const row of rawResults) {
    const statement = byId.get(row.statementId);
    if (!statement) continue;
    out.set(
      statement.id,
      toClaims(statement, Array.isArray(row.claims) ? row.claims : []),
    );
  }

  // Model occasionally drops a statement — fall back to a single call so we
  // don't silently skip it in the feed.
  for (const statement of nonempty) {
    if (!out.has(statement.id)) {
      out.set(statement.id, await extractClaims(statement));
    }
  }

  return out;
}
