import { normalizeName } from "./chains";
import { haversine } from "./geo";
import type { Closure, Confidence, Occurrence, Place, SourceId } from "./types";

/**
 * Fold listings from several sources into one set of places.
 *
 * The same market can arrive from OpenStreetMap, the USDA directory, Google and
 * a newspaper article, under four slightly different names. Showing it four
 * times is worse than showing it once, so we match on name + proximity and merge
 * — keeping every source reference, because provenance is what lets the UI say
 * "three sources agree" instead of asking the reader to take it on faith.
 */

/** Two listings this close with a matching name are the same place. */
const SAME_PLACE_METRES = 180;
/** A popup pinned only to a town centre needs a looser radius to match. */
const SAME_PLACE_METRES_FUZZY = 700;

/** Sources ordered by how much structural detail they carry. */
const SOURCE_RANK: Record<SourceId, number> = {
  community: 0, // A human deliberately corrected this — trust it most.
  osm: 1,
  usda: 2,
  google: 3,
  directories: 4, // Curated guides — human-edited, but read via extraction.
  events: 5,
  news: 6,
};

const CONFIDENCE_RANK: Record<Confidence, number> = {
  verified: 0,
  reported: 1,
  lead: 2,
};

/** Strip words that differ between sources for the same market. */
function matchKey(name: string): string {
  return normalizeName(name)
    .replace(
      /\b(the|a|an|farmers?|growers?|community|tailgate|market|markets|marketplace|inc|llc|co|company|shop|store)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when two names plausibly denote the same business.
 *
 * Exact match after stripping filler words, or one name containing the other —
 * "Asheville City Market" vs "Asheville City Market South".
 */
export function namesMatch(a: string, b: string): boolean {
  const ka = matchKey(a);
  const kb = matchKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length >= 4 && kb.length >= 4) {
    if (ka.includes(kb) || kb.includes(ka)) return true;
  }
  return false;
}

function mergeOccurrences(a?: Occurrence[], b?: Occurrence[]): Occurrence[] | undefined {
  if (!a && !b) return undefined;
  const all = [...(a ?? []), ...(b ?? [])];
  const seen = new Set<string>();
  const out: Occurrence[] = [];
  for (const occ of all) {
    const key = `${occ.start}|${occ.end ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(occ);
  }
  out.sort((x, y) => x.start.localeCompare(y.start));
  return out.length ? out : undefined;
}

/** Keep the richer of two records field by field, preferring the higher-rank source. */
function combine(primary: Place, secondary: Place): Place {
  const pick = <K extends keyof Place>(key: K): Place[K] =>
    (primary[key] ?? secondary[key]) as Place[K];

  const sources = [...primary.sources];
  for (const ref of secondary.sources) {
    if (!sources.some((s) => s.source === ref.source && s.ref === ref.ref)) {
      sources.push(ref);
    }
  }

  // Corroboration raises confidence: two independent sources describing the same
  // place is meaningfully stronger than one, and a lead confirmed by a mapped
  // record stops being a lead at all.
  const best = CONFIDENCE_RANK[primary.confidence] <= CONFIDENCE_RANK[secondary.confidence]
    ? primary.confidence
    : secondary.confidence;
  const distinctSources = new Set(sources.map((s) => s.source));
  const confidence: Confidence =
    best === "lead" && distinctSources.size > 1 ? "reported" : best;

  return {
    ...primary,
    // A permanent record wins over a popup guess, but popup dates are kept.
    kind: primary.kind === "permanent" || secondary.kind === "permanent" ? "permanent" : "popup",
    address: pick("address"),
    phone: pick("phone"),
    website: pick("website"),
    openingHours: pick("openingHours"),
    description: pick("description"),
    organic: primary.organic || secondary.organic,
    occurrences: mergeOccurrences(primary.occurrences, secondary.occurrences),
    tags: { ...secondary.tags, ...primary.tags },
    // Keep the more decisive independence verdict — whichever moved further from
    // the neutral 70 has actually learned something about this place.
    independence:
      Math.abs(primary.independence.score - 70) >=
      Math.abs(secondary.independence.score - 70)
        ? primary.independence
        : secondary.independence,
    confidence,
    sources,
    source: sources[0].source,
    sourceUrl: primary.sourceUrl ?? secondary.sourceUrl,
  };
}

/**
 * Drop places a closure tombstone matches.
 *
 * A tombstone's coordinates may only be town-centre precise (a news article
 * rarely prints the address of the shop that closed), so the match radius is
 * generous and the name check does the discriminating.
 */
export function suppressClosed(
  places: Place[],
  closures: Closure[],
): { places: Place[]; suppressed: number } {
  if (!closures.length) return { places, suppressed: 0 };

  const kept = places.filter((place) => {
    const hit = closures.some(
      (closure) =>
        haversine(place.lat, place.lon, closure.lat, closure.lon) <=
          SAME_PLACE_METRES_FUZZY && namesMatch(place.name, closure.name),
    );
    return !hit;
  });

  return { places: kept, suppressed: places.length - kept.length };
}

export interface MergeResult {
  places: Place[];
  /** How many duplicate listings were folded away. */
  merged: number;
}

export function mergePlaces(input: Place[]): MergeResult {
  // Process richer sources first so they become the primary record.
  const ordered = [...input].sort(
    (a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source],
  );

  const kept: Place[] = [];
  let merged = 0;

  for (const candidate of ordered) {
    // A news lead may be geocoded only to the town centre, so allow it a wider
    // catchment when looking for the mapped record it probably refers to.
    const radius =
      candidate.confidence === "lead" ? SAME_PLACE_METRES_FUZZY : SAME_PLACE_METRES;

    const match = kept.find((existing) => {
      const gap = haversine(existing.lat, existing.lon, candidate.lat, candidate.lon);
      const limit =
        existing.confidence === "lead" ? SAME_PLACE_METRES_FUZZY : radius;
      return gap <= limit && namesMatch(existing.name, candidate.name);
    });

    if (match) {
      const index = kept.indexOf(match);
      kept[index] = combine(match, candidate);
      merged++;
    } else {
      kept.push(candidate);
    }
  }

  return { places: kept, merged };
}
