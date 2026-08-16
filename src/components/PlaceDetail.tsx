"use client";

import { useState } from "react";

import {
  ConfidenceBadge,
  SourceList,
  confidenceExplanation,
} from "@/components/Provenance";
import { CATEGORIES } from "@/lib/categories";
import { formatDistance } from "@/lib/geo";
import { humanizeHours } from "@/lib/hours";
import { formatOccurrence, upcomingOccurrences } from "@/lib/occurrences";
import type { OpenState, Place } from "@/lib/types";

interface PlaceDetailProps {
  place: Place;
  openState: OpenState;
  onClose: () => void;
  /** Available only when the submissions database is reachable. */
  canReport: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

type ReportKind = "independent" | "chain" | "closed";

const REPORTS: { kind: ReportKind; label: string; done: string }[] = [
  { kind: "independent", label: "Actually independent", done: "Marked as independent" },
  { kind: "chain", label: "Actually a chain", done: "Marked as a chain" },
  { kind: "closed", label: "Permanently closed", done: "Reported as closed" },
];

/**
 * Only offer corrections that would change something.
 *
 * Every one of these overwrites the app's own verdict, so the option that
 * simply restates it isn't a correction — it's a third button that makes the
 * reader wonder what they're being asked.
 */
function correctionsFor(independent: boolean) {
  return REPORTS.filter((report) =>
    report.kind === "closed"
      ? true
      : independent
        ? report.kind === "chain"
        : report.kind === "independent",
  );
}

export default function PlaceDetail({
  place,
  openState,
  onClose,
  canReport,
}: PlaceDetailProps) {
  const def = CATEGORIES[place.category];
  const hours = humanizeHours(place.openingHours);
  const directions = `https://www.openstreetmap.org/directions?to=${place.lat}%2C${place.lon}`;
  const upcoming = upcomingOccurrences(place.occurrences);
  const approximate = place.tags.location_approximate === "yes";

  const [reported, setReported] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  async function report(kind: ReportKind, done: string) {
    setReporting(true);
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kindOfReport: kind,
          correctsPlaceId: place.id,
          name: place.name,
        }),
      });
      setReported(response.ok ? done : "Couldn't save that — try again.");
    } catch {
      setReported("Couldn't save that — try again.");
    } finally {
      setReporting(false);
    }
  }

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-surface">
      <header className="flex items-start gap-3 border-b border-edge px-4 py-3">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
          style={{ backgroundColor: `${def.color}22` }}
        >
          {def.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{place.name}</h2>
          <p className="text-xs text-muted">
            {place.kind === "popup" ? "Pop-up · " : ""}
            {def.singular} · {formatDistance(place.distance)} away
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded-md px-2 py-1 text-muted hover:bg-surface-muted"
        >
          ✕
        </button>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-3">
        {place.confidence !== "verified" && (
          <div className="mb-3 rounded-lg border border-edge bg-surface-muted p-2.5">
            <ConfidenceBadge confidence={place.confidence} />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              {confidenceExplanation(place.confidence)}
            </p>
          </div>
        )}

        {upcoming.length > 0 && (
          <div className="mb-3 rounded-lg border border-accent/40 bg-accent-soft/40 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">
              Upcoming dates
            </h3>
            <ul className="mt-1.5 space-y-1 text-sm">
              {upcoming.slice(0, 6).map((occurrence) => (
                <li key={`${occurrence.start}-${occurrence.end ?? ""}`}>
                  {formatOccurrence(occurrence)}
                  {occurrence.note && (
                    <span className="text-muted"> · {occurrence.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {place.description && (
          <p className="mb-2 text-sm leading-relaxed">{place.description}</p>
        )}

        {place.address && (
          <Row label="Address">
            {place.address}
            {approximate && (
              <span className="block text-[11px] text-muted">
                Approximate — pin placed from a text description.
              </span>
            )}
          </Row>
        )}

        {hours && (
          <Row label="Hours">
            <span className="block">{hours}</span>
            {openState !== "unknown" && (
              <span className={openState === "open" ? "text-accent" : "text-muted"}>
                {openState === "open" ? "Open right now" : "Closed right now"}
              </span>
            )}
          </Row>
        )}

        {place.phone && (
          <Row label="Phone">
            <a className="text-accent hover:underline" href={`tel:${place.phone}`}>
              {place.phone}
            </a>
          </Row>
        )}

        {place.website && (
          <Row label="Website">
            <a
              className="text-accent hover:underline"
              href={place.website}
              target="_blank"
              rel="noreferrer noopener"
            >
              {place.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          </Row>
        )}

        <div className="mt-3 rounded-lg border border-edge bg-surface-muted p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Independent?
            </h3>
            <span className="text-xs tabular-nums text-muted">
              {place.independence.score}/100
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-edge"
            role="img"
            aria-label={`Independence score ${place.independence.score} of 100`}
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${place.independence.score}%` }}
            />
          </div>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {place.independence.reasons.map((reason) => (
              <li key={reason}>· {reason}</li>
            ))}
          </ul>
        </div>

        <div className="mt-3 rounded-lg border border-edge p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Sources
          </h3>
          <div className="mt-2">
            <SourceList sources={place.sources} />
          </div>
        </div>

        {canReport && (
          <div className="mt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Is this right?
            </h3>
            {reported ? (
              <p className="mt-2 text-xs text-accent">{reported} — thank you.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {correctionsFor(place.independence.independent).map(({ kind, label, done }) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={reporting}
                    onClick={() => report(kind, done)}
                    className="rounded-lg border border-edge px-2.5 py-1 text-xs hover:bg-surface-muted disabled:opacity-50"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Smallbox scores this {place.independence.independent ? "independent" : "a chain"}{" "}
              from its own tags. If that&apos;s wrong, correcting it here overrides the
              guess for everyone.
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={directions}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Directions
          </a>
          {place.sourceUrl && (
            <a
              href={place.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-lg border border-edge px-3 py-1.5 text-sm hover:bg-surface-muted"
            >
              View source
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
