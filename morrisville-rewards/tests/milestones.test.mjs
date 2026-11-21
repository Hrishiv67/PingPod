import { test } from "node:test";
import assert from "node:assert/strict";
import { earnedKeys, goalHit, MAX_IN_A_ROW, MILESTONES, pickCelebrations } from "../src/celebrate/milestones.ts";

const ach = (...codes) => codes.map((code) => ({ code, earned_at: "2026-11-22T15:00:00Z" }));

test("earned keys: achievements with a celebration, session steps, the weekly goal", () => {
  const keys = earnedKeys({
    achievements: [...ach("first_session", "first_hour", "regular"), { code: "streak_3", earned_at: null }],
    sessions: 26,
    goalWeek: "2026-11-23",
  });
  assert.deepEqual(keys, ["a:first_session", "a:first_hour", "s:10", "s:25", "g:2026-11-23"]);
});

test("first time on a phone: everything already earned is recorded quietly", () => {
  const { show, seen } = pickCelebrations(["a:first_session", "s:10"], null, true);
  assert.deepEqual(show, []);
  assert.deepEqual(seen, ["a:first_session", "s:10"]);
});

test("after a save: new milestones show once, in order, at most three", () => {
  const earned = ["a:first_hour", "a:long_session", "a:first_session", "a:streak_3", "a:crew_joined"];
  const { show, seen } = pickCelebrations(earned, [], false);
  assert.deepEqual(show.map((m) => m.key), ["a:first_session", "a:long_session", "a:first_hour"]);
  assert.equal(show.length, MAX_IN_A_ROW);
  assert.equal(show[0].kind, "sessions");
  assert.equal(show[0].value, 1);
  // All five are now seen, including the two that didn't fit.
  assert.deepEqual(pickCelebrations(earned, seen, false).show, []);
});

test("a session count step shows when crossed", () => {
  const before = pickCelebrations(earnedKeys({ achievements: ach("first_session"), sessions: 9, goalWeek: null }), [], false).seen;
  const { show } = pickCelebrations(earnedKeys({ achievements: ach("first_session"), sessions: 10, goalWeek: null }), before, false);
  assert.deepEqual(show.map((m) => [m.kind, m.value, m.title]), [["sessions", 10, "10 sessions"]]);
});

test("the weekly goal celebrates once per week", () => {
  const w1 = pickCelebrations(["g:2026-11-23"], [], false);
  assert.equal(w1.show[0].kind, "goal");
  assert.equal(w1.show[0].key, "g:2026-11-23");
  assert.deepEqual(pickCelebrations(["g:2026-11-23"], w1.seen, false).show, []);
  assert.equal(pickCelebrations(["g:2026-11-30"], w1.seen, false).show.length, 1);
});

test("at startup only a weekly top-five finish shows; the rest is recorded quietly", () => {
  const { show, seen } = pickCelebrations(["a:weekly_top5", "a:first_hour"], [], true);
  assert.deepEqual(show.map((m) => m.key), ["a:weekly_top5"]);
  assert.deepEqual(seen.sort(), ["a:first_hour", "a:weekly_top5"]);
});

test("goal hit needs both the minutes and the days", () => {
  assert.equal(goalHit(150, 3, 3, 150), true);
  assert.equal(goalHit(150, 2, 3, 150), false);
  assert.equal(goalHit(149, 5, 3, 150), false);
  assert.equal(goalHit(500, 7, null, null), false);
});

test("every milestone has copy", () => {
  for (const m of MILESTONES) assert.ok(m.title && m.subtitle && m.group, m.key);
});
