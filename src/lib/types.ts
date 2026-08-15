export type CategoryId =
  | "farmers_market"
  | "farm_stand"
  | "produce"
  | "butcher"
  | "seafood"
  | "bakery"
  | "dairy"
  | "grocery";

/** Why we think a place is (or isn't) independently owned. */
export interface IndependenceVerdict {
  /** 0-100. Higher means more likely to be a small, independently owned business. */
  score: number;
  /** True when we're confident enough to show it by default. */
  independent: boolean;
  /** Human-readable reasons, shown in the UI so the judgement is auditable. */
  reasons: string[];
  /** Set when we matched a known chain or big-box brand. */
  chainName?: string;
}

export type OpenState = "open" | "closed" | "unknown";

export interface Place {
  /** Stable id, e.g. "osm:node/123456". */
  id: string;
  name: string;
  category: CategoryId;
  lat: number;
  lon: number;
  /** Metres from the search centre. */
  distance: number;
  address?: string;
  phone?: string;
  website?: string;
  openingHours?: string;
  openState: OpenState;
  organic?: boolean;
  /** OSM tags worth surfacing, e.g. payment or produce detail. */
  tags: Record<string, string>;
  independence: IndependenceVerdict;
  source: "osm" | "usda";
  sourceUrl?: string;
}

export interface PlacesResponse {
  center: { lat: number; lon: number };
  radius: number;
  count: number;
  /** How many results were filtered out as chains, for transparency. */
  chainsFiltered: number;
  places: Place[];
  attribution: string;
  warnings?: string[];
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  type?: string;
}
