"use client";

import { CATEGORIES } from "@/lib/categories";
import { formatDistance } from "@/lib/geo";
import { humanizeHours } from "@/lib/hours";
import type { OpenState, Place } from "@/lib/types";

interface PlaceDetailProps {
  place: Place;
  openState: OpenState;
  onClose: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

export default function PlaceDetail({ place, openState, onClose }: PlaceDetailProps) {
  const def = CATEGORIES[place.category];
  const hours = humanizeHours(place.openingHours);
  const directions = `https://www.openstreetmap.org/directions?to=${place.lat}%2C${place.lon}`;

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
        {place.address && <Row label="Address">{place.address}</Row>}

        {hours && (
          <Row label="Hours">
            <span className="block">{hours}</span>
            {openState !== "unknown" && (
              <span
                className={
                  openState === "open" ? "text-accent" : "text-muted"
                }
              >
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

        {place.tags.description && <Row label="About">{place.tags.description}</Row>}

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
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            This is a guess from OpenStreetMap tags, not a verified fact. If it
            looks wrong, the listing itself can be corrected on OSM.
          </p>
        </div>

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
              {place.source === "usda" ? "USDA listing" : "View on OSM"}
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
