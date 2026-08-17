import assert from "node:assert/strict";
import { test } from "vitest";

import { assessIndependence, normalizeName, penalizeRepeatedNames } from "@/lib/chains";

function verdict(tags: Record<string, string>) {
  return assessIndependence(tags);
}

test("normalizeName folds punctuation, accents and case", () => {
  assert.equal(normalizeName("Piggly-Wiggly #23"), "piggly wiggly 23");
  assert.equal(normalizeName("Trader Joe's"), "trader joes");
  assert.equal(normalizeName("Café Périgord"), "cafe perigord");
  assert.equal(normalizeName("Ben & Jerry"), "ben and jerry");
});

test("brand:wikidata alone is enough to call something a chain", () => {
  const v = verdict({
    name: "Some Local-Sounding Grocery",
    shop: "supermarket",
    "brand:wikidata": "Q123456",
    brand: "MegaMart",
  });
  assert.equal(v.independent, false);
  assert.equal(v.chainName, "MegaMart");
});

test("known big-box names are rejected even without brand tags", () => {
  for (const name of [
    "Walmart Supercenter",
    "Whole Foods Market",
    "Trader Joe's",
    "ALDI",
    "Costco Wholesale",
    "Dollar General",
    "7-Eleven",
  ]) {
    const v = verdict({ name, shop: "supermarket" });
    assert.equal(v.independent, false, `${name} should be filtered out`);
  }
});

test("independent shops are kept", () => {
  for (const [name, shop] of [
    ["The Chop Shop Butchery", "butcher"],
    ["Old Europe Pastries", "bakery"],
    ["French Broad Food Co-op", "grocery"],
    ["Carniceria La Esperanza", "butcher"],
    ["Tienda Mexicana", "grocery"],
    ["South Slope Cheese Company", "cheese"],
  ] as const) {
    const v = verdict({ name, shop });
    assert.equal(v.independent, true, `${name} should be kept`);
  }
});

test("a chain word inside a longer independent name is not a match", () => {
  // "Giant" is a chain; "Giant Peach Produce" is a greengrocer.
  assert.equal(verdict({ name: "Giant Peach Produce", shop: "greengrocer" }).independent, true);
  // "Aldi" must not match "Aldine".
  assert.equal(verdict({ name: "Aldine Grocery", shop: "grocery" }).independent, true);
  // But the bare chain name, with a generic suffix, is still caught.
  assert.equal(verdict({ name: "Giant Food", shop: "supermarket" }).independent, false);
});

test("community food co-ops are not mistaken for the UK Co-op chain", () => {
  assert.equal(verdict({ name: "Community Food Co-op", shop: "grocery" }).independent, true);
  assert.equal(verdict({ name: "Co-op Food", shop: "supermarket" }).independent, false);
});

test("farm shops and markets score highly", () => {
  const v = verdict({ name: "River Arts District Farmers Market", amenity: "marketplace" });
  assert.equal(v.independent, true);
  assert.ok(v.score >= 85, `expected a high score, got ${v.score}`);
});

test("every verdict explains itself", () => {
  const v = verdict({ name: "Walmart", shop: "supermarket", "brand:wikidata": "Q483551" });
  assert.ok(v.reasons.length > 0);
  assert.ok(v.reasons.some((r) => r.toLowerCase().includes("brand")));
});

test("repeated names in one area are treated as a local chain", () => {
  const items = ["Quick Stop", "Quick Stop", "Quick Stop", "Nonna's Bakery"].map((name) => ({
    name,
    independence: assessIndependence({ name, shop: "supermarket" }),
  }));

  const before = items[0].independence.score;
  penalizeRepeatedNames(items);

  assert.ok(items[0].independence.score < before, "repeated name should lose points");
  assert.ok(
    items[0].independence.reasons.some((r) => r.includes("local chain")),
    "and should say why",
  );
  assert.equal(
    items[3].independence.reasons.some((r) => r.includes("local chain")),
    false,
    "a one-off name should be untouched",
  );
});

test("two locations is not enough to be called a chain", () => {
  const items = ["Dos Hermanos Bakery", "Dos Hermanos Bakery"].map((name) => ({
    name,
    independence: assessIndependence({ name, shop: "bakery" }),
  }));
  penalizeRepeatedNames(items);
  assert.equal(items[0].independence.independent, true);
});

test("hard chain signals produce a definitive verdict", () => {
  // A brand entity, a denylist name, and an explicit chain tag are all facts
  // about the listing, not judgement calls — nobody should be able to file
  // "actually independent" against them.
  const cases: Record<string, string>[] = [
    { name: "Whole Foods Market", shop: "supermarket", "brand:wikidata": "Q1809448" },
    { name: "Trader Joe's", shop: "supermarket" },
    { name: "Some Franchise", shop: "bakery", franchise: "yes" },
  ];
  for (const tags of cases) {
    const v = verdict(tags);
    assert.equal(v.independent, false, `${tags.name} should be filtered`);
    assert.equal(v.definitive, true, `${tags.name} should be definitive`);
  }
});

test("soft verdicts stay open to correction", () => {
  // The repeat detector is a heuristic about a name occurring often. It can be
  // wrong about a genuinely independent shop, so it must remain correctable.
  const items = ["Corner Larder", "Corner Larder", "Corner Larder"].map((name) => ({
    name,
    independence: assessIndependence({ name, shop: "supermarket" }),
  }));
  penalizeRepeatedNames(items);

  assert.equal(items[0].independence.independent, false);
  assert.notEqual(items[0].independence.definitive, true);
});

test("an independent verdict is never marked definitive", () => {
  // `definitive` only ever locks a negative verdict; it must not leak onto a
  // place that passed, where it would have no meaning.
  const v = verdict({ name: "Nonna's Bakery", shop: "bakery" });
  assert.equal(v.independent, true);
  assert.notEqual(v.definitive, true);
});

test("farm-supply chains are not farm stands", () => {
  // Live Dayton data: "Rural king" mistagged shop=farm with no brand tag.
  const v = verdict({ name: "Rural king", shop: "farm" });
  assert.equal(v.independent, false);
  assert.equal(v.definitive, true);
});
