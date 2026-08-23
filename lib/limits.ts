/**
 * Shared cost/throughput knobs used by the pipeline and the UI.
 *
 * Keep this file free of server-only imports — `app/page.tsx` reads
 * DEFAULT_UI_LIMIT from here.
 */

/** How many statements the UI/API process by default (opt into unlimited). */
export const DEFAULT_UI_LIMIT = 20;
