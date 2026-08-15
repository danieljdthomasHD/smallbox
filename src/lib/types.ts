export type CategoryId =
  | "farmers_market"
  | "farm_stand"
  | "produce"
  | "butcher"
  | "seafood"
  | "bakery"
  | "dairy"
  | "grocery";

export type SourceId = "osm" | "usda" | "google" | "news" | "events" | "community";

/**
 * A permanent shop keeps regular hours; a popup exists on specific dates only
 * (a market that runs three Saturdays in August, a festival with a produce row).
 * The distinction changes what the UI must show — dates instead of hours — so it
 * lives on the record rather than being inferred.
 */
export type PlaceKind = "permanent" | "popup";

/** One dated occurrence of a popup, in ISO-8601. */
export interface Occurrence {
  start: string;
  end?: string;
  /** e.g. "Saturdays through October" — the human phrasing we derived this from. */
  note?: string;
}

/** Where one piece of a merged listing came from. */
export interface SourceRef {
  source: SourceId;
  /** The source's own identifier, e.g. "node/123456". */
  ref?: string;
  url?: string;
  /** Publication or listing title, for news and event sources. */
  title?: string;
  /** ISO date the source published or last updated this. */
  retrievedAt?: string;
}

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

/**
 * How much we trust that this place exists as described.
 *
 * Mapped and directory data is `verified`; a place mentioned in a news article
 * but never confirmed against a map is a `lead` — worth showing, clearly
 * labelled, never presented as fact.
 */
export type Confidence = "verified" | "reported" | "lead";

export interface Place {
  /** Stable id, e.g. "osm:node/123456". */
  id: string;
  name: string;
  category: CategoryId;
  kind: PlaceKind;
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
  /** Dated occurrences, for popups and seasonal markets. */
  occurrences?: Occurrence[];
  /** Free-text description, e.g. the sentence a news article used. */
  description?: string;
  /** Tags worth surfacing, e.g. payment or produce detail. */
  tags: Record<string, string>;
  independence: IndependenceVerdict;
  confidence: Confidence;
  /** Every source that contributed to this record, primary first. */
  sources: SourceRef[];
  /** Convenience accessor for `sources[0].source`. */
  source: SourceId;
  sourceUrl?: string;
}

export interface SourceStatus {
  source: SourceId;
  /** False when the provider has no API key or is switched off. */
  enabled: boolean;
  /** How many listings it contributed before merging. */
  found: number;
  /** Set when the provider failed or was skipped. */
  note?: string;
}

export interface PlacesResponse {
  center: { lat: number; lon: number };
  radius: number;
  count: number;
  /** How many results were filtered out as chains, for transparency. */
  chainsFiltered: number;
  places: Place[];
  /** Per-source reporting so it's obvious what did and didn't run. */
  sources: SourceStatus[];
  attribution: string;
  warnings?: string[];
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  type?: string;
}

/** A place someone submitted or corrected through the app. */
export interface Submission {
  id: number;
  name: string;
  category: CategoryId;
  kind: PlaceKind;
  lat: number;
  lon: number;
  address?: string;
  website?: string;
  phone?: string;
  openingHours?: string;
  description?: string;
  /** Set when this submission corrects an existing listing. */
  correctsPlaceId?: string;
  /** "independent" | "chain" | "closed" | "new" */
  kindOfReport: "new" | "independent" | "chain" | "closed";
  createdAt: string;
  /** Submissions appear in results once approved, or immediately if moderation is off. */
  approved: boolean;
}
