"use client";

import { useEffect, useRef, useState } from "react";

import type { GeocodeResult } from "@/lib/types";

interface SearchBarProps {
  onPick: (result: GeocodeResult) => void;
  onUseMyLocation: () => void;
  locating: boolean;
  placeholder?: string;
}

export default function SearchBar({
  onPick,
  onUseMyLocation,
  locating,
  placeholder = "Town, ZIP or address",
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Set when we rewrite the input after a pick, so the effect below doesn't
  // immediately fire a fresh lookup for the name we just filled in.
  const skipNextLookup = useRef(false);

  // Close the dropdown on an outside click.
  useEffect(() => {
    function handler(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced lookup. Nominatim asks for at most one request per second, and
  // the abort controller makes sure a slow response can't overwrite a newer one.
  useEffect(() => {
    if (skipNextLookup.current) {
      skipNextLookup.current = false;
      return;
    }

    const term = query.trim();
    const controller = new AbortController();

    // Everything runs inside the debounce callback so no state is written
    // synchronously during the effect itself.
    const timer = setTimeout(async () => {
      if (term.length < 3) {
        setResults([]);
        setOpen(false);
        return;
      }

      setBusy(true);
      try {
        const response = await fetch(
          `/api/geocode?q=${encodeURIComponent(term)}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        setResults(Array.isArray(data.results) ? data.results : []);
        setOpen(true);
      } catch {
        // Aborted or offline — leave the previous suggestions in place.
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 450);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function pick(result: GeocodeResult) {
    onPick(result);
    skipNextLookup.current = true;
    setQuery(result.label.split(",")[0] ?? result.label);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          aria-label="Search for a location"
          className="min-w-0 flex-1 rounded-lg border border-edge bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          type="button"
          onClick={onUseMyLocation}
          disabled={locating}
          title="Use my location"
          aria-label="Use my location"
          className="shrink-0 rounded-lg border border-edge bg-surface px-3 py-2 text-sm hover:bg-surface-muted disabled:opacity-50"
        >
          {locating ? "…" : "◎"}
        </button>
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-[1000] mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-edge bg-surface py-1 shadow-lg">
          {results.map((result) => (
            <li key={`${result.lat},${result.lon}`}>
              <button
                type="button"
                onClick={() => pick(result)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <span className="pointer-events-none absolute right-14 top-2.5 text-xs text-muted">
          …
        </span>
      )}
    </div>
  );
}
