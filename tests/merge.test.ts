import assert from "node:assert/strict";
import { test } from "vitest";

import { mergePlaces } from "@/lib/merge";
import type { CategoryId, Confidence, Place, PlaceKind, SourceId } from "@/lib/types";

function place(
  name: string,
  source: SourceId,
  lat: number,
  lon: number,
  extra: Partial<Place> = {},
): Place {
  return {
    id: `${source}:${name}`,
    name,
    category: "farmers_market" as CategoryId,
    kind: "permanent" as PlaceKind,
    lat,
    lon,
    distance: 0,
    openState: "unknown",
    tags: {},
    independence: { score: 70, independent: true, reasons: [] },
    confidence: "verified" as Confidence,
    sources: [{ source }],
    source,
    ...extra,
  };
}

test("the same market from two sources becomes one place", () => {
  const { places, merged } = mergePlaces([
    place("River Arts District Farmers Market", "osm", 35.58, -82.56),
    place("River Arts District Farmers Market", "usda", 35.5801, -82.5601),
  ]);

  assert.equal(places.length, 1);
  assert.equal(merged, 1);
  assert.deepEqual(
    places[0].sources.map((s) => s.source).sort(),
    ["osm", "usda"],
  );
});

test("filler words don't prevent a match", () => {
  const { places } = mergePlaces([
    place("Asheville City Market", "osm", 35.6, -82.55),
    place("The Asheville City Farmers Market", "google", 35.6001, -82.5501),
  ]);
  assert.equal(places.length, 1);
});

test("different markets at the same address stay separate", () => {
  const { places } = mergePlaces([
    place("Hollow Creek Stand", "osm", 35.6, -82.55),
    place("Pinebrook Creamery", "osm", 35.6, -82.55),
  ]);
  assert.equal(places.length, 2);
});

test("same name far apart stays separate", () => {
  const { places } = mergePlaces([
    place("Community Market", "osm", 35.6, -82.55),
    place("Community Market", "osm", 35.9, -82.9),
  ]);
  assert.equal(places.length, 2);
});

test("the richer source becomes the primary record", () => {
  const { places } = mergePlaces([
    place("West End Market", "news", 35.6, -82.55, { confidence: "lead" }),
    place("West End Market", "osm", 35.6, -82.55, {
      address: "12 Haywood Road",
      website: "https://example.com",
    }),
  ]);

  assert.equal(places.length, 1);
  // OSM outranks news, so its id and address win...
  assert.equal(places[0].source, "osm");
  assert.equal(places[0].address, "12 Haywood Road");
  // ...and the news mention no longer stands alone as an unverified lead.
  assert.equal(places[0].confidence, "verified");
});

test("a news lead corroborated by another lead is upgraded to reported", () => {
  const { places } = mergePlaces([
    place("Pop-Up Produce Row", "news", 35.6, -82.55, { confidence: "lead" }),
    place("Pop-Up Produce Row", "events", 35.6005, -82.5505, { confidence: "lead" }),
  ]);

  assert.equal(places.length, 1);
  assert.equal(places[0].confidence, "reported");
});

test("a lone news lead stays a lead", () => {
  const { places } = mergePlaces([
    place("Rumoured Saturday Market", "news", 35.6, -82.55, { confidence: "lead" }),
  ]);
  assert.equal(places[0].confidence, "lead");
});

test("popup dates survive a merge with a permanent record", () => {
  const { places } = mergePlaces([
    place("Harvest Market", "osm", 35.6, -82.55),
    place("Harvest Market", "events", 35.6, -82.55, {
      kind: "popup",
      confidence: "lead",
      occurrences: [{ start: "2026-09-12", note: "Second Saturday" }],
    }),
  ]);

  assert.equal(places.length, 1);
  // A mapped, permanently-sited market that also runs dated events is still a
  // permanent place — but the dates are worth keeping.
  assert.equal(places[0].kind, "permanent");
  assert.equal(places[0].occurrences?.length, 1);
});

test("duplicate occurrences are collapsed and sorted", () => {
  const { places } = mergePlaces([
    place("Twice Listed", "news", 35.6, -82.55, {
      confidence: "lead",
      occurrences: [{ start: "2026-09-20" }, { start: "2026-09-06" }],
    }),
    place("Twice Listed", "events", 35.6, -82.55, {
      confidence: "lead",
      occurrences: [{ start: "2026-09-06" }, { start: "2026-09-13" }],
    }),
  ]);

  assert.deepEqual(
    places[0].occurrences?.map((o) => o.start),
    ["2026-09-06", "2026-09-13", "2026-09-20"],
  );
});

test("a community record outranks everything automated", () => {
  const { places } = mergePlaces([
    place("Corrected Grocer", "osm", 35.6, -82.55, { address: "old address" }),
    place("Corrected Grocer", "community", 35.6, -82.55, { address: "12 New Street" }),
  ]);

  assert.equal(places[0].source, "community");
  assert.equal(places[0].address, "12 New Street");
});

test("the more decisive independence verdict survives", () => {
  const { places } = mergePlaces([
    place("Big Name Foods", "osm", 35.6, -82.55, {
      independence: {
        score: 0,
        independent: false,
        reasons: ["Tagged as a brand"],
        chainName: "Big Name",
      },
    }),
    place("Big Name Foods", "google", 35.6, -82.55, {
      independence: { score: 70, independent: true, reasons: [] },
    }),
  ]);

  assert.equal(places[0].independence.independent, false);
  assert.equal(places[0].independence.chainName, "Big Name");
});

test("merging is stable when nothing matches", () => {
  const input = [
    place("A Market", "osm", 35.60, -82.55),
    place("B Butcher", "osm", 35.61, -82.56),
    place("C Bakery", "osm", 35.62, -82.57),
  ];
  const { places, merged } = mergePlaces(input);
  assert.equal(places.length, 3);
  assert.equal(merged, 0);
});
