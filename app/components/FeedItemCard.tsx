"use client";

import { useState } from "react";
import type { FeedItem, VerifiedClaim } from "@/lib/types";
import VerdictBadge from "./VerdictBadge";

function SourcesList({ sources }: { sources: VerifiedClaim["sources"] }) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) {
    return (
      <p className="mt-2 text-xs italic text-zinc-400 dark:text-zinc-500">
        No sources cited.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        aria-expanded={open}
      >
        <span
          className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ▸
        </span>
        {open ? "Hide" : "Show"} {sources.length} source
        {sources.length === 1 ? "" : "s"}
      </button>
      {open && (
        <ul className="mt-2 space-y-1 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
          {sources.map((s, i) => (
            <li key={`${s.url}-${i}`}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 underline decoration-blue-400/50 underline-offset-2 hover:decoration-blue-600 dark:text-blue-400"
              >
                {s.title || s.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClaimRow({ vc }: { vc: VerifiedClaim }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {vc.claim.text}
        </p>
        <VerdictBadge verdict={vc.verdict} confidence={vc.confidence} />
      </div>
      {vc.explanation && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {vc.explanation}
        </p>
      )}
      <SourcesList sources={vc.sources} />
    </div>
  );
}

export default function FeedItemCard({ item }: { item: FeedItem }) {
  const { statement, claims } = item;
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-base leading-relaxed text-zinc-800 dark:text-zinc-200">
        {statement.text}
      </p>
      {claims.length === 0 ? (
        <p className="mt-3 text-xs italic text-zinc-400 dark:text-zinc-500">
          Processed — no checkable factual claims.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {claims.map((vc) => (
            <ClaimRow key={vc.claim.id} vc={vc} />
          ))}
        </div>
      )}
    </article>
  );
}
