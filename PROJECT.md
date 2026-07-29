# Political Speech Fact-Checker

## What this is

An agent pipeline that takes a politician's speech (pulled from YouTube), breaks it into individual factual claims, and checks each claim against real-time web sources for accuracy. Outputs a feed of statements with verdicts (true / false / misleading / unverifiable) and cited sources.

This is a fast-build prototype, not a production system. Scope is intentionally narrow: process speeches that already exist on YouTube with auto-captions available, not true live/streaming audio.

## Core pipeline

1. **Ingest**: Given a YouTube URL, pull the auto-generated transcript.
2. **Clean + chunk**: Raw auto-captions have no punctuation or sentence boundaries. An agent reconstructs proper sentences and breaks the transcript into discrete statements.
3. **Claim extraction**: An agent reads each statement and extracts discrete, checkable factual claims. Opinions and predictions are skipped.
4. **Verification**: For each claim, call Claude with web search enabled. The agent weighs the evidence and returns a verdict (true / false / misleading / unverifiable), a confidence level, and cited sources.
5. **Display**: A feed UI showing the original statement, the extracted claim(s), the verdict badge, and sources, so the reasoning is visible rather than a black-box output.

## Tech stack

- **Frontend + Backend**: Next.js (App Router) + TypeScript, single repo. Frontend lives in `/app`, backend lives in `/app/api/*` as API routes. No separate backend service.
- **Styling**: Tailwind CSS. Optionally shadcn/ui for polished components without building from scratch. Skip heavier UI libraries (Framer Motion, Radix, Zustand) for this build, plain React state is enough for a single feed page.
- **Model calls**: Anthropic API via `@anthropic-ai/sdk`, called server-side from API routes. Web search tool enabled for the verification step, no separate search API needed.
- **Transcript pulling**: Try the `youtube-transcript` npm package first (keeps everything in one language/runtime). Fall back to a Python `youtube-transcript-api` subprocess only if the Node package proves unreliable.
- **Data storage**: None for v1. Hold state in memory or write to a JSON file per session. Add Postgres via Supabase later only if persistence/history becomes a real requirement.
- **Deployment**: Vercel (zero-config for Next.js).

## Build order (do not skip ahead)

1. **Transcript proof of concept**: Pull the raw transcript for one real speech. Confirm it actually returns usable text before building anything else. Expect messy output: no punctuation, no sentence boundaries.
2. **Clean + chunk agent**: Feed the raw transcript to Claude, ask it to reconstruct sentences and split into discrete statements. Verify output quality before moving on.
3. **Claim extraction agent**: Extract checkable factual claims from 2-3 real statements as structured JSON. Confirm this looks right before moving to verification.
4. **Verification agent**: For each extracted claim, call Claude with web search, get a verdict + sources. Test against the claims from step 3.
5. **Wire into one script**: YouTube URL in, verdicts out, printed to console or JSON. This is the working proof of concept, no UI yet.
6. **UI**: Only after step 5 works end to end. Simple feed page: paste a YouTube URL, statements stream in with verdict badges as they process.

Rationale: steps 1-5 validate that the core idea actually works. UI is presentation layer only, built last so you're not debugging pipeline logic and UI at the same time.

## Known hard parts (design around these from the start)

- **Nuance over binary verdicts**: politicians often say technically-true-but-misleading things. The verdict schema must include a "misleading" / "missing context" category, not just true/false.
- **Source quality**: bias verification toward primary sources (official records, government data) over news aggregators or the answers can feel shaky.
- **Attribution risk**: if verdicts get attached to real politicians' names and shared publicly, sourcing needs to be solid and transparent, since this is the kind of output people will screenshot and argue over.

## Out of scope for v1

- Live audio/video streaming and transcription
- Twitter/X ingestion
- User accounts, auth, multi-user support
- Persistent database/history