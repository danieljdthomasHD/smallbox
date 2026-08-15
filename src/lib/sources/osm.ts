import { elementsToPlaces, fetchOverpass } from "../overpass";
import { emptyResult, type Provider, type ProviderQuery, type ProviderResult } from "./types";

/**
 * OpenStreetMap via Overpass — the backbone of the app.
 *
 * Free, global, no key, and the only source that carries the brand tags the
 * chain filter leans on. Everything else here is enrichment on top of this.
 */
export const osmProvider: Provider = {
  id: "osm",
  label: "OpenStreetMap",

  isEnabled() {
    return true;
  },

  disabledReason() {
    return undefined;
  },

  async fetch({ lat, lon, radius }: ProviderQuery): Promise<ProviderResult> {
    try {
      const { elements, warnings } = await fetchOverpass(lat, lon, radius);
      return {
        places: elementsToPlaces(elements, lat, lon),
        note: warnings.length
          ? `Fell back after ${warnings.length} mirror failure(s).`
          : undefined,
      };
    } catch (error) {
      return emptyResult(
        error instanceof Error ? error.message : "Overpass unavailable.",
      );
    }
  },
};
