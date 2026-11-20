import { test } from "node:test";
import assert from "node:assert/strict";
import { tiePlaces } from "../src/lib/ranks.ts";
import { distanceM } from "../src/lib/geo.ts";

test("tied scores share a place, the next one skips ahead (1, 1, 3)", () => {
  const rows = [
    { rank: 1, value: 90 },
    { rank: 2, value: 90 },
    { rank: 3, value: 60 },
    { rank: 4, value: 60 },
    { rank: 5, value: 30 },
  ];
  assert.deepEqual(tiePlaces(rows), [1, 1, 3, 3, 5]);
});

test("a gap in the list (your row far below the top) keeps its own rank", () => {
  const rows = [
    { rank: 1, value: 90 },
    { rank: 2, value: 80 },
    { rank: 40, value: 80 },
  ];
  assert.deepEqual(tiePlaces(rows), [1, 2, 40]);
});

test("distance matches the database formula (0.01° of latitude ≈ 1112 m)", () => {
  assert.equal(Math.round(distanceM(35.8235, -78.8256, 35.8335, -78.8256)), 1112);
});
