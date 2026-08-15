import { isValidLatLon } from "./geo";
import type { GeocodeResult } from "./types";

/**
 * Nominatim access, shared by the geocode route and the text-based providers.
 *
 * It lives server-side for two reasons: Nominatim's usage policy requires an
 * identifying User-Agent (browsers won't let us set one), and proxying keeps the
 * visitor's IP out of a third party's logs.
 */

const SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "Smallbox/0.1 (local food finder)";
const FETCH_TIMEOUT_MS = 12_000;

/**
 * Nominatim asks for at most one request per second. News extraction can produce
 * a dozen venues at once, so requests are queued through a single chain rather
 * than fired in parallel — being a good citizen of a free service is a
 * requirement, not a nicety.
 */
const MIN_INTERVAL_MS = 1100;
let queue: Promise<unknown> = Promise.resolve();

function throttle<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const started = Date.now();
    try {
      return await task();
    } finally {
      const wait = MIN_INTERVAL_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  });
  // Keep the chain alive even when a link rejects.
  queue = run.catch(() => undefined);
  return run as Promise<T>;
}

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

export async function searchPlace(query: string, limit = 6): Promise<GeocodeResult[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");

  const places = (await throttle(() => callNominatim(url))) as NominatimPlace[];
  return (Array.isArray(places) ? places : [])
    .map(toResult)
    .filter((r): r is GeocodeResult => r !== null);
}

export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<GeocodeResult | null> {
  const url = new URL(REVERSE_URL);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "14");

  const place = (await throttle(() => callNominatim(url))) as NominatimPlace;
  return toResult(place);
}

/**
 * Resolve a venue described in prose ("Pack Square Park, Asheville") to a point,
 * falling back to the town centre so a real market isn't dropped just because
 * its exact address wasn't printed.
 */
export async function locateVenue(
  venue: string | null | undefined,
  areaName: string,
  fallback: { lat: number; lon: number },
): Promise<{ lat: number; lon: number; precise: boolean }> {
  const attempts = [venue && `${venue}, ${areaName}`, venue, areaName].filter(
    (q): q is string => Boolean(q && q.trim()),
  );

  for (const attempt of attempts) {
    try {
      const [hit] = await searchPlace(attempt, 1);
      if (hit) {
        // Only a venue-level match counts as precise; matching the town name
        // just puts a pin in the middle of town.
        const precise = attempt !== areaName;
        return { lat: hit.lat, lon: hit.lon, precise };
      }
    } catch {
      // Try the next, less specific phrasing.
    }
  }

  return { ...fallback, precise: false };
}
