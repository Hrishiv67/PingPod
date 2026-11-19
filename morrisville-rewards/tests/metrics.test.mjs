import { test } from "node:test";
import assert from "node:assert/strict";

// Lightweight source checks; application runtime is also verified by `npm run build`.
import { readFileSync } from "node:fs";
import {
  elapsedMinutes,
  totalMinutes,
  weeklyStreak,
} from "../src/lib/metrics.ts";

test("live elapsed minutes are capped and cannot become negative", () => {
  assert.equal(
    elapsedMinutes(
      "2026-11-18T12:00:00.000Z",
      Date.parse("2026-11-18T13:21:00.000Z"),
    ),
    81,
  );
  assert.equal(
    elapsedMinutes(
      "2026-11-18T12:00:00.000Z",
      Date.parse("2026-11-19T13:21:00.000Z"),
    ),
    180,
  );
  assert.equal(
    elapsedMinutes(
      "2026-11-18T12:00:00.000Z",
      Date.parse("2026-11-18T11:00:00.000Z"),
    ),
    0,
  );
});

test("pending and approved minutes count but active and rejected do not", () => {
  const make = (status, minutes) => ({ status, minutes });
  assert.equal(
    totalMinutes([
      make("pending", 45),
      make("approved", 20),
      make("rejected", 100),
      make("active", 0),
    ]),
    65,
  );
});

test("weekly streak is based on consecutive weeks, not consecutive days", () => {
  const make = (started_at) => ({ started_at, status: "pending" });
  const sessions = [
    make("2026-11-18T16:00:00Z"),
    make("2026-11-11T16:00:00Z"),
    make("2026-11-04T16:00:00Z"),
  ];
  assert.equal(weeklyStreak(sessions, new Date("2026-11-18T21:00:00Z")), 3);
  assert.equal(weeklyStreak(sessions, new Date("2026-12-03T21:00:00Z")), 0);
});

test("migrations define server-owned timer procedures", () => {
  const sql = readFileSync(
    new URL("../supabase/schema.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /create or replace function public\.start_session/);
  assert.match(sql, /create or replace function public\.stop_session/);
  assert.match(sql, /clock_timestamp\(\)/);
});

test("public display data is opt-in and aggregated", () => {
  const sql = readFileSync(
    new URL("../supabase/schema.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /p\.show_on_leaderboard = true/);
  assert.match(sql, /sum\(s\.minutes\)/);
});
