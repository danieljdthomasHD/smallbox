import { nameSaysNotFresh } from "../categories";
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
  asian_grocery_store: "grocery",
  fruit_and_vegetable_store: "produce",
  greengrocer: "produce",
  organic_food_store: "produce",
};

/**
 * Only "Table A" types may be used to filter a search; the rest (seafood_store,
 * cheese_store, fruit_and_vegetable_store...) appear in responses only, and
 * putting one in `includedTypes` fails the whole request with
 * "Unsupported types". Those shops still arrive here — a fishmonger also
 * carries a broader store type — and the response-only type classifies it.
 *
 * `food_store` is deliberately not requested even though it's legal: Google
 * applies it to fast food and coffee shops too, and with a 20-result cap the
 * junk crowds out real shops. It stays in the map above so it can still
 * classify a place that arrives via another requested type.
 */
const REQUESTED_TYPES = [
  "farmers_market",
  "market",
  "butcher_shop",
  "bakery",
  "grocery_store",
  "supermarket",
  "deli",
  "health_food_store",
  "asian_grocery_store",
];

/**
 * Types that mark a place as primarily somewhere to eat, drink or fill the
 * car — not a fresh-food shop. Live Covington data: McDonald's, Coffee
 * Emporium and a cigar bar all arrived carrying store-shaped secondary types.
 * A mapped `primaryType` wins over this list, so a bakery that is also a cafe
 * (most good ones) and a deli that is also a sandwich shop survive.
 */
const DISQUALIFYING_TYPES = new Set([
  "restaurant",
  "fast_food_restaurant",
  "hamburger_restaurant",
  "pizza_restaurant",
  "sandwich_shop",
  "cafe",
  "cafeteria",
  "coffee_shop",
  "tea_house",
  "bar",
  "pub",
  "wine_bar",
  "night_club",
  "meal_takeaway",
  "meal_delivery",
  "ice_cream_shop",
  "dessert_shop",
  "donut_shop",
  "bagel_shop",
  "candy_store",
  "chocolate_shop",
  "juice_shop",
  "liquor_store",
  "convenience_store",
  "gas_station",
  "cigar_shop",
  "tobacco_shop",
]);

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

/**
 * Types broad enough that carrying one proves nothing: Google hangs
 * food_store on McDonald's and grocery_store on gas stations. These only
 * count once the disqualifying types have had their say, whereas a specific
 * format (deli, butcher_shop, cheese_store...) is trusted outright — a
 * delicatessen is usually ALSO typed sandwich_shop, and the specific type is
 * the truer identity.
 */
const BROAD_TYPES = new Set(["food_store", "grocery_store", "supermarket", "market"]);

export function classifyGoogle(place: GooglePlace): CategoryId | null {
  // A place whose primary identity is one of ours is one of ours, whatever
  // else it does on the side.
  if (place.primaryType && TYPE_TO_CATEGORY[place.primaryType]) {
    return TYPE_TO_CATEGORY[place.primaryType];
  }
  const types = place.types ?? [];
  for (const type of types) {
    if (TYPE_TO_CATEGORY[type] && !BROAD_TYPES.has(type)) return TYPE_TO_CATEGORY[type];
  }
  // Only the broad store types are left. A restaurant/cafe/bar/gas identity
  // disqualifies before they get a say — that's how McDonald's (types include
  // food_store) would end up listed as a corner grocer.
  if (types.some((t) => DISQUALIFYING_TYPES.has(t))) return null;
  for (const type of types) {
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
        // Same rule as the OSM lane: a grocery-shaped listing whose name leads
        // with liquor, carryout, tobacco, gas or supplements isn't fresh food.
        if (category === "grocery" && nameSaysNotFresh(name)) continue;

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
