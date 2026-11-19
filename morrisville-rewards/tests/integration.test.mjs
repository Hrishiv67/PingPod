// Live integration tests against the real Supabase backend.
// They sign in as four throwaway QA accounts and exercise the same RPCs the web and iOS apps use.
//
// Setup (fresh accounts each run):  supabase/tests/qa_users_teardown.sql then qa_users_setup.sql
// Run:
//   NODE_USE_ENV_PROXY=1 SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=<publishable key> \
//   QA_PASSWORD=<password> QA_STAFF_CODE=<one-time staff code> node --test tests/integration.test.mjs
// Teardown: supabase/tests/qa_users_teardown.sql (removes all QA data from the live boards).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_KEY, QA_PASSWORD, QA_STAFF_CODE } = process.env;
const ready = Boolean(SUPABASE_URL && SUPABASE_KEY && QA_PASSWORD && QA_STAFF_CODE);
if (!ready) {
  console.log("Skipping live integration tests: set SUPABASE_URL, SUPABASE_KEY, QA_PASSWORD, QA_STAFF_CODE.");
}

const client = () =>
  createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const venueDay = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
};
const weekStart = (day) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

async function ok(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`Unexpected error: ${error.message}`);
  return data;
}
async function fails(promise, pattern) {
  const { data, error } = await promise;
  assert.ok(error, `Expected an error matching ${pattern}, got data ${JSON.stringify(data)}`);
  if (pattern) assert.match(error.message, pattern);
  return error;
}

const users = {};
const ids = {};
const anon = ready ? client() : null;
const today = venueDay(0);
const thisWeek = weekStart(today);
let crew;
let aToday60;
let aAfterJoin;
let bAfterJoin;
let cOwn;

