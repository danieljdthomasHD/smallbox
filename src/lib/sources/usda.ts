import { assessIndependence } from "../chains";
import { haversine } from "../geo";
import { evaluateHours } from "../hours";
import type { Place } from "../types";
import { emptyResult, type Provider, type ProviderQuery, type ProviderResult } from "./types";

/**
 * Optional enrichment from the USDA Local Food Directories.
 *
 * The USDA maintains a hand-curated directory of US farmers markets, on-farm
 * markets, CSAs and food hubs. It is better than OSM for market *schedules*,
 * but it needs a free API key from https://www.usdalocalfoodportal.com/fe/apikey/
 * so it stays entirely optional — the app is fully functional without it.
 *
 * Set USDA_API_KEY in .env.local to switch it on.
 */

const ENDPOINT = "https://www.usdalocalfoodportal.com/api/farmersmarket/";
const FETCH_TIMEOUT_MS = 12_000;

interface UsdaMarket {
  listing_id?: string | number;
  listing_name?: string;
  location_x?: string | number;
  location_y?: string | number;
  location_address?: string;
  contact_phone?: string;
  media_website?: string;
  listing_desc?: string;
  location_desc?: string;
  updatetime?: string;
}

async function fetchUsdaMarkets(
  lat: number,
  lon: number,
  radiusMetres: number,
): Promise<ProviderResult> {
  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) return emptyResult();

  // The USDA API takes miles and caps out at 100.
  const radiusMiles = Math.min(
    100,
    Math.max(1, Math.round(radiusMetres / 1609.344)),
  );

  const url = new URL(ENDPOINT);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("x", String(lon));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("radius", String(radiusMiles));

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return emptyResult(`USDA directory returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as { data?: UsdaMarket[] };
    const rows = Array.isArray(payload?.data) ? payload.data : [];

    const places: Place[] = [];
    for (const row of rows) {
      const name = row.listing_name?.trim();
      const rowLat = Number(row.location_y);
      const rowLon = Number(row.location_x);
      if (!name || !Number.isFinite(rowLat) || !Number.isFinite(rowLon)) continue;

      const tags: Record<string, string> = { name, amenity: "marketplace" };
      if (row.listing_desc) tags.description = row.listing_desc;

      const ref = String(row.listing_id ?? `${rowLat},${rowLon}`);
      places.push({
        id: `usda:${ref}`,
        name,
        category: "farmers_market",
        kind: "permanent",
        lat: rowLat,
        lon: rowLon,
        distance: haversine(lat, lon, rowLat, rowLon),
        address: row.location_address?.trim() || undefined,
        phone: row.contact_phone?.trim() || undefined,
        website: row.media_website?.trim() || undefined,
        openingHours: undefined,
        openState: evaluateHours(undefined),
        description: row.listing_desc?.trim() || row.location_desc?.trim() || undefined,
        tags: {},
        independence: assessIndependence(tags),
        confidence: "verified",
        sources: [
          { source: "usda", ref, url: "https://www.usdalocalfoodportal.com/" },
        ],
        source: "usda",
        sourceUrl: "https://www.usdalocalfoodportal.com/",
      });
    }

    return { places };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyResult(`USDA directory unavailable: ${message}`);
  }
}

export const usdaProvider: Provider = {
  id: "usda",
  label: "USDA Local Food Directory",

  isEnabled() {
    return Boolean(process.env.USDA_API_KEY);
  },

  disabledReason() {
    return this.isEnabled()
      ? undefined
      : "Set USDA_API_KEY (free) to include the USDA's curated US market directory.";
  },

  async fetch({ lat, lon, radius }: ProviderQuery): Promise<ProviderResult> {
    if (!this.isEnabled()) return emptyResult(this.disabledReason());
    return fetchUsdaMarkets(lat, lon, radius);
  },
};
