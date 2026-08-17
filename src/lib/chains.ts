import type { IndependenceVerdict } from "./types";

/**
 * Deciding "is this place independently owned?" from OSM tags.
 *
 * There is no dataset field for ownership, so we combine three signals:
 *
 *  1. Brand tags. Mappers add `brand:wikidata` / `brand` almost exclusively to
 *     chain locations, because the whole point of those tags is to link many
 *     branches to one brand. This is the strongest and most general signal, and
 *     it works worldwide without us maintaining a list.
 *  2. A name denylist, for chains that are mapped without brand tags.
 *  3. Positive signals (organic, farm shop, local produce) that push a place up.
 *
 * Every deduction is recorded in `reasons` so the UI can explain the verdict
 * instead of silently hiding somebody's shop.
 */

/**
 * Unambiguous brand fragments. These are matched anywhere in the name because
 * no independent shop is plausibly called "Trader Joe's Fruit Stand".
 */
const CHAIN_SUBSTRINGS: string[] = [
  "walmart",
  "wal mart",
  "sams club",
  "costco",
  "trader joes",
  "whole foods",
  "whole food market",
  "kroger",
  "safeway",
  "albertsons",
  "jewel osco",
  "publix",
  "wegmans",
  "heb",
  "h e b",
  "meijer",
  "hy vee",
  "winn dixie",
  "food lion",
  "giant eagle",
  "stop and shop",
  "stop shop",
  "hannaford",
  "price chopper",
  "market basket",
  "shoprite",
  "piggly wiggly",
  "save a lot",
  "grocery outlet",
  "winco",
  "food 4 less",
  "smart and final",
  "sprouts farmers market",
  "natural grocers",
  "the fresh market",
  "fresh thyme",
  "harris teeter",
  "king soopers",
  "fred meyer",
  "dillons",
  "tom thumb",
  "star market",
  "raleys",
  "stater bros",
  "vallarta supermarket",
  "cardenas market",
  "el super",
  "99 ranch",
  "h mart",
  "hmart",
  "patel brothers",
  "seafood city",
  "aldi",
  "lidl",
  "seven eleven",
  "7 eleven",
  "circle k",
  "quiktrip",
  "kwik trip",
  "caseys general",
  "dollar general",
  "dollar tree",
  "family dollar",
  "cvs",
  "walgreens",
  "rite aid",
  "panera",
  "great harvest",
  "nothing bundt",
  "crumbl",
  "paris baguette",
  "insomnia cookies",
  "cinnabon",
  "dunkin",
  "krispy kreme",
  "einstein bros",
  "corner bakery",
  "porto s bakery",
  "omaha steaks",
  "butcher box",
  "tesco",
  "sainsburys",
  "morrisons",
  "waitrose",
  "asda",
  "co op food",
  "marks and spencer",
  "carrefour",
  "auchan",
  "intermarche",
  "leclerc",
  "rewe",
  "edeka",
  "kaufland",
  "netto marken",
  "penny markt",
  "loblaws",
  "sobeys",
  "no frills",
  "food basics",
  "metro plus",
  "iga express",
  "woolworths",
  "coles supermarket",
  "earth fare",
  "chicken salad chick",
  "western beef",
  "associated supermarket",
  "shop fair",
  "met fresh",
  "foodtown",
  "food bazaar",
  "key food",
  "c town",
  "ctown",
  "bravo supermarket",
  "fine fare",
  "pioneer supermarket",
  "gristedes",
  "morton williams",
  "dagostino",
  "compare foods",
  "la michoacana meat",
  "fiesta mart",
  "sedanos",
  "presidente supermarket",
  "bravo cost plus",
  "united supermarkets",
  "brookshire",
  "united grocery outlet",
  "cash saver",
  "piggly",
  "big lots",
  "five below",
  "bj s wholesale",
  "bjs wholesale",
  "rural king",
  "tractor supply",
  "family farm and home",
  "atwoods",
  "orscheln",
  "wilco farm",
  "gnc",
  "vitamin shoppe",
];

/**
 * Names that are only a chain when they *are* the whole name (plus a generic
 * suffix). "Giant" is a supermarket chain; "Giant Peach Produce" is not.
 */
const CHAIN_EXACT: string[] = [
  "target",
  "giant",
  "giant food",
  "acme",
  "vons",
  "shaws",
  "randalls",
  "qfc",
  "frys",
  "smiths",
  "weis",
  "ingles",
  "sprouts",
  "lucky",
  "food city",
  "wawa",
  "sheetz",
  "speedway",
  // Fuel brands: their marts occasionally arrive typed as grocery stores
  // (live Dayton, KY data: a Marathon station typed grocery_store). Exact
  // matching keeps "Marathon Bakery" or "Sea Shell Seafood" safe.
  "marathon",
  "shell",
  "bp",
  "exxon",
  "mobil",
  "chevron",
  "texaco",
  "citgo",
  "sunoco",
  "valero",
  "phillips 66",
  "murphy usa",
  "getgo",
  "racetrac",
  "thorntons",
  "ampm",
  "united dairy farmers",
  "udf",
  "spar",
  "iga",
  "citarella",
  "eataly",
];

