import type { Place, SourceId } from "../types";

export interface ProviderQuery {
  lat: number;
  lon: number;
  /** Search radius in metres. */
  radius: number;
  /**
   * A human place name for the search area ("Asheville, North Carolina").
   * Text sources need this — you can't query a newspaper by bounding box.
   */
  areaName?: string;
  signal?: AbortSignal;
}

export interface ProviderResult {
  places: Place[];
  /** Set when the provider ran but something went wrong or was skipped. */
  note?: string;
}

export interface Provider {
  id: SourceId;
  label: string;
  /** False when the provider needs a key that isn't configured. */
  isEnabled(): boolean;
  /** Why it's off, shown in the UI. */
  disabledReason(): string | undefined;
  fetch(query: ProviderQuery): Promise<ProviderResult>;
}

/** Every provider hands back partial places; this fills in the shared defaults. */
export function emptyResult(note?: string): ProviderResult {
  return { places: [], note };
}
