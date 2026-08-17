import type { Closure } from "./types";

/**
 * Places confirmed permanently closed, maintained in the repo.
 *
 * Most closures are caught automatically: OSM lifecycle tags, Google's
 * CLOSED_PERMANENTLY flag, closures reported in news coverage, and community
 * "closed" reports. This list is the backstop for the case none of those can
 * cover — a stale map record with no closure evidence anywhere the app can
 * reach. The canonical example is a shop that closed last month: OSM hasn't
 * been updated, the Google source may be switched off, and on a serverless
 * host there's no writable database to hold a community report.
 *
 * Every entry needs a citation. Coordinates only have to land within ~700 m
 * of the stale record — the name match does the discriminating (see
 * `suppressClosed` in merge.ts) — so the address from a news story is plenty.
 *
 * The better long-term fix for any entry here is updating OpenStreetMap
 * itself; an entry can be deleted once the upstream record is gone.
 */
interface ClosedPlace {
  name: string;
  lat: number;
  lon: number;
  /** When it closed (ISO date, best known). */
  closed: string;
  /** Evidence — a news story or the business's own announcement. */
  url: string;
}

const CLOSED_PLACES: ClosedPlace[] = [
  {
    // Covington, KY. Closed 2026-05-31; OSM way/141875153 still maps it as a
    // live marketplace.
    name: "Dee Felice Market",
    lat: 39.0845368,
    lon: -84.5177472,
    closed: "2026-05-31",
    url: "https://www.wcpo.com/news/local-news/kenton-county/covington/bittersweet-dee-felice-market-in-covington-closing",
  },
];

/** The registry as closure tombstones, ready for `suppressClosed`. */
export function registryClosures(): Closure[] {
  return CLOSED_PLACES.map(({ name, lat, lon, url }) => ({
    name,
    lat,
    lon,
    source: "community",
    url,
  }));
}
