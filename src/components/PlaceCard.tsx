"use client";

import { CATEGORIES } from "@/lib/categories";
import { formatDistance } from "@/lib/geo";
import type { OpenState, Place } from "@/lib/types";

const OPEN_LABEL: Record<OpenState, { text: string; className: string } | null> = {
  open: { text: "Open now", className: "bg-accent-soft text-accent" },
  closed: { text: "Closed", className: "bg-surface-muted text-muted" },
  unknown: null,
};

interface PlaceCardProps {
  place: Place;
  openState: OpenState;
  selected: boolean;
  onSelect: () => void;
}

export default function PlaceCard({
  place,
  openState,
  selected,
  onSelect,
}: PlaceCardProps) {
  const def = CATEGORIES[place.category];
  const open = OPEN_LABEL[openState];
  const flaggedChain = place.independence.reasons.some((r) =>
    r.includes("local chain"),
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
        selected
          ? "border-accent bg-accent-soft/40"
          : "border-edge bg-surface hover:bg-surface-muted"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base"
          style={{ backgroundColor: `${def.color}22` }}
        >
          {def.emoji}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate font-medium">{place.name}</h3>
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {formatDistance(place.distance)}
            </span>
          </div>

          <p className="mt-0.5 truncate text-xs text-muted">
            {def.singular}
            {place.address ? ` · ${place.address}` : ""}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {open && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${open.className}`}>
                {open.text}
              </span>
            )}
            {place.organic && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted">
                Organic
              </span>
            )}
            {place.tags["payment:ebt"] === "yes" && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted">
                SNAP/EBT
              </span>
            )}
            {flaggedChain && (
              <span
                className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400"
                title="Several locations with this name nearby"
              >
                Small chain?
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