describe("PingPod Morrisville Rewards · live backend", { skip: !ready }, () => {
  before(async () => {
    for (const key of ["a", "b", "c", "d"]) {
      const sb = client();
      const data = await ok(sb.auth.signInWithPassword({ email: `qa-${key}@example.test`, password: QA_PASSWORD }));
      users[key] = sb;
      ids[key] = data.user.id;
    }
  });

  it("public visitors can read boards but not private data", async () => {
    await ok(anon.rpc("get_leaderboard", { p_metric: "minutes", p_period: "week", p_scope: "verified" }));
    await ok(anon.rpc("get_crew_leaderboard", { p_period: "week", p_scope: "verified" }));
    const display = await ok(anon.rpc("get_display_data"));
    assert.ok(Array.isArray(display.minutes));
    assert.ok(Array.isArray(display.spindex) && display.slides.includes("spindex"));
    await fails(anon.from("profiles").select("*"), /permission denied/);
    await fails(anon.from("play_sessions").select("*"), /permission denied/);
    await fails(anon.rpc("get_me"), /permission denied|sign in/i);
    await fails(anon.rpc("start_session"), /permission denied|sign in/i);
  });

  it("new accounts must choose a nickname before playing", async () => {
    const me = await ok(users.d.rpc("get_me"));
    assert.equal(me.profile, null);
    await fails(users.d.rpc("start_session"), /nickname/i);
  });

  it("nicknames are unique (case-insensitive) and moderated", async () => {
    const a = await ok(users.a.rpc("save_profile", { p_display_name: "QA Alex", p_avatar_color: "blue" }));
    assert.equal(a.display_name, "QA Alex");
    assert.equal(a.hidden_by_admin, false);
    await fails(users.b.rpc("save_profile", { p_display_name: "qa alex" }), /taken/);
    await fails(users.b.rpc("save_profile", { p_display_name: "QA Shithead" }), /different nickname/);
    await fails(users.b.rpc("save_profile", { p_display_name: "x" }), /2–20/);
    await ok(users.b.rpc("save_profile", { p_display_name: "QA Blair" }));
    await ok(users.c.rpc("save_profile", { p_display_name: "QA Casey" }));
    await ok(users.d.rpc("save_profile", { p_display_name: "QA Dana" }));
  });

  it("timer: one active session, idempotent start/stop, short sessions not counted, cancel", async () => {
    const requestId = randomUUID();
    const s1 = await ok(users.a.rpc("start_session", { p_client_request_id: requestId }));
    assert.equal(s1.status, "active");
    assert.equal(s1.played_on, today);
    await fails(users.a.rpc("start_session"), /already have a session running/);
    const again = await ok(users.a.rpc("start_session", { p_client_request_id: requestId }));
    assert.equal(again.id, s1.id, "same request id returns the same session");
    await fails(users.a.rpc("log_session", { p_played_on: today, p_minutes: 30 }), /Finish your running session/);
    const stopped = await ok(users.a.rpc("stop_session", { p_id: s1.id }));
    assert.equal(stopped.status, "cancelled");
    assert.ok(stopped.flags.includes("too_short"));
    assert.equal(stopped.minutes, 0);
    const stoppedAgain = await ok(users.a.rpc("stop_session", { p_id: s1.id }));
    assert.deepEqual(stoppedAgain, stopped, "second stop changes nothing");
    const s2 = await ok(users.a.rpc("start_session"));
    const me = await ok(users.a.rpc("get_me"));
    assert.equal(me.active_session.id, s2.id, "running timer is restored by get_me");
    assert.ok(Date.parse(me.server_now) > 0);
    const cancelled = await ok(users.a.rpc("cancel_session", { p_id: s2.id }));
    assert.equal(cancelled.status, "cancelled");
    await fails(users.b.rpc("stop_session", { p_id: s2.id }), /not found/i);
  });

  it("log past play: validation, duplicates, backdating window, daily cap", async () => {
    aToday60 = await ok(users.a.rpc("log_session", { p_played_on: today, p_minutes: 60, p_note: "QA doubles" }));
    assert.equal(aToday60.status, "approved", "logged play counts immediately (no approval step)");
    assert.equal(aToday60.method, "manual");
    assert.equal(aToday60.minutes, 60);
    const requestId = randomUUID();
    const yesterday = await ok(users.a.rpc("log_session", { p_played_on: venueDay(-1), p_minutes: 180, p_client_request_id: requestId }));
    const replay = await ok(users.a.rpc("log_session", { p_played_on: venueDay(-1), p_minutes: 180, p_client_request_id: requestId }));
    assert.equal(replay.id, yesterday.id, "retrying the same submission does not double count");
    await fails(users.a.rpc("log_session", { p_played_on: today, p_minutes: 60 }), /already logged/);
    await fails(users.a.rpc("log_session", { p_played_on: today, p_minutes: 181 }), /between 5 and 180/);
    await fails(users.a.rpc("log_session", { p_played_on: today, p_minutes: 4 }), /between 5 and 180/);
    await fails(users.a.rpc("log_session", { p_played_on: venueDay(-8), p_minutes: 30 }), /last 7 days/);
    await fails(users.a.rpc("log_session", { p_played_on: venueDay(1), p_minutes: 30 }), /future/);
    await fails(users.a.rpc("log_session", { p_played_on: venueDay(-1), p_minutes: 150 }), /more than 300 minutes/);
    await ok(users.a.rpc("log_session", { p_played_on: venueDay(-7), p_minutes: 30 }));
  });

  it("row-level security: players only see and change their own data through functions", async () => {
    const sessions = await ok(users.a.from("play_sessions").select("*"));
    assert.ok(sessions.length >= 3);
    assert.ok(sessions.every((s) => s.user_id === ids.a));
    const profiles = await ok(users.a.from("profiles").select("*"));
    assert.deepEqual(profiles.map((p) => p.id), [ids.a]);
    const bSessions = await ok(users.b.from("play_sessions").select("*").eq("user_id", ids.a));
    assert.equal(bSessions.length, 0, "B cannot read A's sessions");
    await fails(users.a.from("play_sessions").insert({ user_id: ids.a, method: "manual", status: "approved",
      started_at: new Date().toISOString(), played_on: today, minutes: 500 }), /permission denied/);
    await fails(users.a.from("play_sessions").update({ status: "approved" }).eq("id", aToday60.id), /permission denied/);
    await fails(users.a.from("play_sessions").delete().eq("id", aToday60.id), /permission denied/);
    await fails(users.a.from("profiles").update({ hidden_by_admin: false, display_name: "QA Hacker" }).eq("id", ids.b), /permission denied/);
    await fails(users.a.from("profiles").insert({ id: ids.b, display_name: "QA Fake" }), /permission denied/);
    await fails(users.a.rpc("admin_analytics"), /Staff access only/);
    await fails(users.a.rpc("admin_review_session", { p_id: aToday60.id, p_action: "approve" }), /Staff access only/);
  });

  it("crews: create, preview, join by code, idempotent join, invalid code, one crew at a time", async () => {
    crew = await ok(users.a.rpc("create_crew", { p_name: "QA Spinners" }));
    assert.match(crew.invite_code, /^[A-HJ-NP-Z2-9]{8}$/);
    const preview = await ok(anon.rpc("preview_crew", { p_code: crew.invite_code.toLowerCase() }));
    assert.equal(preview.name, "QA Spinners");
    assert.equal(preview.members, 1);
    let board = await ok(anon.rpc("get_crew_leaderboard", { p_period: "week", p_scope: "community" }));
    assert.ok(!board.some((r) => r.name === "QA Spinners"), "crews need 2 members to rank");
    await fails(users.b.rpc("join_crew", { p_code: "ZZZZ2222" }), /didn't work/);
    const joined = await ok(users.b.rpc("join_crew", { p_code: `${crew.invite_code.slice(0, 4)}-${crew.invite_code.slice(4)}`.toLowerCase() }));
    assert.equal(joined.id, crew.id);
    const rejoin = await ok(users.b.rpc("join_crew", { p_code: crew.invite_code }));
    assert.equal(rejoin.id, crew.id, "joining your own crew again is a no-op");
    await ok(users.c.rpc("create_crew", { p_name: "QA Solo" }));
    await fails(users.c.rpc("join_crew", { p_code: crew.invite_code }), /already in a crew/);
    await fails(users.c.rpc("create_crew", { p_name: "QA Another" }), /Leave your current crew/);
    await ok(users.c.rpc("leave_crew"));
    await fails(users.c.rpc("leave_crew"), /not in a crew/);
    await fails(users.b.rpc("rename_crew", { p_name: "QA Renamed" }), /Only the crew owner/);
    await fails(users.a.rpc("create_crew", { p_name: "qa spinners" }), /Leave your current crew|taken/);
    board = await ok(anon.rpc("get_crew_leaderboard", { p_period: "week", p_scope: "community" }));
    assert.ok(board.some((r) => r.name === "QA Spinners"));
    assert.ok(!board.some((r) => r.name === "QA Solo"), "archived crews never rank");
  });

  it("crew totals only include play logged after joining", async () => {
    aAfterJoin = await ok(users.a.rpc("log_session", { p_played_on: today, p_minutes: 30 }));
    bAfterJoin = await ok(users.b.rpc("log_session", { p_played_on: today, p_minutes: 45 }));
    const mine = await ok(users.a.rpc("get_my_crew", { p_period: "week", p_scope: "community" }));
    assert.equal(mine.name, "QA Spinners");
    assert.equal(mine.is_owner, true);
    assert.equal(mine.members.length, 2);
    assert.equal(mine.total_minutes, 75, "A's 60 (before crew) and yesterday's 180 are excluded");
    const byName = Object.fromEntries(mine.members.map((m) => [m.display_name, m.minutes]));
    assert.deepEqual(byName, { "QA Alex": 30, "QA Blair": 45 });
    const board = await ok(users.b.rpc("get_crew_leaderboard", { p_period: "week", p_scope: "community" }));
    const row = board.find((r) => r.name === "QA Spinners");
    assert.equal(row.minutes, 75);
    assert.equal(row.members, 2);
    assert.equal(row.avg_minutes, 37);
    assert.equal(row.is_mine, true);
  });

  it("staff: claim code, session list, adjust/reject/reopen with reasons, no self-review, audit", async () => {
    await fails(users.c.rpc("admin_list_sessions"), /Staff access only/);
    const claimed = await ok(users.c.rpc("admin_claim", { p_code: QA_STAFF_CODE.toLowerCase() }));
    assert.equal(claimed.role, "staff");
    await fails(users.b.rpc("admin_claim", { p_code: QA_STAFF_CODE }), /didn't work/);
    const all = await ok(users.c.rpc("admin_list_sessions", { p_status: "all" }));
    assert.ok(all.some((s) => s.id === aToday60.id && s.status === "approved" && s.display_name === "QA Alex" && s.note === "QA doubles"));
    const pending = await ok(users.c.rpc("admin_list_sessions", { p_status: "pending" }));
    assert.equal(pending.length, 0, "nothing waits for approval");
    await fails(users.c.rpc("admin_review_session", { p_id: aToday60.id, p_action: "approve" }), /Already approved/);

    cOwn = await ok(users.c.rpc("log_session", { p_played_on: today, p_minutes: 20 }));
    assert.equal(cOwn.status, "approved");
    await fails(users.c.rpc("admin_review_session", { p_id: cOwn.id, p_action: "adjust", p_minutes: 10, p_reason: "QA" }), /your own session/);
    await fails(users.c.rpc("admin_review_session", { p_id: cOwn.id, p_action: "reject", p_reason: "QA" }), /your own session/);

    await fails(users.c.rpc("admin_review_session", { p_id: bAfterJoin.id, p_action: "adjust", p_minutes: 40 }), /reason/);
    const fixed = await ok(users.c.rpc("admin_review_session",
      { p_id: bAfterJoin.id, p_action: "adjust", p_minutes: 40, p_reason: "QA: front desk saw 40 min" }));
    assert.equal(fixed.minutes, 40);
    assert.equal(fixed.status, "approved");

    const aWeek = async (scope) =>
      (await ok(anon.rpc("get_leaderboard", { p_metric: "minutes", p_period: "week", p_scope: scope })))
        .find((r) => r.display_name === "QA Alex")?.value ?? 0;
    const before = await aWeek("community");
    assert.ok(before >= 60);
    await fails(users.c.rpc("admin_review_session", { p_id: aToday60.id, p_action: "reject" }), /reason/);
    const rejected = await ok(users.c.rpc("admin_review_session",
      { p_id: aToday60.id, p_action: "reject", p_reason: "QA: duplicate entry" }));
    assert.equal(rejected.status, "rejected");
    assert.equal(await aWeek("community"), before - 60, "rejected minutes leave the board");
    assert.equal(await aWeek("verified"), before - 60);

    await fails(users.c.rpc("admin_review_session", { p_id: aToday60.id, p_action: "reopen" }), /reason/);
    const reopened = await ok(users.c.rpc("admin_review_session",
      { p_id: aToday60.id, p_action: "reopen", p_reason: "QA: player showed proof" }));
    assert.equal(reopened.status, "pending", "staff reopen is not auto-counted");
    const nowPending = await ok(users.c.rpc("admin_list_sessions", { p_status: "pending" }));
    assert.ok(nowPending.some((s) => s.id === aToday60.id));
    const restored = await ok(users.c.rpc("admin_review_session", { p_id: aToday60.id, p_action: "approve" }));
    assert.equal(restored.status, "approved");
    assert.equal(restored.minutes, 60);
    assert.equal(await aWeek("verified"), before, "approving after reopen restores the minutes");

    await fails(users.c.rpc("admin_update_settings", { p_patch: { backdate_days: 3 } }), /pilot owner/);
    const log = await ok(users.c.rpc("admin_audit_log", { p_limit: 50 }));
    for (const action of ["session.adjust", "session.reject", "session.reopen", "session.approve"]) {
      assert.ok(log.some((l) => l.action === action && l.actor_name === "QA Casey"), `audit has ${action}`);
    }
  });

  it("leaderboards: logged time counts immediately in both scopes, own-row flag, deterministic order", async () => {
    const aRows = await ok(users.a.from("play_sessions").select("minutes,status,played_on"));
    const expectA = aRows.filter((s) => s.status === "approved" && s.played_on >= thisWeek)
      .reduce((n, s) => n + s.minutes, 0);
    const verified = await ok(users.a.rpc("get_leaderboard", { p_metric: "minutes", p_period: "week", p_scope: "verified" }));
    const aRow = verified.find((r) => r.display_name === "QA Alex");
    assert.equal(aRow.value, expectA);
    assert.equal(aRow.is_me, true);
    assert.ok(verified.some((r) => r.display_name === "QA Casey" && r.value === 20), "fresh log is on the board right away");
    const community = await ok(anon.rpc("get_leaderboard", { p_metric: "minutes", p_period: "week", p_scope: "community" }));
    assert.ok(community.some((r) => r.display_name === "QA Casey" && r.value === 20));
    assert.deepEqual(community.map((r) => [r.display_name, r.value]), verified.map((r) => [r.display_name, r.value]),
      "with no approval step both scopes match");
    assert.ok(community.every((r) => r.is_me === false));
    const ranks = community.map((r) => r.rank);
    assert.deepEqual(ranks, ranks.map((_, i) => i + 1), "ranks are 1..n with no ties");
    const again = await ok(anon.rpc("get_leaderboard", { p_metric: "minutes", p_period: "week", p_scope: "community" }));
    assert.deepEqual(again.map((r) => r.user_id), community.map((r) => r.user_id));
    for (let i = 1; i < community.length; i += 1) assert.ok(community[i - 1].value >= community[i].value);
    const all = await ok(anon.rpc("get_leaderboard", { p_metric: "minutes", p_period: "all", p_scope: "verified" }));
    const expectAll = aRows.filter((s) => s.status === "approved").reduce((n, s) => n + s.minutes, 0);
    assert.equal(all.find((r) => r.display_name === "QA Alex").value, expectAll);
    const longest = await ok(anon.rpc("get_leaderboard", { p_metric: "longest", p_period: "all", p_scope: "verified" }));
    assert.equal(longest.find((r) => r.display_name === "QA Alex").value, 180);
    const streaks = await ok(anon.rpc("get_leaderboard", { p_metric: "streaks", p_period: "all", p_scope: "verified" }));
    assert.ok(streaks.find((r) => r.display_name === "QA Alex").value >= 1);
    await fails(anon.rpc("get_leaderboard", { p_metric: "nope" }), /Unknown/);
    const crews = await ok(anon.rpc("get_crew_leaderboard", { p_period: "week", p_scope: "verified" }));
    assert.equal(crews.find((r) => r.name === "QA Spinners").minutes, 70, "A 30 + B 40 (corrected)");
  });

  it("SPINDEX is labeled self-reported until staff verify it", async () => {
    await fails(users.b.rpc("submit_spindex", { p_rating: 4000 }), /0 to 3000/);
    const claim = await ok(users.b.rpc("submit_spindex", { p_rating: 1450, p_note: "QA from SPINDEX app" }));
    assert.equal(claim.status, "unverified");
    assert.equal(claim.source, "self_reported");
    let verified = await ok(anon.rpc("get_leaderboard", { p_metric: "spindex", p_period: "all", p_scope: "verified" }));
    assert.ok(!verified.some((r) => r.display_name === "QA Blair"));
    const community = await ok(anon.rpc("get_leaderboard", { p_metric: "spindex", p_period: "all", p_scope: "community" }));
    assert.equal(community.find((r) => r.display_name === "QA Blair").detail, "self_reported");
    const queue = await ok(users.c.rpc("admin_list_spindex", { p_status: "unverified" }));
    assert.ok(queue.some((r) => r.id === claim.id));
    await fails(users.c.rpc("admin_review_spindex", { p_id: claim.id, p_action: "verify" }), /how you verified/);
    await ok(users.c.rpc("admin_review_spindex", { p_id: claim.id, p_action: "verify", p_source: "QA saw app in person" }));
    verified = await ok(anon.rpc("get_leaderboard", { p_metric: "spindex", p_period: "all", p_scope: "verified" }));
    const row = verified.find((r) => r.display_name === "QA Blair");
    assert.equal(row.value, 1450);
    assert.equal(row.detail, "verified");
    const me = await ok(users.b.rpc("get_me"));
    assert.equal(me.spindex.status, "verified");
    assert.equal(me.spindex.source, "staff_verified");
  });

  it("achievements are derived from real activity", async () => {
    const list = await ok(users.a.rpc("get_my_achievements"));
    assert.equal(list.length, 10);
    const by = Object.fromEntries(list.map((x) => [x.code, x]));
    assert.equal(by.first_session.progress, 1);
    assert.ok(by.first_session.earned_at);
    assert.equal(by.first_hour.progress, 60);
    assert.equal(by.crew_joined.progress, 1);
    assert.equal(by.first_verified, undefined, "the old staff-approval milestone is gone");
    assert.equal(by.regular.target, 5);
    assert.equal(by.regular.progress, 3, "today, yesterday and a week ago");
    assert.equal(by.regular.earned_at, null);
    assert.ok(by.minutes_300.progress <= 300 && by.minutes_300.progress >= 270);
    const d = await ok(users.d.rpc("get_my_achievements"));
    assert.ok(d.every((x) => x.progress === 0 && x.earned_at === null));
  });

  it("requests to staff: corrections only on your own sessions", async () => {
    const req = await ok(users.a.rpc("submit_request",
      { p_kind: "correction", p_message: "QA: it was 70 minutes", p_session_id: aToday60.id }));
    assert.equal(req.status, "open");
    await fails(users.b.rpc("submit_request", { p_kind: "correction", p_message: "QA", p_session_id: aToday60.id }), /not found/i);
    const queue = await ok(users.c.rpc("admin_list_requests", { p_status: "open" }));
    assert.ok(queue.some((r) => r.id === req.id && r.session.minutes === 60));
    await ok(users.c.rpc("admin_resolve_request", { p_id: req.id, p_status: "resolved", p_response: "QA adjusted" }));
    const mine = await ok(users.a.from("support_requests").select("status,admin_response"));
    assert.deepEqual(mine, [{ status: "resolved", admin_response: "QA adjusted" }]);
  });

  it("privacy: opting out hides the player publicly but keeps their own stats", async () => {
    await ok(users.a.rpc("save_profile", { p_display_name: "QA Alex", p_avatar_color: "blue", p_show_on_leaderboard: false }));
    for (const metric of ["minutes", "longest", "streaks", "spindex"]) {
      for (const scope of ["verified", "community"]) {
        const rows = await ok(anon.rpc("get_leaderboard", { p_metric: metric, p_period: "all", p_scope: scope }));
        assert.ok(!rows.some((r) => r.display_name === "QA Alex"), `${metric}/${scope}`);
      }
    }
    const display = JSON.stringify(await ok(anon.rpc("get_display_data")));
    assert.ok(!display.includes("QA Alex"));
    assert.ok(!display.includes("@"), "no emails on the public display");
    for (const id of Object.values(ids)) assert.ok(!display.includes(id), "no account ids on the public display");
    const me = await ok(users.a.rpc("get_me"));
    assert.equal(me.profile.show_on_leaderboard, false);
    assert.ok(me.stats.total_verified > 0, "private stats still available");
    assert.equal(me.stats.rank_week_verified, null);
    const crew = await ok(users.a.rpc("get_my_crew", { p_period: "week", p_scope: "verified" }));
    assert.equal(crew.total_minutes, 70, "opted-out players still count toward their crew total");
  });

  it("crew owner leaving hands the crew to the next member", async () => {
    await ok(users.a.rpc("leave_crew"));
    assert.equal(await ok(users.a.rpc("get_my_crew")), null);
    const b = await ok(users.b.rpc("get_my_crew", { p_period: "all", p_scope: "community" }));
    assert.equal(b.is_owner, true);
    assert.equal(b.members.length, 1);
    const board = await ok(anon.rpc("get_crew_leaderboard", { p_period: "all", p_scope: "community" }));
    assert.ok(!board.some((r) => r.name === "QA Spinners"), "below minimum size after A leaves");
  });

  it("realtime: public displays get a 'changed' ping when standings may change", async () => {
    const listener = client();
    let received = null;
    const channel = listener.channel("leaderboard")
      .on("broadcast", { event: "changed" }, (msg) => { received ??= msg.payload; });
    const status = await new Promise((resolve) => {
      channel.subscribe((s) => { if (s !== "CLOSED") resolve(s); });
      setTimeout(() => resolve("TIMEOUT"), 15000);
    });
    assert.equal(status, "SUBSCRIBED");
    // Give the server a moment to finish joining the channel before the write (avoids a race).
    await new Promise((r) => setTimeout(r, 750));
    await ok(users.b.rpc("log_session", { p_played_on: today, p_minutes: 15, p_note: "QA realtime" }));
    for (let i = 0; i < 100 && !received; i += 1) await new Promise((r) => setTimeout(r, 100));
    await listener.removeAllChannels();
    assert.ok(received, "broadcast arrived within 10 seconds");
    assert.deepEqual(Object.keys(received).filter((k) => k !== "id").sort(), ["at"], "ping carries no player data");
  });

  it("deleting an account removes it completely", async () => {
    await ok(users.d.rpc("delete_my_account"));
    const me = await ok(users.d.rpc("get_me"));
    assert.equal(me.profile, null);
    await fails(users.d.rpc("save_profile", { p_display_name: "QA Ghost" }));
    const { error } = await client().auth.signInWithPassword({ email: "qa-d@example.test", password: QA_PASSWORD });
    assert.ok(error, "deleted account can't sign in");
  });
});
