import { test } from "node:test";
import assert from "node:assert/strict";
import { sameScore, tiePlaces } from "../src/lib/ranks.ts";

test("tied scores share a place, the next one skips ahead (1, 1, 3)", () => {
  const rows = [
    { rank: 1, value: 90 },
    { rank: 2, value: 90 },
    { rank: 3, value: 60 },
    { rank: 4, value: 60 },
    { rank: 5, value: 30 },
  ];
  assert.deepEqual(tiePlaces("minutes", rows), [1, 1, 3, 3, 5]);
});

test("a gap in the list (your row far below the top) keeps its own rank", () => {
  const rows = [
    { rank: 1, value: 90 },
    { rank: 2, value: 80 },
    { rank: 40, value: 80 },
  ];
  assert.deepEqual(tiePlaces("minutes", rows), [1, 2, 40]);
});

test("SPINDEX: verified and self-reported are never tied", () => {
  const a = { rank: 1, value: 1600, detail: "verified" };
  const b = { rank: 2, value: 1600, detail: "self_reported" };
  assert.equal(sameScore("spindex", a, b), false);
  assert.deepEqual(tiePlaces("spindex", [a, b]), [1, 2]);
  assert.equal(sameScore("minutes", a, b), true);
});
