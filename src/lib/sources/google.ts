import { assessIndependence } from "../chains";
import { haversine } from "../geo";
import type { CategoryId, Closure, Place } from "../types";
import { emptyResult, type Provider, type ProviderQuery, type ProviderResult } from "./types";

/**
 * Google Places API (New).
 *
 * Best-in-class coverage and freshness, but it costs money per request and its
 * terms restrict how long results may be stored — so nothing from here is
 * written to the database, and the provider is off unless a key is configured.
 *
 * Set GOOGLE_PLACES_API_KEY in .env.local to switch it on.
 * https://developers.google.com/maps/documentation/places/web-service/nearby-search
 */

const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const FETCH_TIMEOUT_MS = 15_000;
/** Google's own cap on a Nearby Search. */
const MAX_RESULTS = 20;
/** Google's cap on the search radius, in metres. */
const MAX_RADIUS_M = 50_000;

/** Google place types mapped onto our categories. */
const TYPE_TO_CATEGORY: Record<string, CategoryId> = {
  farmers_market: "farmers_market",
  market: "farmers_market",
  butcher_shop: "butcher",
  seafood_store: "seafood",
  fish_store: "seafood",
  bakery: "bakery",
  cheese_store: "dairy",
  grocery_store: "grocery",
  supermarket: "grocery",
  food_store: "grocery",
  deli: "grocery",
  health_food_store: "grocery",
  fruit_and_vegetable_store: "produce",
  greengrocer: "produce",
  organic_food_store: "produce",
};

const REQUESTED_TYPES = Object.keys(TYPE_TO_CATEGORY);

/**
 * Google bills Places (New) by which fields a request asks for, and the tiers
 * differ enormously: identity/location fields are the "Pro" SKU with a
 * ~5,000-call monthly free allowance, while phone, website and opening hours
 * push the whole call into "Enterprise" pricing with only ~1,000 free calls.
 *
 * The cheap mask is therefore the default. Contact detail mostly arrives from
 * OSM after merging anyway; set GOOGLE_PLACES_FIELDS=full only if you want
 * Google's hours and phone numbers badly enough to pay their rate for them.
 */
const FIELD_MASK_BASIC = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.businessStatus",
].join(",");

const FIELD_MASK_FULL = [
  FIELD_MASK_BASIC,
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.regularOpeningHours.openNow",
].join(",");

function fieldMask(): string {
  return process.env.GOOGLE_PLACES_FIELDS === "full"
    ? FIELD_MASK_FULL
    : FIELD_MASK_BASIC;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[]; openNow?: boolean };
  businessStatus?: string;
}

function classifyGoogle(place: GooglePlace): CategoryId | null {
  if (place.primaryType && TYPE_TO_CATEGORY[place.primaryType]) {
    return TYPE_TO_CATEGORY[place.primaryType];
  }
  for (const type of place.types ?? []) {
    if (TYPE_TO_CATEGORY[type]) return TYPE_TO_CATEGORY[type];
  }
  return null;
}

export const googleProvider: Provider = {
  id: "google",
  label: "Google Places",

  isEnabled() {
    return Boolean(process.env.GOOGLE_PLACES_API_KEY);
  },

  disabledReason() {
    return this.isEnabled()
      ? undefined
      : "Set GOOGLE_PLACES_API_KEY to include Google's listings (billed per request).";
  },

  async fetch({ lat, lon, radius, signal }: ProviderQuery): Promise<ProviderResult> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return emptyResult(this.disabledReason());

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fieldMask(),
        },
        body: JSON.stringify({
          includedTypes: REQUESTED_TYPES,
          maxResultCount: MAX_RESULTS,
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lon },
              radius: Math.min(radius, MAX_RADIUS_M),
            },
          },
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
          : AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const detail = await response.text();
        // An invalid type name is a config problem worth surfacing verbatim.
        return emptyResult(
          `Google Places returned HTTP ${response.status}: ${detail.slice(0, 160)}`,
        );
      }

      const payload = (await response.json()) as { places?: GooglePlace[] };
      const places: Place[] = [];
      const closures: Closure[] = [];

      for (const row of payload.places ?? []) {
        const name = row.displayName?.text?.trim();
        const rowLat = row.location?.latitude;
        const rowLon = row.location?.longitude;
        if (!name || rowLat === undefined || rowLon === undefined) continue;
        if (row.businessStatus === "CLOSED_PERMANENTLY") {
          // Google is the freshest source on operating status; a permanent
          // closure here should also take down the stale copy of the same
          // place that other sources still carry.
          closures.push({ name, lat: rowLat, lon: rowLon, source: "google" });
          continue;
        }
        if (row.businessStatus && row.businessStatus !== "OPERATIONAL") continue;

        const category = classifyGoogle(row);
        if (!category) continue;

        const hours = row.regularOpeningHours?.weekdayDescriptions?.join("; ");

        places.push({
          id: `google:${row.id ?? `${rowLat},${rowLon}`}`,
          name,
          category,
          kind: "permanent",
          lat: rowLat,
          lon: rowLon,
          distance: haversine(lat, lon, rowLat, rowLon),
          address: row.formattedAddress,
          phone: row.nationalPhoneNumber,
          website: row.websiteUri,
          openingHours: hours,
          // Google tells us directly, which beats parsing its prose hours.
          openState:
            row.regularOpeningHours?.openNow === undefined
              ? "unknown"
              : row.regularOpeningHours.openNow
                ? "open"
                : "closed",
          tags: {},
          independence: assessIndependence({ name }),
          confidence: "verified",
          sources: [
            {
              source: "google",
              ref: row.id,
              url: row.id
                ? `https://www.google.com/maps/place/?q=place_id:${row.id}`
                : undefined,
            },
          ],
          source: "google",
          sourceUrl: row.id
            ? `https://www.google.com/maps/place/?q=place_id:${row.id}`
            : undefined,
        });
      }

      return { places, closures };
    } catch (error) {
      return emptyResult(
        `Google Places unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};
