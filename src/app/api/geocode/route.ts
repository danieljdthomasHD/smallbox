import { NextResponse } from "next/server";

import { isValidLatLon } from "@/lib/geo";
import { reverseGeocode, searchPlace } from "@/lib/geocode";

export const runtime = "nodejs";

/** Thin HTTP wrapper over the shared, rate-limited Nominatim client. */
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
      const result = await reverseGeocode(lat, lon);
      return NextResponse.json({ results: result ? [result] : [] });
    }

    const results = await searchPlace(query!);
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
