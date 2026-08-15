import { XMLParser } from "fast-xml-parser";

import { assessIndependence } from "../chains";
import { extractListings, isExtractionEnabled, type ExtractionInput } from "../extract";
import { haversine } from "../geo";
import { locateVenue } from "../geocode";
import type { Occurrence, Place } from "../types";
import { emptyResult, type Provider, type ProviderQuery, type ProviderResult } from "./types";

/**
 * Local news as a data source.
 *
 * Some markets only ever exist in print: a pop-up running three Saturdays in
 * August, a new tailgate market a neighbourhood just launched, a festival with a
 * produce row. None of that reaches OpenStreetMap in time to be useful, but the
 * local paper covers it. Google News' RSS endpoint is free and needs no key, so
 * we query it per area and hand the results to Claude for extraction.
 *
 * Everything from here is a lead, not a fact: the UI labels it, and the merge
 * step upgrades it only when a structured source independently agrees.
 */

const RSS_ENDPOINT = "https://news.google.com/rss/search";
const FETCH_TIMEOUT_MS = 15_000;
/** Cap on articles sent for extraction, to bound cost and latency. */
const MAX_ARTICLES = 24;

/**
 * Query phrasings, run separately because one search doesn't surface all of it.
 * Each is scoped to the search area by the caller.
 */
const QUERIES = [
  '"farmers market"',
  '"tailgate market" OR "growers market" OR "producers market"',
  '"farm stand" OR "produce stand" OR "farm shop"',
  '"pop-up market" OR "night market" OR "harvest festival"',
];

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
  source?: string | { "#text"?: string };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/** RSS descriptions are HTML fragments; the model wants readable text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchFeed(query: string, signal?: AbortSignal): Promise<RssItem[]> {
  const url = new URL(RSS_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const response = await fetch(url, {
    headers: {
      // Google News rejects requests without a browser-ish agent.
      "User-Agent":
        "Mozilla/5.0 (compatible; Smallbox/0.1; local food finder)",
      Accept: "application/rss+xml, application/xml",
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
      : AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`Google News returned HTTP ${response.status}`);

  const xml = await response.text();
  const doc = parser.parse(xml) as {
    rss?: { channel?: { item?: RssItem | RssItem[] } };
  };
  const items = doc?.rss?.channel?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

/** Drop obvious noise before spending tokens on it. */
const RELEVANT = /market|farm|produce|grower|orchard|butcher|baker|creamery|fishmonger|greengrocer|harvest|csa\b/i;

function toOccurrences(
  raw: { start: string; end: string | null; note: string | null }[],
): Occurrence[] | undefined {
  const out: Occurrence[] = [];
  for (const occ of raw) {
    // Guard against a malformed date rather than rendering "Invalid Date".
    if (!occ.start || Number.isNaN(Date.parse(occ.start))) continue;
    out.push({
      start: occ.start,
      end: occ.end && !Number.isNaN(Date.parse(occ.end)) ? occ.end : undefined,
      note: occ.note ?? undefined,
    });
  }
  return out.length ? out : undefined;
}

/** Drop popups whose last date has already passed. */
function isStale(occurrences: Occurrence[] | undefined): boolean {
  if (!occurrences?.length) return false;
  const latest = occurrences.reduce((max, o) => {
    const t = Date.parse(o.end ?? o.start);
    return Number.isNaN(t) ? max : Math.max(max, t);
  }, 0);
  if (!latest) return false;
  // Keep same-day events until the end of the day.
  return latest < Date.now() - 24 * 60 * 60 * 1000;
}

export const newsProvider: Provider = {
  id: "news",
  label: "Local news",

  isEnabled() {
    return isExtractionEnabled();
  },

  disabledReason() {
    return this.isEnabled()
      ? undefined
      : "Set ANTHROPIC_API_KEY to read local news coverage for pop-up and seasonal markets.";
  },

  async fetch({ lat, lon, radius, areaName, signal }: ProviderQuery): Promise<ProviderResult> {
    if (!this.isEnabled()) return emptyResult(this.disabledReason());
    if (!areaName) {
      return emptyResult("No place name for this area, so news can't be searched.");
    }

    // Collect articles across the query phrasings, de-duplicated by link.
    const seen = new Set<string>();
    const articles: ExtractionInput[] = [];
    let feedFailures = 0;

    const feeds = await Promise.allSettled(
      QUERIES.map((q) => fetchFeed(`${q} ${areaName}`, signal)),
    );

    for (const feed of feeds) {
      if (feed.status === "rejected") {
        feedFailures++;
        continue;
      }
      for (const item of feed.value) {
        const title = typeof item.title === "string" ? item.title.trim() : "";
        const link = typeof item.link === "string" ? item.link : "";
        if (!title || !link || seen.has(link)) continue;

        const summary = stripHtml(String(item.description ?? ""));
        if (!RELEVANT.test(`${title} ${summary}`)) continue;

        seen.add(link);
        articles.push({
          id: `a${articles.length + 1}`,
          title,
          summary: summary.slice(0, 1200) || title,
          url: link,
          publishedAt: item.pubDate,
        });
        if (articles.length >= MAX_ARTICLES) break;
      }
      if (articles.length >= MAX_ARTICLES) break;
    }

    if (feedFailures === QUERIES.length) {
      return emptyResult("Google News was unreachable.");
    }
    if (articles.length === 0) {
      return emptyResult("No local coverage mentioning markets in this area.");
    }

    const extraction = await extractListings(articles, areaName, signal);
    // "Found nothing" and "couldn't read anything" mean different things to
    // someone deciding whether to trust an empty result, so say which happened.
    if (extraction.batches > 0 && extraction.failed === extraction.batches) {
      return emptyResult(
        `Couldn't read local coverage: ${extraction.lastError ?? "extraction failed"}.`,
      );
    }

    const extracted = extraction.listings;
    if (extracted.length === 0) {
      return emptyResult(
        `Read ${articles.length} article${articles.length === 1 ? "" : "s"}; none named a market here.`,
      );
    }

    const places: Place[] = [];
    for (const [index, { listing, source }] of extracted.entries()) {
      const occurrences = toOccurrences(listing.occurrences);
      if (isStale(occurrences)) continue;

      const point = await locateVenue(listing.venue, areaName, { lat, lon });
      const distance = haversine(lat, lon, point.lat, point.lon);
      // A venue that only resolved to the town centre may be well outside the
      // requested radius; drop it rather than pretend it's nearby.
      if (distance > radius * 1.5) continue;

      const independence = assessIndependence({
        name: listing.name,
        ...(listing.kind === "popup" ? { amenity: "marketplace" } : {}),
      });
      if (!listing.independentlyOwned) {
        independence.score = Math.min(independence.score, 30);
        independence.independent = false;
        independence.reasons.push("Described as a chain in local coverage");
      }

      places.push({
        id: `news:${index}:${listing.name.toLowerCase().replace(/\s+/g, "-")}`,
        name: listing.name,
        category: listing.category,
        kind: listing.kind,
        lat: point.lat,
        lon: point.lon,
        distance,
        address: listing.venue ?? undefined,
        openState: "unknown",
        occurrences,
        description: listing.description,
        tags: point.precise ? {} : { location_approximate: "yes" },
        independence,
        confidence: "lead",
        sources: [
          {
            source: "news",
            ref: source.id,
            url: source.url,
            title: source.title,
            retrievedAt: source.publishedAt,
          },
        ],
        source: "news",
        sourceUrl: source.url,
      });
    }

    return {
      places,
      note:
        places.length === 0
          ? "Local coverage mentioned markets, but none could be placed on the map."
          : undefined,
    };
  },
};
