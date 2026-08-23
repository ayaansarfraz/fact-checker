"use client";

import { useMemo, useState } from "react";
import type { Verdict } from "@/lib/types";
import { DEFAULT_UI_LIMIT } from "@/lib/limits";
import FeedItemCard from "./components/FeedItemCard";
import { useFactCheckStream } from "./components/useFactCheckStream";

const VERDICT_ORDER: Verdict[] = ["true", "false", "misleading", "unverifiable"];

const TALLY_STYLES: Record<Verdict, string> = {
  true: "text-green-700 dark:text-green-400",
  false: "text-red-700 dark:text-red-400",
  misleading: "text-amber-700 dark:text-amber-400",
  unverifiable: "text-zinc-500 dark:text-zinc-400",
};

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-700 dark:border-t-zinc-200"
      aria-hidden
    />
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [useMock, setUseMock] = useState(false);
  const [limitInput, setLimitInput] = useState(String(DEFAULT_UI_LIMIT));
  const [unlimited, setUnlimited] = useState(false);
  const { items, errors, status, start, stop } = useFactCheckStream();

  const isStreaming = status === "streaming";

  const tally = useMemo(() => {
    const counts: Record<Verdict, number> = {
      true: 0,
      false: 0,
      misleading: 0,
      unverifiable: 0,
    };
    for (const item of items) {
      for (const vc of item.claims) counts[vc.verdict]++;
    }
    return counts;
  }, [items]);

  const totalClaims = VERDICT_ORDER.reduce((sum, v) => sum + tally[v], 0);
  const canSubmit = useMock || url.trim() !== "";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isStreaming || !canSubmit) return;

    let limit: number | null = DEFAULT_UI_LIMIT;
    if (unlimited) {
      limit = null;
    } else {
      const parsed = Number(limitInput);
      if (!Number.isInteger(parsed) || parsed < 1) return;
      limit = parsed;
    }

    void start(url.trim(), useMock, limit);
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Political Speech Fact-Checker
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Paste a YouTube URL. Statements stream in with verdicts and sources
            as they are checked.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              disabled={isStreaming}
              className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={stop}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                Check
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
            <label className="flex items-center gap-2">
              <span>Statements</span>
              <input
                type="number"
                min={1}
                step={1}
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                disabled={isStreaming || unlimited}
                className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={unlimited}
                onChange={(e) => setUnlimited(e.target.checked)}
                disabled={isStreaming}
                className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
              />
              Whole speech (expensive)
            </label>
            {/* Lets the feed be exercised end to end without a working backend. */}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useMock}
                onChange={(e) => setUseMock(e.target.checked)}
                disabled={isStreaming}
                className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
              />
              Demo mode (mock stream, no API call)
            </label>
          </div>
        </form>

        {/* Status line: spinner while streaming, verdict tally once claims land. */}
        {status !== "idle" && (
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 pb-3 text-sm dark:border-zinc-800">
            {isStreaming ? (
              <span className="inline-flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <Spinner />
                Checking speech… {items.length} statement
                {items.length === 1 ? "" : "s"} so far
              </span>
            ) : (
              <span className="text-zinc-600 dark:text-zinc-400">
                Done — {items.length} statement{items.length === 1 ? "" : "s"},{" "}
                {totalClaims} claim{totalClaims === 1 ? "" : "s"}
              </span>
            )}
            {totalClaims > 0 && (
              <span className="flex flex-wrap gap-3">
                {VERDICT_ORDER.filter((v) => tally[v] > 0).map((v) => (
                  <span key={v} className={`font-medium ${TALLY_STYLES[v]}`}>
                    {tally[v]} {v}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        {errors.length > 0 && (
          <div className="mt-4 space-y-2">
            {errors.map((err, i) => (
              <div
                key={i}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
              >
                <span className="font-semibold uppercase">{err.stage}</span>{" "}
                error: {err.message}
              </div>
            ))}
          </div>
        )}

        <section className="mt-4 space-y-4">
          {items.map((item) => (
            <FeedItemCard key={item.statement.id} item={item} />
          ))}
        </section>

        {status === "done" && items.length === 0 && errors.length === 0 && (
          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
            No statements were returned for this video.
          </p>
        )}

        {status === "idle" && (
          <p className="mt-10 text-center text-sm text-zinc-400 dark:text-zinc-600">
            Results will appear here.
          </p>
        )}
      </main>
    </div>
  );
}
