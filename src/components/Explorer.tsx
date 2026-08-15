"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import AddPlaceDialog from "@/components/AddPlaceDialog";
import PlaceCard from "@/components/PlaceCard";
import PlaceDetail from "@/components/PlaceDetail";
import SearchBar from "@/components/SearchBar";
import SourcesPanel from "@/components/SourcesPanel";
import { CATEGORY_LIST } from "@/lib/categories";
import { haversine } from "@/lib/geo";
import { evaluateHours } from "@/lib/hours";
import type {
  CategoryId,
  GeocodeResult,
  OpenState,
  PlacesResponse,
} from "@/lib/types";

// Leaflet reaches for `window` at import time, so it can never be server-rendered.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-surface-muted text-sm text-muted">
      Loading map…
    </div>
  ),
});

const RADIUS_OPTIONS = [
  { label: "1 mi", value: 1600 },
  { label: "3 mi", value: 4800 },
  { label: "5 mi", value: 8000 },
  { label: "10 mi", value: 16000 },
  { label: "25 mi", value: 40000 },
];

const DEFAULT_CENTER = { lat: 35.5953, lon: -82.5508 }; // Asheville, NC
const DEFAULT_LABEL = "Asheville, North Carolina";

type Sort = "distance" | "independence" | "name";

export default function Explorer() {
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [locationLabel, setLocationLabel] = useState(DEFAULT_LABEL);
  const [radius, setRadius] = useState(8000);
  const [active, setActive] = useState<Set<CategoryId>>(new Set());
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("distance");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  // Bumped by the retry button, and after a submission, to re-run the search.
  const [reloadKey, setReloadKey] = useState(0);
  const [showAddPlace, setShowAddPlace] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  /**
   * News- and event-derived listings are useful but unconfirmed, so they're
   * opt-out rather than hidden: someone looking for a pop-up wants them, and
   * someone who doesn't can switch them off in one click.
   */
  const [showUnverified, setShowUnverified] = useState(true);

  // Where the map is currently looking, versus where results were fetched for.
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);

  /**
   * One piece of state holds the outcome *and* which search it belongs to.
   * Loading is then derived by comparing keys, which keeps every setState
   * inside an async callback instead of the effect body — no cascading renders,
   * and stale responses can't overwrite a newer search.
   */
  const searchKey = `${center.lat},${center.lon},${radius},${reloadKey}`;
  const [result, setResult] = useState<{
    key: string;
    data: PlacesResponse | null;
    error: string | null;
  }>({ key: "", data: null, error: null });

  const loading = result.key !== searchKey;
  const data = result.data;
  const error = result.error;

  // A geolocation failure isn't tied to a search, so it lives on its own.
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(
      `/api/places?lat=${center.lat}&lon=${center.lon}&radius=${radius}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Search failed.");
        return payload as PlacesResponse;
      })
      .then((payload) => {
        setResult({ key: searchKey, data: payload, error: null });
        setSelectedId(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key: searchKey,
          data: null,
          error: err instanceof Error ? err.message : "Something went wrong.",
        });
      });

    return () => controller.abort();
  }, [searchKey, center.lat, center.lon, radius]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/submissions")
      .then((r) => r.json())
      .then((payload) => {
        if (!cancelled) setCanSubmit(Boolean(payload?.available));
      })
      .catch(() => {
        if (!cancelled) setCanSubmit(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Derived list --------------------------------------------------------

  /**
   * Opening hours are evaluated here rather than on the server: the browser's
   * clock is in the visitor's timezone, which is far closer to the shop's than
   * the server's UTC.
   */
  const openStates = useMemo(() => {
    const now = new Date();
    const map = new Map<string, OpenState>();
    for (const place of data?.places ?? []) {
      map.set(place.id, evaluateHours(place.openingHours, now));
    }
    return map;
  }, [data]);

  const visible = useMemo(() => {
    let list = data?.places ?? [];
    if (active.size) list = list.filter((p) => active.has(p.category));
    if (openOnly) list = list.filter((p) => openStates.get(p.id) === "open");
    if (!showUnverified) list = list.filter((p) => p.confidence !== "lead");

    const sorted = [...list];
    if (sort === "distance") sorted.sort((a, b) => a.distance - b.distance);
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "independence") {
      sorted.sort(
        (a, b) =>
          b.independence.score - a.independence.score || a.distance - b.distance,
      );
    }
    return sorted;
  }, [data, active, openOnly, sort, openStates, showUnverified]);

  const counts = useMemo(() => {
    const map = new Map<CategoryId, number>();
    for (const place of data?.places ?? []) {
      map.set(place.category, (map.get(place.category) ?? 0) + 1);
    }
    return map;
  }, [data]);

  const selected = useMemo(
    () => visible.find((p) => p.id === selectedId) ?? null,
    [visible, selectedId],
  );

  // How far the map has drifted from the searched centre.
  const drift = haversine(center.lat, center.lon, mapCenter.lat, mapCenter.lon);
  const canSearchHere = drift > radius * 0.35;

  // --- Actions -------------------------------------------------------------

  const toggleCategory = useCallback((id: CategoryId) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pickLocation = useCallback((result: GeocodeResult) => {
    setCenter({ lat: result.lat, lon: result.lon });
    setMapCenter({ lat: result.lat, lon: result.lon });
    setLocationLabel(result.label.split(",").slice(0, 2).join(",").trim());
  }, []);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError("This browser can't share your location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const next = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        setCenter(next);
        setMapCenter(next);
        setLocationLabel("Your location");
        setLocating(false);
        setLocationError(null);

        // Swap in a real place name once we have one.
        try {
          const response = await fetch(
            `/api/geocode?lat=${next.lat}&lon=${next.lon}`,
          );
          const payload = await response.json();
          const label = payload?.results?.[0]?.label;
          if (label) {
            setLocationLabel(label.split(",").slice(0, 2).join(",").trim());
          }
        } catch {
          // The coordinates already work; a nicer label is a bonus.
        }
      },
      (geoError) => {
        setLocating(false);
        setLocationError(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location permission denied — search for a place instead."
            : "Couldn't get your location.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  function searchHere() {
    setCenter(mapCenter);
    setLocationLabel("Map area");
  }

  function selectPlace(id: string) {
    setSelectedId((current) => (current === id ? null : id));
    setMobileView("map");
  }

  // --- Render --------------------------------------------------------------

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-edge px-4 py-3">
        <SearchBar
          onPick={pickLocation}
          onUseMyLocation={useMyLocation}
          locating={locating}
        />

        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="radius" className="text-muted">
            Within
          </label>
          <select
            id="radius"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="rounded-md border border-edge bg-surface px-2 py-1"
          >
            {RADIUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label htmlFor="sort" className="ml-auto text-muted">
            Sort
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-md border border-edge bg-surface px-2 py-1"
          >
            <option value="distance">Nearest</option>
            <option value="independence">Most independent</option>
            <option value="name">A–Z</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_LIST.map((def) => {
            const on = active.has(def.id);
            const count = counts.get(def.id) ?? 0;
            return (
              <button
                key={def.id}
                type="button"
                onClick={() => toggleCategory(def.id)}
                aria-pressed={on}
                title={def.blurb}
                disabled={count === 0 && !on}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
                  on
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-edge bg-surface hover:bg-surface-muted"
                }`}
              >
                <span aria-hidden>{def.emoji}</span> {def.label}
                {count > 0 && (
                  <span className="ml-1 tabular-nums text-muted">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Open right now (only where hours are known)
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={showUnverified}
              onChange={(e) => setShowUnverified(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Include unverified finds from news &amp; events
          </label>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <p className="py-8 text-center text-sm text-muted">
            Searching OpenStreetMap…
          </p>
        )}

        {locationError && (
          <p className="mb-2 rounded-lg border border-edge bg-surface p-2 text-xs text-muted">
            {locationError}
          </p>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-edge bg-surface p-3 text-sm">
            <p className="font-medium">Couldn&apos;t load results</p>
            <p className="mt-1 text-muted">{error}</p>
            <button
              type="button"
              onClick={() => setReloadKey((n) => n + 1)}
              className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="py-8 text-center text-sm text-muted">
            <p>Nothing independent found here.</p>
            <p className="mt-1">Try a wider radius or a nearby town.</p>
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <>
            <p className="mb-2 text-xs text-muted">
              {visible.length} place{visible.length === 1 ? "" : "s"} near{" "}
              {locationLabel}
              {data?.chainsFiltered ? (
                <>
                  {" · "}
                  <span title="Big-box stores and chains excluded from these results">
                    {data.chainsFiltered} chain
                    {data.chainsFiltered === 1 ? "" : "s"} hidden
                  </span>
                </>
              ) : null}
            </p>
            <ul className="space-y-2">
              {visible.map((place) => (
                <li key={place.id}>
                  <PlaceCard
                    place={place}
                    openState={openStates.get(place.id) ?? "unknown"}
                    selected={place.id === selectedId}
                    onSelect={() => selectPlace(place.id)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        {data?.warnings?.map((warning) => (
          <p key={warning} className="mt-3 text-[11px] text-muted">
            {warning}
          </p>
        ))}

        {data?.sources && <SourcesPanel sources={data.sources} />}

        {canSubmit && (
          <button
            type="button"
            onClick={() => setShowAddPlace(true)}
            className="mt-3 w-full rounded-lg border border-dashed border-edge px-3 py-2 text-xs text-muted hover:bg-surface-muted"
          >
            + Add a place we&apos;ve missed
          </button>
        )}
      </div>
    </div>
  );

  const map = (
    <div className="relative h-full">
      <MapView
        center={center}
        radius={radius}
        places={visible}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMoved={setMapCenter}
      />

      {canSearchHere && (
        <button
          type="button"
          onClick={searchHere}
          className="absolute left-1/2 top-3 z-[400] -translate-x-1/2 rounded-full border border-edge bg-surface px-4 py-2 text-sm font-medium shadow-lg hover:bg-surface-muted"
        >
          Search this area
        </button>
      )}

      {selected && (
        <div className="absolute inset-x-3 bottom-3 z-[400] max-h-[55%] overflow-hidden rounded-xl border border-edge shadow-xl md:inset-x-auto md:right-3 md:w-80">
          <PlaceDetail
            place={selected}
            openState={openStates.get(selected.id) ?? "unknown"}
            onClose={() => setSelectedId(null)}
            canReport={canSubmit}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-edge bg-surface px-4 py-2.5">
        <h1 className="text-sm font-semibold tracking-tight">
          <span aria-hidden>🧺</span> Smallbox
        </h1>
        <p className="hidden text-xs text-muted sm:block">
          Farmers markets, farm stands and independent food shops — no big box.
        </p>

        <div className="ml-auto flex rounded-lg border border-edge p-0.5 md:hidden">
          {(["list", "map"] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setMobileView(view)}
              aria-pressed={mobileView === view}
              className={`rounded-md px-3 py-1 text-xs capitalize ${
                mobileView === view ? "bg-accent-soft text-accent" : "text-muted"
              }`}
            >
              {view}
            </button>
          ))}
        </div>
      </header>

      <main className="min-h-0 flex-1 md:grid md:grid-cols-[380px_1fr]">
        <div
          className={`h-full min-h-0 border-edge bg-surface md:block md:border-r ${
            mobileView === "list" ? "block" : "hidden"
          }`}
        >
          {sidebar}
        </div>
        <div
          className={`h-full min-h-0 md:block ${
            mobileView === "map" ? "block" : "hidden"
          }`}
        >
          {map}
        </div>
      </main>

      {showAddPlace && (
        <AddPlaceDialog
          center={mapCenter}
          onClose={() => setShowAddPlace(false)}
          onAdded={() => setReloadKey((n) => n + 1)}
        />
      )}
    </div>
  );
}
