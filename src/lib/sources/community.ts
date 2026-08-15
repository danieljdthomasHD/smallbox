import { assessIndependence } from "../chains";
import { findSubmissionsNear, isStoreAvailable, storeUnavailableReason } from "../db";
import { haversine } from "../geo";
import { evaluateHours } from "../hours";
import type { Place } from "../types";
import { emptyResult, type Provider, type ProviderQuery, type ProviderResult } from "./types";

/**
 * Places people added through the app.
 *
 * This is the only source that improves with use, and the only one that can fix
 * what the others get wrong — so a human submission outranks every automated
 * source in the merge step.
 */

export const communityProvider: Provider = {
  id: "community",
  label: "Community submissions",

  isEnabled() {
    return isStoreAvailable();
  },

  disabledReason() {
    if (this.isEnabled()) return undefined;
    const reason = storeUnavailableReason();
    return reason
      ? `Submissions database unavailable (${reason}).`
      : "Submissions database unavailable.";
  },

  async fetch({ lat, lon, radius }: ProviderQuery): Promise<ProviderResult> {
    if (!this.isEnabled()) return emptyResult(this.disabledReason());

    const submissions = findSubmissionsNear(lat, lon, radius);
    const places: Place[] = [];

    for (const entry of submissions) {
      const distance = haversine(lat, lon, entry.lat, entry.lon);
      // The bounding-box query is deliberately loose; enforce the real radius here.
      if (distance > radius) continue;

      const independence = assessIndependence({
        name: entry.name,
        ...(entry.kind === "popup" ? { amenity: "marketplace" } : {}),
      });
      independence.reasons.push("Added by someone using this app");

      places.push({
        id: `community:${entry.id}`,
        name: entry.name,
        category: entry.category,
        kind: entry.kind,
        lat: entry.lat,
        lon: entry.lon,
        distance,
        address: entry.address,
        phone: entry.phone,
        website: entry.website,
        openingHours: entry.openingHours,
        openState: evaluateHours(entry.openingHours),
        description: entry.description,
        tags: {},
        independence,
        confidence: "reported",
        sources: [
          {
            source: "community",
            ref: String(entry.id),
            retrievedAt: entry.createdAt,
          },
        ],
        source: "community",
      });
    }

    return { places };
  },
};
