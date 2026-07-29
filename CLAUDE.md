# Project Context

Political speech fact-checker. Full concept, architecture, and build order live in `PROJECT.md`, read that first if it exists in the repo.

Working style: prioritize readability and speed of iteration over cleverness. This is a fast-build prototype, not production infrastructure, don't over-engineer.

## Stack

- Next.js (App Router) + TypeScript for both frontend and backend, no separate backend service
- Frontend: `/app`
- API routes: `/app/api/*`
- Styling: Tailwind CSS, optionally shadcn/ui components
- Model calls: `@anthropic-ai/sdk`, called server-side only from API routes, never expose the API key client-side
- Transcript pulling: `youtube-transcript` npm package first, only fall back to a Python subprocess if it proves unreliable
- No database for v1, in-memory or JSON file state only
- Deploy target: Vercel

## Build order

Follow this order, don't skip ahead to UI before earlier stages are verified working:
1. Transcript pull, proof of concept on one real speech
2. Clean + chunk transcript into statements
3. Claim extraction agent
4. Verification agent (web search enabled, verdict schema below)
5. Wire stages 1-4 into one script, console/JSON output, no UI
6. UI

## Verdict schema

Every claim verdict must be one of: `true`, `false`, `misleading`, `unverifiable`. Never collapse to a plain true/false, misleading claims are the whole point of this product. Include sources and a confidence level with every verdict.

## Commands

```bash
npm run dev       # local dev server
```
(update this section as real commands get added, e.g. test/lint/build)

## Rules for fixing mistakes

When you (Claude) make a mistake, get corrected by the user, or hit a bug caused by a wrong assumption:
1. Fix the immediate issue first.
2. Before ending your turn, add a short entry to the "Lessons learned" section below describing the mistake and the correct approach, so it isn't repeated in a future session.
3. Keep entries short, one or two lines. Overwrite or remove an entry if it becomes outdated or gets contradicted by a later fix, don't just keep stacking conflicting notes.
4. Don't log one-off typos or trivial issues, only things that reflect a wrong assumption about the codebase, the APIs, or the approach.

## Lessons learned

(empty, will be filled in as mistakes get caught and fixed)