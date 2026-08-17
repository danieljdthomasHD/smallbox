import { assessIndependence } from "../chains";
import { extractListings, isExtractionEnabled, type ExtractionInput, type ExtractionOutput } from "../extract";
import { haversine } from "../geo";
import { locateVenue } from "../geocode";
import { evaluateHours } from "../hours";
import type { Occurrence, Place } from "../types";
import { DIRECTORY_REGISTRY, type DirectoryEntry } from "./directoryRegistry";
import { emptyResult, type Provider, type ProviderQuery, type ProviderResult } from "./types";

/**
 * Curated market guides, read as a data source.
 *
 * Regional guides — the Edible magazine network, state agriculture pages —
 * list markets with their actual weekday, hours and season, and they list the
 * ones OpenStreetMap doesn't have. Each registry entry is fetched when a
 * search overlaps its region, converted to text, and handed to the shared
 * Claude extraction pass; venues are then geocoded through Nominatim.
 *
 * Listings come back as "reported" rather than "verified": a human editor
 * curated them, but our reading of the page is still an inference.
 */

const FETCH_TIMEOUT_MS = 15_000;
/** Keep a directory's extracted places for this long before re-reading it. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Characters per pseudo-article handed to extraction. */
const CHUNK_CHARS = 6000;

interface CacheRow {
  at: number;
  /** Places with directory-relative data; distance is filled per query. */
  places: Omit<Place, "distance">[];
}

/** Per-process caches — a warm serverless instance skips refetch and regeocode. */
const directoryCache = new Map<string, CacheRow>();
const venueCache = new Map<string, { lat: number; lon: number; precise: boolean }>();

/** Strip a page down to readable text for the extraction pass. */
function pageToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&ndash;|&#8211;/g, "–")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Split page text into extraction inputs without cutting a listing in half. */
function chunk(text: string, entry: DirectoryEntry): ExtractionInput[] {
  const chunks: ExtractionInput[] = [];
  let rest = text;
  while (rest.length > 0 && chunks.length < 8) {
    let piece = rest.slice(0, CHUNK_CHARS);
    if (rest.length > CHUNK_CHARS) {
      // Break on a line boundary so a market's name stays with its details.
      const cut = piece.lastIndexOf("\n");
      if (cut > CHUNK_CHARS / 2) piece = piece.slice(0, cut);
    }
    rest = rest.slice(piece.length);
    chunks.push({
      id: `d${chunks.length + 1}`,
      title: entry.label,
      summary: piece,
      url: entry.url,
    });
  }
  return chunks;
}

async function geocodeListing(
  venue: string | null,
  entry: DirectoryEntry,
  signal?: AbortSignal,
): Promise<{ lat: number; lon: number; precise: boolean } | null> {
  const key = `${entry.id}|${venue ?? ""}`;
  const cached = venueCache.get(key);
  if (cached) return cached;
  if (signal?.aborted) return null;

  const point = await locateVenue(venue, entry.areaName, {
    lat: entry.region.lat,
    lon: entry.region.lon,
  });
  // A fall-through to the region centre would drop a pin 50km from the real
  // market; better to omit the listing than to invent its location.
  if (!point.precise) return null;

  venueCache.set(key, point);
  return point;
}

async function readDirectory(
  entry: DirectoryEntry,
  signal?: AbortSignal,
): Promise<{ places: Omit<Place, "distance">[]; note?: string }> {
  const cached = directoryCache.get(entry.id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { places: cached.places };
  }

  const response = await fetch(entry.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Smallbox/0.1; local food finder)",
      Accept: "text/html",
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
      : AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${entry.label} returned HTTP ${response.status}`);
  }

  const text = pageToText(await response.text());
  if (text.length < 200) throw new Error(`${entry.label} returned no readable text`);

  const extraction = await extractListings(chunk(text, entry), entry.areaName, signal);
  if (extraction.batches > 0 && extraction.failed === extraction.batches) {
    throw new Error(extraction.lastError ?? "extraction failed");
  }

  const places: Omit<Place, "distance">[] = [];
  let skippedGeocode = 0;
  let interrupted = false;

  for (const [index, output] of extraction.listings.entries()) {
    if (signal?.aborted) {
      interrupted = true;
      break;
    }
    const { listing } = output as ExtractionOutput;

    const point = await geocodeListing(listing.venue, entry, signal);
    if (!point) {
      skippedGeocode++;
      continue;
    }

    const occurrences: Occurrence[] = listing.occurrences
      .filter((o) => o.start && !Number.isNaN(Date.parse(o.start)))
      .map((o) => ({
        start: o.start,
        end: o.end && !Number.isNaN(Date.parse(o.end)) ? o.end : undefined,
        note: o.note ?? undefined,
      }));

    const independence = assessIndependence({
      name: listing.name,
      ...(listing.category === "farmers_market" ? { amenity: "marketplace" } : {}),
    });
    independence.reasons.push(`Listed in ${entry.label}`);

    places.push({
      id: `directories:${entry.id}:${index}`,
      name: listing.name,
      category: listing.category,
      kind: listing.kind,
      lat: point.lat,
      lon: point.lon,
      address: listing.venue ?? undefined,
      openingHours: listing.schedule ?? undefined,
      openState: evaluateHours(listing.schedule ?? undefined),
      occurrences: occurrences.length ? occurrences : undefined,
      description: listing.description,
      tags: {},
      independence,
      confidence: "reported",
      sources: [
        { source: "directories", ref: entry.id, url: entry.url, title: entry.label },
      ],
      source: "directories",
      sourceUrl: entry.url,
    });
  }

  // Only a complete read is worth remembering; a partial one would freeze a
  // half-indexed directory in the cache for six hours.
  if (!interrupted) {
    directoryCache.set(entry.id, { at: Date.now(), places });
  }

  const notes: string[] = [];
  if (skippedGeocode > 0) {
    notes.push(`${skippedGeocode} listing(s) couldn't be placed on the map`);
  }
  if (interrupted) {
    notes.push("ran out of time mid-read; search again to finish indexing");
  }
  return { places, note: notes.length ? notes.join("; ") : undefined };
}

export const directoriesProvider: Provider = {
  id: "directories",
  label: "Market directories",

  isEnabled() {
    return isExtractionEnabled();
  },

  disabledReason() {
    return this.isEnabled()
      ? undefined
      : "Set ANTHROPIC_API_KEY to read curated regional market guides.";
  },

  async fetch({ lat, lon, radius, signal }: ProviderQuery): Promise<ProviderResult> {
    if (!this.isEnabled()) return emptyResult(this.disabledReason());

    const relevant = DIRECTORY_REGISTRY.filter(
      (entry) =>
        haversine(lat, lon, entry.region.lat, entry.region.lon) <=
        entry.region.radiusKm * 1000 + radius,
    );
    if (relevant.length === 0) {
      return emptyResult("No curated market guide covers this area yet.");
    }

    const places: Place[] = [];
    const notes: string[] = [];

    for (const entry of relevant) {
      try {
        const result = await readDirectory(entry, signal);
        for (const partial of result.places) {
          const distance = haversine(lat, lon, partial.lat, partial.lon);
          // The guide covers a whole region; only surface what's near this search.
          if (distance > radius * 1.5) continue;
          places.push({ ...partial, distance });
        }
        if (result.note) notes.push(`${entry.label}: ${result.note}`);
      } catch (error) {
        notes.push(
          `${entry.label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { places, note: notes.length ? notes.join(" · ") : undefined };
  },
};
