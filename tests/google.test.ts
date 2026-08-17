import assert from "node:assert/strict";
import { test } from "vitest";

import { classifyGoogle } from "@/lib/sources/google";

// Every rejection case here arrived in live Covington, KY results the moment
// a real API key was configured: Google hangs store-shaped secondary types
// (food_store especially) on fast food, coffee shops and bars.

test("a restaurant carrying food_store is not a grocer", () => {
  assert.equal(
    classifyGoogle({
      primaryType: "fast_food_restaurant",
      types: ["fast_food_restaurant", "restaurant", "food_store"],
    }),
    null,
  );
});

test("a coffee shop carrying food_store is not a grocer", () => {
  assert.equal(
    classifyGoogle({
      primaryType: "coffee_shop",
      types: ["coffee_shop", "cafe", "food_store", "store"],
    }),
    null,
  );
});

test("a bar is not a market, whatever its secondary types say", () => {
  assert.equal(
    classifyGoogle({ primaryType: "bar", types: ["bar", "restaurant", "market"] }),
    null,
  );
});

test("the loose `market` type alone is not a farmers market", () => {
  // Live Dayton, KY data: an apparel store arrived typed `market`.
  assert.equal(
    classifyGoogle({ primaryType: "market", types: ["market", "clothing_store", "store"] }),
    null,
  );
  // The dedicated type still is one.
  assert.equal(
    classifyGoogle({ primaryType: "farmers_market", types: ["farmers_market", "market"] }),
    "farmers_market",
  );
});

test("a mapped primaryType wins over restaurant-ish side types", () => {
  // A good bakery is usually also a cafe; a deli is usually also a sandwich
  // shop (the Rump & Roll case). Their primary identity keeps them in.
  assert.equal(
    classifyGoogle({ primaryType: "bakery", types: ["bakery", "cafe", "coffee_shop"] }),
    "bakery",
  );
  assert.equal(
    classifyGoogle({ primaryType: "deli", types: ["deli", "sandwich_shop", "restaurant"] }),
    "grocery",
  );
});

test("a deli whose primaryType is sandwich_shop is still a deli", () => {
  // Delicatessens routinely get primaryType sandwich_shop from Google, with
  // deli relegated to the secondary types. The specific format outranks the
  // restaurant-ish signal.
  assert.equal(
    classifyGoogle({
      primaryType: "sandwich_shop",
      types: ["sandwich_shop", "deli", "restaurant", "food_store"],
    }),
    "grocery",
  );
  // A butcher that also does lunch counters, same shape.
  assert.equal(
    classifyGoogle({
      primaryType: "restaurant",
      types: ["restaurant", "butcher_shop", "food_store"],
    }),
    "butcher",
  );
});

test("fast food carrying deli is still fast food", () => {
  // Live Covington data: Arby's arrives typed as a deli. The hard fast-food
  // identity has to beat the trusted-secondary rule.
  assert.equal(
    classifyGoogle({
      primaryType: "fast_food_restaurant",
      types: ["fast_food_restaurant", "sandwich_shop", "deli", "restaurant"],
    }),
    null,
  );
});

test("ice cream and coffee shops carrying bakery are not bakeries", () => {
  // Live Covington data: Cold Stone Creamery, Graeter's and Coffee Emporium
  // all carry a secondary bakery type. A real bakery says bakery in its
  // primaryType instead.
  assert.equal(
    classifyGoogle({
      primaryType: "ice_cream_shop",
      types: ["ice_cream_shop", "dessert_shop", "bakery"],
    }),
    null,
  );
  assert.equal(
    classifyGoogle({
      primaryType: "coffee_shop",
      types: ["coffee_shop", "cafe", "bakery", "food_store"],
    }),
    null,
  );
});

test("broad store types do not rescue an eat-drink place", () => {
  // grocery_store on a gas station is Google being generous, not evidence.
  assert.equal(
    classifyGoogle({
      primaryType: "gas_station",
      types: ["gas_station", "convenience_store", "grocery_store"],
    }),
    null,
  );
});

test("response-only types still classify what the search returns", () => {
  // seafood_store can't be requested, but it can come back on a fishmonger
  // found via a broader type.
  assert.equal(
    classifyGoogle({
      primaryType: "seafood_store",
      types: ["seafood_store", "food_store"],
    }),
    "seafood",
  );
  assert.equal(
    classifyGoogle({ types: ["fruit_and_vegetable_store", "food_store"] }),
    "produce",
  );
});

test("a plain food store with no eat-drink identity is kept", () => {
  assert.equal(
    classifyGoogle({ types: ["food_store", "store", "point_of_interest"] }),
    "grocery",
  );
});
