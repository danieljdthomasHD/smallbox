import { NextResponse } from "next/server";

import { isCategoryId } from "@/lib/categories";
import { penalizeRepeatedNames } from "@/lib/chains";
import { clampRadius, isValidLatLon } from "@/lib/geo";
import { elementsToPlaces, fetchOverpass } from "@/lib/overpass";
import { fetchUsdaMarkets } from "@/lib/usda";
import type { CategoryId, Place, PlacesResponse } from "@/lib/types";

export const runtime = "nodejs";
// Overpass is slow and its data changes on the order of days, not seconds.
export const revalidate = 0;

const MAX_RESULTS = 300;

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

  const requested = (params.get("categories") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isCategoryId) as CategoryId[];
  const categories = requested.length ? new Set(requested) : null;

  // `all=1` keeps chains in the response, flagged rather than removed, so the
  // filter can be inspected instead of taken on faith.
  const includeChains = params.get("all") === "1";

  const warnings: string[] = [];
  let places: Place[] = [];

  try {
    const { elements, warnings: mirrorWarnings } = await fetchOverpass(
      lat,
      lon,
      radius,
    );
    if (mirrorWarnings.length) {
      warnings.push(`Fell back after ${mirrorWarnings.length} mirror failure(s).`);
    }
    places = elementsToPlaces(elements, lat, lon);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error:
          "OpenStreetMap's Overpass service is unavailable right now. Try again in a minute.",
        detail: message,
      },
      { status: 503 },
    );
  }

  // USDA only runs when an API key is configured; it is purely additive.
  const usda = await fetchUsdaMarkets(lat, lon, radius);
  if (usda.warning) warnings.push(usda.warning);
  if (usda.places.length) {
    const seen = new Set(
      places.map((p) => `${p.name.toLowerCase()}|${p.lat.toFixed(3)}`),
    );
    for (const market of usda.places) {
      const key = `${market.name.toLowerCase()}|${market.lat.toFixed(3)}`;
      if (!seen.has(key)) {
        places.push(market);
        seen.add(key);
      }
    }
  }

  // Run this before filtering: it needs to see the full result set to count
  // how many times each name occurs.
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
  const truncated = places.length > MAX_RESULTS;
  if (truncated) {
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
    attribution: "© OpenStreetMap contributors (ODbL)",
    warnings: warnings.length ? warnings : undefined,
  };

  return NextResponse.json(body, {
    headers: {
      // Cheap protection against hammering Overpass when the map is panned.
      "Cache-Control": "public, max-age=300, s-maxage=900",
    },
  });
}
