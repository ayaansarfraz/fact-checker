import type { Verdict, Confidence } from "@/lib/types";

const VERDICT_STYLES: Record<Verdict, { label: string; className: string }> = {
  true: {
    label: "True",
    className:
      "bg-green-100 text-green-800 ring-green-600/20 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-400/30",
  },
  false: {
    label: "False",
    className:
      "bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/30",
  },
  misleading: {
    label: "Misleading",
    className:
      "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30",
  },
  unverifiable: {
    label: "Unverifiable",
    className:
      "bg-zinc-200 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-500/15 dark:text-zinc-300 dark:ring-zinc-400/30",
  },
};

export default function VerdictBadge({
  verdict,
  confidence,
}: {
  verdict: Verdict;
  confidence?: Confidence;
}) {
  const style = VERDICT_STYLES[verdict];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${style.className}`}
      >
        {style.label}
      </span>
      {confidence && (
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {confidence} confidence
        </span>
      )}
    </span>
  );
}
