import assert from "node:assert/strict";
import test from "node:test";

import { evaluateHours } from "../src/lib/hours.ts";

/** A fixed local moment: Saturday 2026-08-15, 11:30. */
const satMorning = new Date(2026, 7, 15, 11, 30);
/** Wednesday 2026-08-12, 11:30. */
const wedMorning = new Date(2026, 7, 12, 11, 30);
/** Saturday 2026-08-15, 23:30. */
const satNight = new Date(2026, 7, 15, 23, 30);

test("24/7 is always open", () => {
  assert.equal(evaluateHours("24/7", satMorning), "open");
});

test("missing or empty hours are unknown, never a guess", () => {
  assert.equal(evaluateHours(undefined, satMorning), "unknown");
  assert.equal(evaluateHours("", satMorning), "unknown");
});

test("a simple day range is evaluated", () => {
  assert.equal(evaluateHours("Mo-Sa 10:00-18:00", satMorning), "open");
  assert.equal(evaluateHours("Mo-Sa 10:00-18:00", satNight), "closed");
  assert.equal(evaluateHours("Mo-Fr 10:00-18:00", satMorning), "closed");
});

test("a market open only on Saturday morning", () => {
  assert.equal(evaluateHours("Sa 08:00-14:00", satMorning), "open");
  assert.equal(evaluateHours("Sa 08:00-14:00", wedMorning), "closed");
});

test("comma-separated day lists", () => {
  assert.equal(evaluateHours("Tu,Sa 08:00-14:00", satMorning), "open");
  assert.equal(evaluateHours("Tu,Th 08:00-14:00", satMorning), "closed");
});

test("a later rule overrides an earlier one", () => {
  assert.equal(evaluateHours("Mo-Sa 09:00-18:00; Sa off", satMorning), "closed");
  assert.equal(evaluateHours("Mo-Su 09:00-18:00; We off", wedMorning), "closed");
});

test("split hours across a lunch break", () => {
  assert.equal(evaluateHours("Sa 08:00-11:00,14:00-18:00", satMorning), "closed");
  assert.equal(evaluateHours("Sa 08:00-12:00,14:00-18:00", satMorning), "open");
});

test("overnight spans wrap past midnight", () => {
  assert.equal(evaluateHours("Sa 22:00-02:00", satNight), "open");
  assert.equal(evaluateHours("Sa 22:00-02:00", satMorning), "closed");
});

test("grammar we do not support returns unknown rather than a wrong answer", () => {
  for (const value of [
    "Mar-Oct Sa 09:00-14:00", // seasonal
    "Sa[-1] 10:00-14:00", // last Saturday of the month
    "Mo-Fr 09:00-17:00; PH off", // public holidays
    "sunrise-sunset",
    'Mo-Fr 09:00-17:00 "by appointment"',
  ]) {
    assert.equal(evaluateHours(value, satMorning), "unknown", value);
  }
});

test("garbage input is unknown, not a crash", () => {
  assert.equal(evaluateHours("who knows", satMorning), "unknown");
  assert.equal(evaluateHours("25:99-30:00", satMorning), "unknown");
});