/** Generic words that may trail a chain name without changing what it is. */
const GENERIC_SUFFIX =
  /^(supercenter|super center|superstore|supermarket|super market|market|markets|marketplace|grocery|groceries|store|stores|foods|food|food store|pharmacy|fuel|gas|express|neighborhood market|neighbourhood market|extra|plus|no \d+|#?\d+)$/;

/** Strip accents, punctuation and case so "Piggly-Wiggly #23" == "piggly wiggly". */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesExactChain(normalized: string): string | undefined {
  for (const chain of CHAIN_EXACT) {
    if (normalized === chain) return chain;
    if (normalized.startsWith(chain + " ")) {
      const rest = normalized.slice(chain.length + 1).trim();
      // Allow one or two generic trailing words, e.g. "target grocery".
      const words = rest.split(" ");
      if (words.length <= 2 && GENERIC_SUFFIX.test(rest)) return chain;
    }
  }
  return undefined;
}

function matchesSubstringChain(normalized: string): string | undefined {
  const padded = ` ${normalized} `;
  for (const chain of CHAIN_SUBSTRINGS) {
    // Space-padded match on both sides = whole-word only, so "Aldine Grocery"
    // is not mistaken for "Aldi".
    if (padded.includes(` ${chain} `)) return chain;
  }
  return undefined;
}

/** Titlecase a normalized chain key for display. */
function pretty(chain: string): string {
  return chain.replace(/\b\w/g, (c) => c.toUpperCase());
}

const INDEPENDENT_THRESHOLD = 50;

export function assessIndependence(
  tags: Record<string, string>,
): IndependenceVerdict {
  const reasons: string[] = [];
  let score = 70;
  let chainName: string | undefined;
  let definitive = false;

  const name = tags.name ?? "";
  const normalized = normalizeName(name);

  // --- Chain signals -------------------------------------------------------

  // `brand:wikidata` links this location to a brand entity. Independents don't
  // have one, so this is close to a definitive answer.
  if (tags["brand:wikidata"]) {
    score -= 70;
    chainName = tags.brand ?? tags["brand:wikidata"];
    definitive = true;
    reasons.push(`Tagged as part of the "${chainName}" brand in OpenStreetMap`);
  } else if (tags.brand) {
    score -= 55;
    chainName = tags.brand;
    definitive = true;
    reasons.push(`Carries the brand "${tags.brand}"`);
  }

  const nameMatch = matchesSubstringChain(normalized) ?? matchesExactChain(normalized);
  if (nameMatch) {
    score -= 70;
    chainName = chainName ?? pretty(nameMatch);
    definitive = true;
    reasons.push(`Name matches the known chain "${pretty(nameMatch)}"`);
  }

  // Operators are usually only filled in for franchises and municipal markets.
  // Only penalise when it clearly isn't the shop's own name.
  const operator = tags.operator ? normalizeName(tags.operator) : "";
  if (operator && operator !== normalized) {
    const operatorMatch =
      matchesSubstringChain(operator) ?? matchesExactChain(operator);
    if (operatorMatch) {
      score -= 60;
      chainName = chainName ?? pretty(operatorMatch);
      definitive = true;
      reasons.push(`Operated by "${tags.operator}"`);
    }
  }

  if (tags["operator:type"] === "chain" || tags.franchise === "yes") {
    score -= 50;
    definitive = true;
    reasons.push("Tagged as a franchise or chain location");
  }

  if (tags.wholesale === "yes" || tags.shop === "wholesale") {
    score -= 30;
    reasons.push("Wholesale / warehouse format");
  }

  // A supermarket with no brand tag is usually a neighbourhood store, but it's
  // the format most likely to be big-box, so give it a nudge downward.
  if (tags.shop === "supermarket" && !chainName) {
    score -= 10;
    reasons.push("Supermarket format — verify before trusting");
  }

  // --- Independence signals ------------------------------------------------

  if (!tags.brand && !tags["brand:wikidata"] && !nameMatch) {
    score += 15;
    reasons.push("No brand or chain tags");
  }

  if (tags.organic === "yes" || tags.organic === "only") {
    score += 10;
    reasons.push("Sells organic produce");
  }

  if (tags["origin"] === "local" || tags["produce"]) {
    score += 8;
    reasons.push("Lists its own produce");
  }

  if (tags.shop === "farm" || tags.amenity === "marketplace") {
    score += 15;
    reasons.push("Farm shop or open-air market");
  }

  if (tags["second_hand"] === "no") score += 2;

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    independent: score >= INDEPENDENT_THRESHOLD,
    reasons,
    chainName,
    // Only meaningful for a negative verdict.
    definitive: definitive && score < INDEPENDENT_THRESHOLD,
  };
}

export const INDEPENDENCE_THRESHOLD = INDEPENDENT_THRESHOLD;

/**
 * Catch chains the denylist has never heard of.
 *
 * A name that shows up at three or more separate addresses inside one search
 * area is, by definition, a chain — no list maintenance required, and it works
 * in any country. The penalty is deliberately mild: a family bakery with three
 * shops across town should still make the cut, while a 20-store regional
 * supermarket that was already borderline drops out.
 */
export function penalizeRepeatedNames(
  items: { name: string; independence: IndependenceVerdict }[],
  minOccurrences = 3,
  penalty = 30,
): void {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = normalizeName(item.name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const item of items) {
    const key = normalizeName(item.name);
    const count = counts.get(key) ?? 0;
    if (count < minOccurrences) continue;

    const verdict = item.independence;
    verdict.score = Math.max(0, verdict.score - penalty);
    verdict.independent = verdict.score >= INDEPENDENT_THRESHOLD;
    verdict.reasons.push(
      `${count} locations with this name nearby — looks like a local chain`,
    );
  }
}
