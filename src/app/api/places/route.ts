import { NextResponse } from "next/server";

import { isCategoryId } from "@/lib/categories";
import { penalizeRepeatedNames } from "@/lib/chains";
import { findCorrections } from "@/lib/db";
import { clampRadius, isValidLatLon } from "@/lib/geo";
import { reverseGeocode } from "@/lib/geocode";
import { mergePlaces } from "@/lib/merge";
import { gather } from "@/lib/sources/registry";
import type { CategoryId, Place, PlacesResponse, SourceId } from "@/lib/types";

export const runtime = "nodejs";
// Slow: several upstream services plus, when configured, a model call.
export const maxDuration = 60;
export const revalidate = 0;

const MAX_RESULTS = 300;

const KNOWN_SOURCES: SourceId[] = [
  "osm",
  "usda",
  "google",
  "news",
  "events",
  "community",
];

function isSourceId(value: string): value is SourceId {
  return (KNOWN_SOURCES as string[]).includes(value);
}

/**
 * Apply community corrections to automated listings.
 *
 * Someone reporting "this is actually a chain" or "this closed" is better
 * evidence than any heuristic, so a correction overrides the computed verdict.
 */
function applyCorrections(places: Place[]): { places: Place[]; applied: number } {
  const corrections = findCorrections(places.map((p) => p.id));
  if (corrections.size === 0) return { places, applied: 0 };

  let applied = 0;
  const out: Place[] = [];

  for (const place of places) {
    const reports = corrections.get(place.id);
    if (!reports?.length) {
      out.push(place);
      continue;
    }

    // Most recent report wins.
    const latest = [...reports].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0];
    applied++;

    if (latest.kindOfReport === "closed") continue; // Drop it entirely.

    if (latest.kindOfReport === "chain") {
      out.push({
        ...place,
        independence: {
          score: 0,
          independent: false,
          reasons: [...place.independence.reasons, "Reported as a chain by a visitor"],
          chainName: place.independence.chainName,
        },
        sources: [...place.sources, { source: "community", ref: String(latest.id) }],
      });
      continue;
    }

    if (latest.kindOfReport === "independent") {
      // A verdict reached by a hard signal — a brand entity, an explicit chain
      // tag, a denylist match — is a fact about the listing, not a judgement
      // call, and no report overturns it. The UI doesn't offer the option, but
      // the endpoint is public, so the rule is enforced here rather than there.
      if (place.independence.definitive) {
        out.push(place);
        continue;
      }

      out.push({
        ...place,
        independence: {
          score: 100,
          independent: true,
          reasons: [
            ...place.independence.reasons,
            "Confirmed independently owned by a visitor",
          ],
        },
        sources: [...place.sources, { source: "community", ref: String(latest.id) }],
      });
      continue;
    }

    out.push(place);
  }

  return { places: out, applied };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!isValidLatLon(lat, lon)) {
    return NextResponse.json(
      { error: "Provide valid `lat` and `lon` query parameters." },
      { status: 400 },
    );
  }

  const radius = clampRadius(Number(params.get("radius") ?? 8000));

  const requestedCategories = (params.get("categories") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isCategoryId) as CategoryId[];
  const categories = requestedCategories.length ? new Set(requestedCategories) : null;

  const requestedSources = (params.get("sources") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isSourceId);
  const only = requestedSources.length ? new Set(requestedSources) : undefined;

  // `all=1` keeps chains in the response, flagged rather than removed, so the
  // filter can be inspected instead of taken on faith.
  const includeChains = params.get("all") === "1";

  const warnings: string[] = [];

  // Text sources need a place name, not coordinates. The caller can pass one to
  // save a round trip; otherwise we look it up.
  let areaName = params.get("area")?.trim() || undefined;
  if (!areaName) {
    try {
      const hit = await reverseGeocode(lat, lon);
      areaName = hit?.label.split(",").slice(0, 3).join(",").trim();
    } catch {
      // Non-fatal: the text sources will report themselves as skipped.
    }
  }

  const { places: raw, statuses } = await gather({ lat, lon, radius, areaName }, only);

  if (raw.length === 0 && statuses.every((s) => s.found === 0)) {
    const osm = statuses.find((s) => s.source === "osm");
    if (osm?.note) {
      return NextResponse.json(
        {
          error:
            "No sources could be reached right now. OpenStreetMap's Overpass service may be busy.",
          detail: osm.note,
          sources: statuses,
        },
        { status: 503 },
      );
    }
  }

  const { places: deduped, merged } = mergePlaces(raw);
  if (merged > 0) {
    warnings.push(
      `${merged} duplicate listing${merged === 1 ? "" : "s"} merged across sources.`,
    );
  }

  const corrected = applyCorrections(deduped);
  let places = corrected.places;

  // Needs the full set to count how often each name occurs.
  penalizeRepeatedNames(places);

  const beforeChainFilter = places.length;
  if (!includeChains) {
    places = places.filter((p) => p.independence.independent);
  }
  const chainsFiltered = beforeChainFilter - places.length;

  if (categories) {
    places = places.filter((p) => categories.has(p.category));
  }

  places.sort((a, b) => a.distance - b.distance);
  if (places.length > MAX_RESULTS) {
    places = places.slice(0, MAX_RESULTS);
    warnings.push(
      `Showing the ${MAX_RESULTS} closest results. Zoom in or reduce the radius to see everything.`,
    );
  }

  const body: PlacesResponse = {
    center: { lat, lon },
    radius,
    count: places.length,
    chainsFiltered,
    places,
    sources: statuses,
    attribution: "© OpenStreetMap contributors (ODbL)",
    warnings: warnings.length ? warnings : undefined,
  };

  return NextResponse.json(body, {
    headers: {
      // Cheap protection against hammering the upstream services on every pan.
      "Cache-Control": "public, max-age=300, s-maxage=900",
    },
  });
}
