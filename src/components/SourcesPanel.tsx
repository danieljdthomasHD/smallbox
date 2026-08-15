"use client";

import { SOURCE_LABEL } from "@/components/Provenance";
import type { SourceStatus } from "@/lib/types";

/**
 * What ran, what didn't, and why.
 *
 * With six sources — several of them behind optional API keys — an empty result
 * is ambiguous unless the app says which sources actually answered. Showing this
 * turns "there's nothing near me" into "four sources are switched off".
 */
export default function SourcesPanel({ sources }: { sources: SourceStatus[] }) {
  if (!sources.length) return null;

  const active = sources.filter((s) => s.enabled);
  const contributing = active.filter((s) => s.found > 0).length;

  return (
    <details className="mt-3 rounded-lg border border-edge bg-surface">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted hover:bg-surface-muted">
        <span className="font-medium">Sources</span> · {contributing} of{" "}
        {sources.length} contributing
        <span className="float-right" aria-hidden>
          ▾
        </span>
      </summary>

      <ul className="border-t border-edge px-3 py-2">
        {sources.map((status) => (
          <li key={status.source} className="py-1 text-xs">
            <div className="flex items-baseline gap-2">
              <span
                aria-hidden
                className={
                  status.enabled
                    ? status.found > 0
                      ? "text-accent"
                      : "text-muted"
                    : "text-muted opacity-50"
                }
              >
                {status.enabled ? (status.found > 0 ? "●" : "○") : "○"}
              </span>
              <span className="flex-1">{SOURCE_LABEL[status.source]}</span>
              <span className="tabular-nums text-muted">
                {status.enabled ? status.found : "off"}
              </span>
            </div>
            {status.note && (
              <p className="ml-5 mt-0.5 leading-relaxed text-muted">{status.note}</p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
