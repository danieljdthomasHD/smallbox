"use client";

import type { Confidence, SourceId, SourceRef } from "@/lib/types";

/** Shared vocabulary for "where did this come from and how sure are we". */

export const SOURCE_LABEL: Record<SourceId, string> = {
  osm: "OpenStreetMap",
  usda: "USDA directory",
  google: "Google",
  news: "Local news",
  events: "Events listing",
  community: "Community",
};

const CONFIDENCE_STYLE: Record<
  Confidence,
  { text: string; className: string; explain: string }
> = {
  verified: {
    text: "Mapped",
    className: "bg-accent-soft text-accent",
    explain: "Listed in a map or official directory.",
  },
  reported: {
    text: "Reported",
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    explain: "Submitted by a person, or corroborated by more than one source.",
  },
  lead: {
    text: "Unverified",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    explain:
      "Found in news or event coverage and not yet confirmed against a map. Worth a call before you drive out.",
  },
};

export function ConfidenceBadge({
  confidence,
  className = "",
}: {
  confidence: Confidence;
  className?: string;
}) {
  const style = CONFIDENCE_STYLE[confidence];
  return (
    <span
      title={style.explain}
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.className} ${className}`}
    >
      {style.text}
    </span>
  );
}

export function confidenceExplanation(confidence: Confidence): string {
  return CONFIDENCE_STYLE[confidence].explain;
}

/** Compact "OpenStreetMap + 2 more" line for a result card. */
export function SourceSummary({ sources }: { sources: SourceRef[] }) {
  if (!sources.length) return null;
  const first = SOURCE_LABEL[sources[0].source];
  const extra = sources.length - 1;
  return (
    <span className="text-[11px] text-muted">
      {first}
      {extra > 0 ? ` + ${extra} more` : ""}
    </span>
  );
}

/** Full, linked provenance list for the detail panel. */
export function SourceList({ sources }: { sources: SourceRef[] }) {
  return (
    <ul className="space-y-1 text-xs">
      {sources.map((ref, index) => (
        <li key={`${ref.source}-${ref.ref ?? index}`} className="flex gap-2">
          <span className="shrink-0 text-muted">{SOURCE_LABEL[ref.source]}</span>
          {ref.url ? (
            <a
              href={ref.url}
              target="_blank"
              rel="noreferrer noopener"
              className="min-w-0 flex-1 truncate text-accent hover:underline"
              title={ref.title ?? ref.url}
            >
              {ref.title ?? ref.url.replace(/^https?:\/\//, "")}
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate text-muted">
              {ref.title ?? ref.ref ?? "—"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
