import type { Place, SourceId, SourceStatus } from "../types";
import { communityProvider } from "./community";
import { eventsProvider } from "./events";
import { googleProvider } from "./google";
import { newsProvider } from "./news";
import { osmProvider } from "./osm";
import type { Provider, ProviderQuery } from "./types";
import { usdaProvider } from "./usda";

/**
 * Every source, run together.
 *
 * Ordering here is presentation only — the merge step decides which record wins
 * when two sources describe the same place. Providers run in parallel and are
 * independently allowed to fail: a dead newspaper feed must never cost you the
 * OpenStreetMap results, so a rejected provider becomes a note, not an error.
 */
export const PROVIDERS: Provider[] = [
  osmProvider,
  communityProvider,
  usdaProvider,
  googleProvider,
  newsProvider,
  eventsProvider,
];

export const PROVIDERS_BY_ID = new Map<SourceId, Provider>(
  PROVIDERS.map((p) => [p.id, p]),
);

export interface GatherResult {
  places: Place[];
  statuses: SourceStatus[];
}

/**
 * Slow sources shouldn't hold up the whole search. News and event extraction
 * involve several network hops plus a model call, so the gather is bounded and
 * whatever hasn't answered is reported as timed out.
 */
const OVERALL_TIMEOUT_MS = 55_000;

export async function gather(
  query: ProviderQuery,
  only?: Set<SourceId>,
): Promise<GatherResult> {
  const selected = PROVIDERS.filter((p) => !only || only.has(p.id));

  const budget = AbortSignal.timeout(OVERALL_TIMEOUT_MS);
  const signal = query.signal
    ? AbortSignal.any([query.signal, budget])
    : budget;

  const settled = await Promise.allSettled(
    selected.map(async (provider) => {
      if (!provider.isEnabled()) {
        return {
          provider,
          result: { places: [], note: provider.disabledReason() },
        };
      }
      return { provider, result: await provider.fetch({ ...query, signal }) };
    }),
  );

  const places: Place[] = [];
  const statuses: SourceStatus[] = [];

  settled.forEach((outcome, index) => {
    const provider = selected[index];

    if (outcome.status === "rejected") {
      const reason = outcome.reason;
      statuses.push({
        source: provider.id,
        enabled: provider.isEnabled(),
        found: 0,
        note:
          reason instanceof Error
            ? reason.name === "TimeoutError" || reason.name === "AbortError"
              ? "Timed out."
              : reason.message
            : String(reason),
      });
      return;
    }

    const { result } = outcome.value;
    places.push(...result.places);
    statuses.push({
      source: provider.id,
      enabled: provider.isEnabled(),
      found: result.places.length,
      note: result.note,
    });
  });

  return { places, statuses };
}
