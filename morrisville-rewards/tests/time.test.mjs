import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  elapsedMinutes,
  formatClock,
  formatDuration,
  formatTime,
  relativeDay,
  timeAgo,
  venueDate,
  weekStart,
} from "../src/lib/time.ts";

const at = (isoString) => new Date(isoString);
// ICU may put a narrow no-break space before AM/PM.
const plain = (s) => s.replace(/[  ]/g, " ");

test("venueDate uses the Morrisville calendar day, not UTC", () => {
  assert.equal(venueDate(at("2026-11-19T04:30:00Z")), "2026-11-18"); // 11:30 PM EST
  assert.equal(venueDate(at("2026-11-19T05:30:00Z")), "2026-11-19"); // 12:30 AM EST
});

test("venueDate is correct around the March 8, 2026 DST start", () => {
  assert.equal(venueDate(at("2026-03-08T04:59:00Z")), "2026-03-07"); // 11:59 PM EST
  assert.equal(venueDate(at("2026-03-08T06:59:00Z")), "2026-03-08"); // 1:59 AM EST
  assert.equal(venueDate(at("2026-03-08T07:00:00Z")), "2026-03-08"); // 3:00 AM EDT
  assert.equal(venueDate(at("2026-03-09T03:59:00Z")), "2026-03-08"); // 11:59 PM EDT
  assert.equal(venueDate(at("2026-03-09T04:00:00Z")), "2026-03-09"); // midnight EDT
});

test("venueDate is correct around the November 1, 2026 DST end", () => {
  assert.equal(venueDate(at("2026-11-01T03:59:00Z")), "2026-10-31"); // 11:59 PM EDT
  assert.equal(venueDate(at("2026-11-01T04:00:00Z")), "2026-11-01"); // midnight EDT
  assert.equal(venueDate(at("2026-11-02T04:59:00Z")), "2026-11-01"); // 11:59 PM EST
  assert.equal(venueDate(at("2026-11-02T05:00:00Z")), "2026-11-02"); // midnight EST
});

test("addDays does calendar math across DST, months, years and leap days", () => {
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addDays("2026-11-01", -1), "2026-10-31");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-11-19", -7), "2026-11-12");
});

test("weekStart is the Monday of the week", () => {
  assert.equal(weekStart("2026-11-16"), "2026-11-16"); // Monday
  assert.equal(weekStart("2026-11-19"), "2026-11-16"); // Thursday
  assert.equal(weekStart("2026-11-22"), "2026-11-16"); // Sunday stays in the same week
  assert.equal(weekStart("2026-11-23"), "2026-11-23"); // next Monday
  assert.equal(weekStart("2026-03-08"), "2026-03-02"); // DST Sunday
  assert.equal(weekStart("2026-01-01"), "2025-12-29"); // across a year boundary
});

test("formatClock shows a stopwatch", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(65_000), "1:05");
  assert.equal(formatClock(59 * 60_000 + 59_000), "59:59");
  assert.equal(formatClock(3_725_000), "1:02:05");
  assert.equal(formatClock(-5_000), "0:00");
});

test("formatDuration reads naturally", () => {
  assert.equal(formatDuration(54), "54 min");
  assert.equal(formatDuration(60), "1 hr");
  assert.equal(formatDuration(125), "2 hr 5 min");
  assert.equal(formatDuration(0), "0 min");
  assert.equal(formatDuration(-3), "0 min");
});

test("elapsedMinutes is floored, capped and never negative", () => {
  const start = "2026-11-18T12:00:00.000Z";
  assert.equal(elapsedMinutes(start, Date.parse("2026-11-18T13:21:59.000Z")), 81);
  assert.equal(elapsedMinutes(start, Date.parse("2026-11-19T13:21:00.000Z"), 180), 180);
  assert.equal(elapsedMinutes(start, Date.parse("2026-11-18T11:00:00.000Z")), 0);
});

test("relativeDay labels today, yesterday, then dates", () => {
  assert.equal(relativeDay("2026-11-19", "2026-11-19"), "Today");
  assert.equal(relativeDay("2026-11-18", "2026-11-19"), "Yesterday");
  assert.equal(relativeDay("2026-11-16", "2026-11-19"), "Mon, Nov 16");
  assert.equal(relativeDay("2026-03-01", "2026-03-02"), "Yesterday");
});

test("formatTime shows Morrisville wall-clock time", () => {
  assert.equal(plain(formatTime("2026-11-20T00:42:00Z")), "7:42 PM"); // EST
  assert.equal(plain(formatTime("2026-07-01T23:42:00Z")), "7:42 PM"); // EDT
});

test("timeAgo is short and relative", () => {
  const now = Date.parse("2026-11-19T18:00:00Z");
  assert.equal(timeAgo("2026-11-19T17:59:30Z", now), "just now");
  assert.equal(timeAgo("2026-11-19T17:55:00Z", now), "5 min ago");
  assert.equal(timeAgo("2026-11-19T16:00:00Z", now), "2 hr ago");
});
