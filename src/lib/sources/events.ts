import { assessIndependence } from "../chains";
import { extractListings, isExtractionEnabled, type ExtractionInput } from "../extract";
import { haversine } from "../geo";
import { locateVenue } from "../geocode";
import type { Occurrence, Place } from "../types";
import { emptyResult, type Provider, type ProviderQuery, type ProviderResult } from "./types";

/**
 * Festivals and ticketed events that include a market.
 *
 * Harvest festivals, night markets and county fairs often have a full produce
 * row, and they are listed in event databases long before anyone maps them.
 * Ticketmaster's Discovery API is the broadest free option; a key is free from
 * https://developer-acct.ticketmaster.com/ and the provider stays off without one.
 *
 * Event titles alone are unreliable ("Harvest Festival" may be a concert), so
 * each candidate goes through the same Claude extraction pass as the news
 * source, which decides whether food is actually sold there.
 */

const ENDPOINT = "https://app.ticketmaster.com/discovery/v2/events.json";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_EVENTS = 20;
/** Ticketmaster takes a radius in whole miles, capped well below our max. */
const MAX_RADIUS_MILES = 100;

const KEYWORDS = ["farmers market", "harvest festival", "night market", "food festival"];

interface TicketmasterEvent {
  id?: string;
  name?: string;
  url?: string;
  info?: string;
  description?: string;
  pleaseNote?: string;
  dates?: { start?: { dateTime?: string; localDate?: string }; end?: { dateTime?: string } };
  _embedded?: {
    venues?: {
      name?: string;
      address?: { line1?: string };
      city?: { name?: string };
      location?: { latitude?: string; longitude?: string };
    }[];
  };
}

async function fetchEvents(
  keyword: string,
  lat: number,
  lon: number,
  radiusMiles: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<TicketmasterEvent[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("latlong", `${lat},${lon}`);
  url.searchParams.set("radius", String(radiusMiles));
  url.searchParams.set("unit", "miles");
  url.searchParams.set("size", "20");
  url.searchParams.set("sort", "date,asc");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
      : AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`Ticketmaster returned HTTP ${response.status}`);

  const payload = (await response.json()) as {
    _embedded?: { events?: TicketmasterEvent[] };
  };
  return payload._embedded?.events ?? [];
}

export const eventsProvider: Provider = {
  id: "events",
  label: "Festivals & events",

  isEnabled() {
    return Boolean(process.env.TICKETMASTER_API_KEY) && isExtractionEnabled();
  },

  disabledReason() {
    if (!process.env.TICKETMASTER_API_KEY) {
      return "Set TICKETMASTER_API_KEY (free) to include festivals and one-off markets.";
    }
    if (!isExtractionEnabled()) {
      return "Set ANTHROPIC_API_KEY so event listings can be read for market content.";
    }
    return undefined;
  },

  async fetch({ lat, lon, radius, areaName, signal }: ProviderQuery): Promise<ProviderResult> {
    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey || !isExtractionEnabled()) return emptyResult(this.disabledReason());

    const radiusMiles = Math.min(
      MAX_RADIUS_MILES,
      Math.max(1, Math.round(radius / 1609.344)),
    );

    const feeds = await Promise.allSettled(
      KEYWORDS.map((k) => fetchEvents(k, lat, lon, radiusMiles, apiKey, signal)),
    );

    if (feeds.every((f) => f.status === "rejected")) {
      return emptyResult("Ticketmaster was unreachable.");
    }

    // Collect candidate events, keeping the venue geometry we already have.
    const seen = new Set<string>();
    const articles: ExtractionInput[] = [];
    const venueById = new Map<string, { lat?: number; lon?: number; venue?: string }>();

    for (const feed of feeds) {
      if (feed.status === "rejected") continue;
      for (const event of feed.value) {
        const name = event.name?.trim();
        if (!name || !event.id || seen.has(event.id)) continue;
        seen.add(event.id);

        const venue = event._embedded?.venues?.[0];
        const venueLat = Number(venue?.location?.latitude);
        const venueLon = Number(venue?.location?.longitude);
        const venueName = [venue?.name, venue?.address?.line1, venue?.city?.name]
          .filter(Boolean)
          .join(", ");

        const id = `e${articles.length + 1}`;
        venueById.set(id, {
          lat: Number.isFinite(venueLat) ? venueLat : undefined,
          lon: Number.isFinite(venueLon) ? venueLon : undefined,
          venue: venueName || undefined,
        });

        const start = event.dates?.start?.dateTime ?? event.dates?.start?.localDate;
        const blurb = [event.info, event.description, event.pleaseNote]
          .filter(Boolean)
          .join(" ")
          .slice(0, 1000);

        articles.push({
          id,
          title: name,
          summary:
            `${blurb || name}. Venue: ${venueName || "unknown"}.` +
            (start ? ` Starts ${start}.` : ""),
          url: event.url,
          publishedAt: start,
        });

        if (articles.length >= MAX_EVENTS) break;
      }
      if (articles.length >= MAX_EVENTS) break;
    }

    if (articles.length === 0) {
      return emptyResult("No festivals or events listed for this area.");
    }

    const extraction = await extractListings(
      articles,
      areaName ?? "this area",
      signal,
    );
    if (extraction.batches > 0 && extraction.failed === extraction.batches) {
      return emptyResult(
        `Couldn't read event listings: ${extraction.lastError ?? "extraction failed"}.`,
      );
    }

    const extracted = extraction.listings;
    if (extracted.length === 0) {
      return emptyResult(
        `Checked ${articles.length} event${articles.length === 1 ? "" : "s"}; none sell local food.`,
      );
    }

    const places: Place[] = [];
    for (const [index, { listing, source }] of extracted.entries()) {
      const known = venueById.get(source.id);

      // Prefer the event listing's own coordinates; fall back to geocoding.
      let point: { lat: number; lon: number; precise: boolean };
      if (known?.lat !== undefined && known.lon !== undefined) {
        point = { lat: known.lat, lon: known.lon, precise: true };
      } else {
        point = await locateVenue(
          listing.venue ?? known?.venue ?? null,
          areaName ?? "",
          { lat, lon },
        );
      }

      const distance = haversine(lat, lon, point.lat, point.lon);
      if (distance > radius * 1.5) continue;

      const occurrences: Occurrence[] = listing.occurrences
        .filter((o) => o.start && !Number.isNaN(Date.parse(o.start)))
        .map((o) => ({
          start: o.start,
          end: o.end && !Number.isNaN(Date.parse(o.end)) ? o.end : undefined,
          note: o.note ?? undefined,
        }));

      places.push({
        id: `events:${source.id}:${index}`,
        name: listing.name,
        category: listing.category,
        // An event source describes something time-bound by definition.
        kind: "popup",
        lat: point.lat,
        lon: point.lon,
        distance,
        address: listing.venue ?? known?.venue,
        openState: "unknown",
        occurrences: occurrences.length ? occurrences : undefined,
        description: listing.description,
        tags: point.precise ? {} : { location_approximate: "yes" },
        independence: assessIndependence({
          name: listing.name,
          amenity: "marketplace",
        }),
        confidence: "lead",
        sources: [
          {
            source: "events",
            ref: source.id,
            url: source.url,
            title: source.title,
            retrievedAt: source.publishedAt,
          },
        ],
        source: "events",
        sourceUrl: source.url,
      });
    }

    return { places };
  },
};
