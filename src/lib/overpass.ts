import { SHOP_VALUES, classify } from "./categories";
import { assessIndependence } from "./chains";
import { haversine } from "./geo";
import { evaluateHours } from "./hours";
import type { Place } from "./types";

/**
 * Public Overpass instances, tried in order. The main overpass-api.de endpoint
 * is frequently rate-limited or mid-rebuild, so failing over is not optional if
 * you want the app to work on a Saturday morning.
 */
const MIRRORS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

const QUERY_TIMEOUT_S = 20;
const FETCH_TIMEOUT_MS = 20_000;
/** If a mirror hasn't answered in this long, start racing the next one. */
const HEDGE_DELAY_MS = 5_000;

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

export function buildQuery(lat: number, lon: number, radius: number): string {
  const shops = SHOP_VALUES.join("|");
  const around = `around:${radius},${lat.toFixed(6)},${lon.toFixed(6)}`;
  return [
    `[out:json][timeout:${QUERY_TIMEOUT_S}];`,
    "(",
    `  nwr["amenity"="marketplace"](${around});`,
    `  nwr["shop"~"^(${shops})$"](${around});`,
    ");",
    "out center;",
  ].join("\n");
}

export interface OverpassFetchResult {
  elements: OverpassElement[];
  mirror: string;
  warnings: string[];
}

async function fetchFromMirror(
  mirror: string,
  query: string,
  abort: AbortSignal,
): Promise<OverpassElement[]> {
  const response = await fetch(mirror, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Smallbox/0.1 (local food finder; +https://github.com/)",
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.any([abort, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
  });

  if (!response.ok) {
    throw new Error(`${mirror} returned HTTP ${response.status}`);
  }

  const text = await response.text();
  // Overpass reports runtime errors as an HTML page with a 200 status.
  if (!text.trimStart().startsWith("{")) {
    throw new Error(`${mirror} returned a non-JSON error page`);
  }

  const data = JSON.parse(text) as OverpassResponse;
  return data.elements ?? [];
}

/**
 * Query the mirrors with hedging, resolving on the first success.
 *
 * Trying them strictly one after another means a single stalled mirror costs a
 * full timeout before the next one even starts — in testing that turned into a
 * 71-second wait before the app gave up. Instead we start the next mirror early
 * if the current one has gone quiet, and take whichever answers first. Mirrors
 * are only doubled up when one is actually slow, so the free services don't get
 * four times the traffic for nothing.
 */
export async function fetchOverpass(
  lat: number,
  lon: number,
  radius: number,
): Promise<OverpassFetchResult> {
  const query = buildQuery(lat, lon, radius);
  const warnings: string[] = [];
  const canceller = new AbortController();

  return new Promise<OverpassFetchResult>((resolve, reject) => {
    let launched = 0;
    let finished = 0;
    let settled = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    const launchNext = () => {
      if (settled || launched >= MIRRORS.length) return;
      const mirror = MIRRORS[launched++];

      clearTimeout(hedgeTimer);
      if (launched < MIRRORS.length) {
        hedgeTimer = setTimeout(launchNext, HEDGE_DELAY_MS);
      }

      fetchFromMirror(mirror, query, canceller.signal).then(
        (elements) => {
          if (settled) return;
          settled = true;
          clearTimeout(hedgeTimer);
          // Stop the mirrors that lost the race.
          canceller.abort();
          resolve({ elements, mirror, warnings });
        },
        (error) => {
          finished++;
          warnings.push(error instanceof Error ? error.message : String(error));
          if (settled) return;
          if (launched < MIRRORS.length) {
            launchNext();
          } else if (finished === MIRRORS.length) {
            clearTimeout(hedgeTimer);
            reject(
              new Error(`All Overpass mirrors failed: ${warnings.join("; ")}`),
            );
          }
        },
      );
    };

    launchNext();
  });
}

/** Assemble a street address from the usual `addr:*` tags. */
function buildAddress(tags: Record<string, string>): string | undefined {
  const line = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ");
  const city = [tags["addr:city"], tags["addr:state"]].filter(Boolean).join(", ");
  const full = [line, city, tags["addr:postcode"]].filter(Boolean).join(", ");
  return full || undefined;
}

/** Tags worth showing on the detail card. */
const INTERESTING_TAGS = [
  "organic",
  "produce",
  "payment:cash",
  "payment:cards",
  "payment:ebt",
  "wheelchair",
  "delivery",
  "self_service",
  "opening_hours:signed",
  "description",
  "cuisine",
];

/**
 * True when the element's own tags say the place no longer operates.
 *
 * OSM keeps closed shops around under lifecycle tags rather than deleting
 * them, and mappers are inconsistent about which one they use — so check all
 * the common spellings. Stale data with no closure tag at all can't be caught
 * here; that's what the Google tombstones, news closures and community
 * reports are for.
 */
function isClosedInOsm(tags: Record<string, string>, name: string): boolean {
  if (tags.disused === "yes" || tags.abandoned === "yes") return true;
  for (const key of Object.keys(tags)) {
    if (/^(disused|abandoned|was|closed|demolished|razed|construction):/.test(key)) return true;
  }
  if (tags.shop === "vacant") return true;
  if (tags.opening_hours === "closed" || tags.opening_hours === "off") return true;
  if (/\((permanently )?closed\)/i.test(name)) return true;
  if (tags.end_date && Date.parse(tags.end_date) < Date.now()) return true;
  return false;
}

export function toPlace(
  element: OverpassElement,
  centerLat: number,
  centerLon: number,
): Place | null {
  const tags = element.tags ?? {};
  const name = tags.name?.trim();
  // An unnamed point is not something a person can go and find.
  if (!name) return null;
  if (isClosedInOsm(tags, name)) return null;

  const category = classify(tags);
  if (!category) return null;

  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const surfaced: Record<string, string> = {};
  for (const key of INTERESTING_TAGS) {
    if (tags[key]) surfaced[key] = tags[key];
  }

  const openingHours = tags.opening_hours;
  const ref = `${element.type}/${element.id}`;
  const url = `https://www.openstreetmap.org/${ref}`;

  return {
    id: `osm:${ref}`,
    name,
    category,
    kind: "permanent",
    lat,
    lon,
    distance: haversine(centerLat, centerLon, lat, lon),
    address: buildAddress(tags),
    phone: tags.phone ?? tags["contact:phone"],
    website: tags.website ?? tags["contact:website"],
    openingHours,
    // Approximate: computed in server time. The UI recomputes in the visitor's
    // local timezone, which is much closer to the shop's.
    openState: evaluateHours(openingHours),
    organic: tags.organic === "yes" || tags.organic === "only",
    description: tags.description,
    tags: surfaced,
    independence: assessIndependence(tags),
    confidence: "verified",
    sources: [{ source: "osm", ref, url }],
    source: "osm",
    sourceUrl: url,
  };
}

export function elementsToPlaces(
  elements: OverpassElement[],
  centerLat: number,
  centerLon: number,
): Place[] {
  const byId = new Map<string, Place>();
  for (const element of elements) {
    const place = toPlace(element, centerLat, centerLon);
    if (place) byId.set(place.id, place);
  }
  return [...byId.values()];
}
