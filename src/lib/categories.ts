import type { CategoryId } from "./types";

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /** Singular form for use on a single result, e.g. "Butcher". */
  singular: string;
  /** Short blurb used in the filter UI. */
  blurb: string;
  emoji: string;
  /** Marker / chip colour. */
  color: string;
  /** Order in the filter bar and the map z-stack. */
  order: number;
}

export const CATEGORIES: Record<CategoryId, CategoryDef> = {
  farmers_market: {
    id: "farmers_market",
    label: "Farmers markets",
    singular: "Farmers market",
    blurb: "Open-air and community markets",
    emoji: "🧺",
    color: "#16a34a",
    order: 0,
  },
  farm_stand: {
    id: "farm_stand",
    label: "Farm stands",
    singular: "Farm stand",
    blurb: "Farm shops, u-pick and roadside stands",
    emoji: "🌾",
    color: "#ca8a04",
    order: 1,
  },
  produce: {
    id: "produce",
    label: "Produce",
    singular: "Produce shop",
    blurb: "Greengrocers and fruit & veg stores",
    emoji: "🍎",
    color: "#dc2626",
    order: 2,
  },
  butcher: {
    id: "butcher",
    label: "Butchers",
    singular: "Butcher",
    blurb: "Independent meat counters",
    emoji: "🥩",
    color: "#be123c",
    order: 3,
  },
  seafood: {
    id: "seafood",
    label: "Fishmongers",
    singular: "Fishmonger",
    blurb: "Fresh fish and seafood",
    emoji: "🐟",
    color: "#0891b2",
    order: 4,
  },
  bakery: {
    id: "bakery",
    label: "Bakeries",
    singular: "Bakery",
    blurb: "Bread and pastry, baked on site",
    emoji: "🥖",
    color: "#b45309",
    order: 5,
  },
  dairy: {
    id: "dairy",
    label: "Cheese & dairy",
    singular: "Cheese & dairy",
    blurb: "Cheesemongers and creameries",
    emoji: "🧀",
    color: "#d97706",
    order: 6,
  },
  grocery: {
    id: "grocery",
    label: "Corner grocers",
    singular: "Corner grocer",
    blurb: "Small independent food stores and delis",
    emoji: "🛒",
    color: "#7c3aed",
    order: 7,
  },
};

export const CATEGORY_LIST: CategoryDef[] = Object.values(CATEGORIES).sort(
  (a, b) => a.order - b.order,
);

export function isCategoryId(value: string): value is CategoryId {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, value);
}

/**
 * OSM `shop=*` values we care about, mapped to our categories. Anything not in
 * here is ignored, which is what keeps restaurants, cafes and clothing shops out.
 */
const SHOP_TO_CATEGORY: Record<string, CategoryId> = {
  farm: "farm_stand",
  greengrocer: "produce",
  fruit: "produce",
  vegetables: "produce",
  butcher: "butcher",
  seafood: "seafood",
  fishmonger: "seafood",
  bakery: "bakery",
  pastry: "bakery",
  cheese: "dairy",
  dairy: "dairy",
  grocery: "grocery",
  supermarket: "grocery",
  convenience: "grocery",
  deli: "grocery",
  health_food: "grocery",
  food: "grocery",
  general: "grocery",
  honey: "farm_stand",
  spices: "grocery",
};

/** The `shop=*` values sent to Overpass, derived from the map above. */
export const SHOP_VALUES = Object.keys(SHOP_TO_CATEGORY);

/**
 * Decide which of our categories an OSM element belongs to, or null to drop it.
 *
 * Order matters: an element tagged both `amenity=marketplace` and `shop=farm`
 * is a farmers market first.
 */
export function classify(tags: Record<string, string>): CategoryId | null {
  const name = (tags.name ?? "").toLowerCase();

  if (tags.amenity === "marketplace") {
    // Plenty of marketplaces are flea markets or general bazaars. Keep the ones
    // that sell food, and treat an unqualified marketplace as a farmers market
    // only when the name says so.
    if (
      /farmer|farmers|growers|produce|green ?market|market garden|food market|harvest/.test(
        name,
      )
    ) {
      return "farmers_market";
    }
    if (tags.marketplace === "farmers" || tags.produce || tags.organic) {
      return "farmers_market";
    }
    if (/flea|antique|craft|swap|night market|christmas/.test(name)) return null;
    return "farmers_market";
  }

  // Some farmers markets are tagged as an event/place rather than an amenity.
  if (tags.shop === "farm" && /farmers|farmer's|growers/.test(name)) {
    return "farmers_market";
  }

  const shop = tags.shop;
  if (shop && shop in SHOP_TO_CATEGORY) {
    // A "convenience" store only counts if there's a sign it sells fresh food —
    // otherwise every gas station in the county shows up.
    if (shop === "convenience") {
      const sellsFresh =
        tags.organic === "yes" ||
        tags.organic === "only" ||
        Boolean(tags["produce"]) ||
        /grocer|produce|market|fresh|fruit|veg|farm|carniceria|fruteria|bodega/.test(
          name,
        );
      if (!sellsFresh) return null;
    }
    return SHOP_TO_CATEGORY[shop];
  }

  return null;
}
