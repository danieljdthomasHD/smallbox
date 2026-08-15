import { NextResponse } from "next/server";

import { isValidLatLon } from "@/lib/geo";
import type { GeocodeResult } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Thin proxy over Nominatim.
 *
 * It lives on the server for two reasons: Nominatim's usage policy requires an
 * identifying User-Agent (browsers won't let us set one), and proxying keeps
 * the visitor's IP out of a third party's logs.
 */
const SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "Smallbox/0.1 (local food finder)";
const FETCH_TIMEOUT_MS = 12_000;

interface NominatimPlace {
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  addresstype?: string;
  type?: string;
}

async function callNominatim(url: URL): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}`);
  return response.json();
}

function toResult(place: NominatimPlace): GeocodeResult | null {
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (!isValidLatLon(lat, lon)) return null;
  return {
    label: place.display_name ?? place.name ?? `${lat}, ${lon}`,
    lat,
    lon,
    type: place.addresstype ?? place.type,
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const isReverse = !query && isValidLatLon(lat, lon);

  if (!query && !isReverse) {
    return NextResponse.json(
      { error: "Provide `q` to search, or `lat` and `lon` to reverse geocode." },
      { status: 400 },
    );
  }

  try {
    if (isReverse) {
      const url = new URL(REVERSE_URL);
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lon));
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("zoom", "14");
      const place = (await callNominatim(url)) as NominatimPlace;
      const result = toResult(place);
      return NextResponse.json({ results: result ? [result] : [] });
    }

    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", query!);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "6");
    url.searchParams.set("addressdetails", "1");
    const places = (await callNominatim(url)) as NominatimPlace[];
    const results = (Array.isArray(places) ? places : [])
      .map(toResult)
      .filter((r): r is GeocodeResult => r !== null);

    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Location lookup failed.", detail: message },
      { status: 503 },
    );
  }
}
