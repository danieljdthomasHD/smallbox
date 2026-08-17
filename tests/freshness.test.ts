import assert from "node:assert/strict";
import { test } from "vitest";

import { classify } from "@/lib/categories";
import { registryClosures } from "@/lib/closedRegistry";
import { toPlace } from "@/lib/overpass";
import { suppressClosed } from "@/lib/merge";
import type { Place } from "@/lib/types";

// Every rejection case here is a real listing that live Dayton, Ohio data
// served to a user looking for fresh food.

test("a corner store is not a grocer just because its name says Market", () => {
  assert.equal(classify({ name: "Bud's Corner Market", shop: "convenience" }), null);
  assert.equal(classify({ name: "Bee-Gee's Mini Market", shop: "convenience" }), null);
  assert.equal(classify({ name: "Dayton Marketplace", shop: "convenience" }), null);
});

test("convenience stores with real fresh-food signals stay", () => {
  assert.equal(classify({ name: "El Mercadito", shop: "convenience" }), "grocery");
  assert.equal(classify({ name: "Nablus Halal Market", shop: "convenience" }), "grocery");
  assert.equal(classify({ name: "Corner Shop", shop: "convenience", organic: "yes" }), "grocery");
});

test("liquor, carryout and gas names disqualify grocery-shaped shops", () => {
  assert.equal(classify({ name: "Exchange Home Store, Class Six", shop: "supermarket" }), null);
  assert.equal(classify({ name: "Miller's Drive-Thru Carryout", shop: "convenience" }), null);
  assert.equal(classify({ name: "Sunny's Wine & Beer Market", shop: "grocery" }), null);
});

test("the negative gate does not touch dedicated fresh-food formats", () => {
  // "Smoke" is a NOT_FRESH word, but a butcher is a butcher.
  assert.equal(classify({ name: "Smoke House Butchery", shop: "butcher" }), "butcher");
  assert.equal(classify({ name: "Vine & Fig Cheese", shop: "cheese" }), "dairy");
});

test("supplement shops tagged health_food are dropped; real food co-ops stay", () => {
  assert.equal(classify({ name: "Dayton Nutra Foods", shop: "health_food" }), null);
  assert.equal(classify({ name: "Health Foods Unlimited", shop: "health_food" }), null);
  assert.equal(classify({ name: "Community Food Co-op", shop: "health_food" }), "grocery");
});

// --- closed places ---------------------------------------------------------

function osmElement(tags: Record<string, string>) {
  return { type: "node" as const, id: 1, lat: 35.6, lon: -82.55, tags };
}

test("OSM lifecycle tags drop a place entirely", () => {
  const base = { name: "Old Larder", shop: "bakery" };
  assert.ok(toPlace(osmElement(base), 35.6, -82.55), "control: normal place kept");

  for (const closed of [
    { ...base, disused: "yes" },
    { ...base, "disused:shop": "bakery" },
    { ...base, opening_hours: "closed" },
    { ...base, name: "Old Larder (permanently closed)" },
    { ...base, end_date: "2020-01-01" },
  ]) {
    assert.equal(toPlace(osmElement(closed), 35.6, -82.55), null, JSON.stringify(closed));
  }
});

function place(name: string, lat: number, lon: number): Place {
  return {
    id: `osm:${name}`,
    name,
    category: "bakery",
    kind: "permanent",
    lat,
    lon,
    distance: 0,
    openState: "unknown",
    tags: {},
    independence: { score: 70, independent: true, reasons: [] },
    confidence: "verified",
    sources: [{ source: "osm" }],
    source: "osm",
  };
}

test("a closure tombstone suppresses the stale record of the same place", () => {
  const { places, suppressed } = suppressClosed(
    [place("Riverside Bakery", 39.759, -84.19), place("Hilltop Butcher", 39.76, -84.2)],
    [{ name: "Riverside Bakery", lat: 39.7592, lon: -84.1905, source: "google" }],
  );
  assert.equal(suppressed, 1);
  assert.deepEqual(places.map((p) => p.name), ["Hilltop Butcher"]);
});

test("prose closure notes in OSM tags drop a place", () => {
  const base = { name: "Old Larder", shop: "bakery" };
  for (const closed of [
    { ...base, note: "Permanently closed as of May" },
    { ...base, description: "This shop has closed." },
    { ...base, name: "Old Larder - CLOSED" },
    { ...base, name: "Old Larder (out of business)" },
  ]) {
    assert.equal(toPlace(osmElement(closed), 35.6, -82.55), null, JSON.stringify(closed));
  }

  // Hours prose must not be mistaken for a closure.
  for (const open of [
    { ...base, note: "Closed on Sundays" },
    { ...base, description: "Closed for renovation until spring" },
  ]) {
    assert.ok(toPlace(osmElement(open), 35.6, -82.55), JSON.stringify(open));
  }
});

test("the curated closure registry takes down a stale OSM record", () => {
  // Real case: Dee Felice Market in Covington, KY closed May 2026, but OSM
  // way/141875153 still maps it as a live marketplace with no closure tags.
  const { places, suppressed } = suppressClosed(
    [
      place("Dee Felice Market", 39.0845368, -84.5177472),
      place("Findlay Market", 39.1153, -84.5187),
    ],
    registryClosures(),
  );
  assert.equal(suppressed, 1);
  assert.deepEqual(places.map((p) => p.name), ["Findlay Market"]);
});

test("a tombstone doesn't reach a same-name place across town", () => {
  const { suppressed } = suppressClosed(
    [place("Community Market", 39.85, -84.1)],
    [{ name: "Community Market", lat: 39.75, lon: -84.2, source: "news" }],
  );
  assert.equal(suppressed, 0);
});

test("a honey shop tagged health_food is food, not supplements", () => {
  // Live Asheville data: The Bee Charmer, shop=health_food.
  assert.equal(classify({ name: "The Bee Charmer", shop: "health_food" }), "grocery");
});
