import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { CATEGORY_LIST } from "./categories";
import type { CategoryId } from "./types";

/**
 * Pulling structured listings out of unstructured text.
 *
 * News articles and event listings are the only place some markets exist —
 * a pop-up running three Saturdays in August is never going to be an OSM node,
 * and the town paper is where it gets announced. But an article is prose: it
 * mentions markets in passing, writes about markets in other towns, and reports
 * on ones that have closed. Reading that reliably is a language problem, so we
 * hand it to Claude with a strict schema and treat everything it returns as a
 * lead to be labelled, never as verified fact.
 *
 * Requires ANTHROPIC_API_KEY. Without it the news and event providers still run
 * but skip extraction, which means they contribute nothing — the app is fully
 * functional on its structured sources alone.
 */

const CATEGORY_IDS = CATEGORY_LIST.map((c) => c.id) as [CategoryId, ...CategoryId[]];

const OccurrenceSchema = z.object({
  start: z
    .string()
    .describe("Start date-time in ISO-8601, e.g. 2026-08-15T08:00:00. Date alone is fine."),
  end: z.string().nullable().describe("End date-time in ISO-8601, or null."),
  note: z
    .string()
    .nullable()
    .describe('The article\'s own phrasing, e.g. "Saturdays through October".'),
});

const ListingSchema = z.object({
  articleId: z
    .string()
    .describe("The id attribute of the <article> this listing was found in."),
  name: z.string().describe("The market or shop's own name, as printed."),
  category: z.enum(CATEGORY_IDS).describe("Best-fitting category."),
  kind: z
    .enum(["permanent", "popup"])
    .describe(
      "permanent = open on an ongoing basis. popup = runs only on specific dates, including festival and seasonal markets.",
    ),
  venue: z
    .string()
    .nullable()
    .describe("Street address or venue name where it takes place, if stated."),
  occurrences: z
    .array(OccurrenceSchema)
    .describe("Specific dates it runs. Empty for an ongoing business with no dates given."),
  description: z
    .string()
    .describe("One sentence, drawn from the article, on what this is."),
  independentlyOwned: z
    .boolean()
    .describe(
      "True unless the article indicates it is a chain, franchise, or big-box retailer.",
    ),
  stillOperating: z
    .boolean()
    .describe("False if the article reports it as closed, cancelled, or ended."),
});

const ExtractionSchema = z.object({
  listings: z
    .array(ListingSchema)
    .describe("Every distinct market, farm stand or independent food shop found. May be empty."),
});

export type ExtractedListing = z.infer<typeof ListingSchema>;

export interface ExtractionInput {
  /** Short id so we can tie a listing back to the article it came from. */
  id: string;
  title: string;
  summary: string;
  url?: string;
  publishedAt?: string;
}

export interface ExtractionOutput {
  listing: ExtractedListing;
  /** The article this came from. */
  source: ExtractionInput;
}

export interface ExtractionResult {
  listings: ExtractionOutput[];
  /** Batches attempted and how many errored, so callers can tell "found
   *  nothing" apart from "couldn't read anything" — those mean different
   *  things to someone deciding whether to trust an empty result. */
  batches: number;
  failed: number;
  lastError?: string;
}

const MODEL = process.env.SMALLBOX_EXTRACT_MODEL ?? "claude-opus-5";
/** Articles per request. Batching keeps the call count (and cost) down. */
const BATCH_SIZE = 12;

export function isExtractionEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = `You extract listings for a local-food finder from news articles and event listings.

The app shows people farmers markets, farm stands, produce stands, independent butchers, fishmongers, bakeries, cheesemongers and small independent grocers. It deliberately excludes big-box stores and chains.

For each article you are given, extract every distinct qualifying place it describes.

What to extract:
- Markets and shops the article says exist or will exist, including one-off and seasonal pop-ups.
- Festivals and community events, but only when the article indicates produce, farm goods, or food vendors are actually sold there. A music festival with food trucks is not a farmers market.

What to skip entirely:
- Restaurants, cafes, bars, and food trucks selling prepared meals.
- Chains, franchises, supermarkets, and big-box retailers.
- Places outside the search area named in the request.
- Articles that only discuss policy, prices, or agriculture generally without naming a place a person can visit.

Set stillOperating to false when the article reports a closure, cancellation, or final season — those are recorded, not silently dropped, so the app can suppress them.

Resolve dates against the article's publication date. If it says "this Saturday", work out the actual date. If no dates are given for an ongoing business, return an empty occurrences array rather than inventing one.

Set articleId on every listing to the id of the <article> element you found it in, so each listing can be linked back to its source.

Extract only what the text supports. Do not infer an address that isn't there, and do not pad the results — returning an empty list for an article with nothing in it is the correct answer.`;

function buildUserMessage(articles: ExtractionInput[], areaName: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const body = articles
    .map(
      (a) =>
        `<article id="${a.id}">\n<title>${a.title}</title>\n<published>${a.publishedAt ?? "unknown"}</published>\n<text>${a.summary}</text>\n</article>`,
    )
    .join("\n\n");

  return `Search area: ${areaName}
Today's date: ${today}

${body}`;
}

/**
 * Run extraction over a batch of articles.
 *
 * Returns an empty array rather than throwing: a news source is enrichment, and
 * a failure there must never take down a search that OSM already answered.
 */
export async function extractListings(
  articles: ExtractionInput[],
  areaName: string,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const empty: ExtractionResult = { listings: [], batches: 0, failed: 0 };
  if (!isExtractionEnabled() || articles.length === 0) return empty;

  const client = new Anthropic();
  const listings: ExtractionOutput[] = [];
  let batches = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    batches++;
    try {
      const response = await client.messages.parse(
        {
          model: MODEL,
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildUserMessage(batch, areaName) }],
          output_config: { format: zodOutputFormat(ExtractionSchema) },
        },
        { signal },
      );

      const parsed = response.parsed_output;
      if (!parsed) {
        failed++;
        lastError = "model returned no parseable output";
        continue;
      }

      const byId = new Map(batch.map((a) => [a.id, a]));
      for (const listing of parsed.listings) {
        if (!listing.stillOperating) continue;
        // Each listing names the article it came from, so provenance shown in
        // the UI links to the piece that actually mentioned this place.
        const source = byId.get(listing.articleId);
        if (!source) continue;
        listings.push({ listing, source });
      }
    } catch (error) {
      failed++;
      lastError = error instanceof Error ? error.message : String(error);
      // Log server-side; the caller reports the source as degraded.
      console.warn("[smallbox] extraction batch failed:", lastError);
    }
  }

  return { listings, batches, failed, lastError };
}
