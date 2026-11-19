// The demo backend (src/lib/demo.ts) runs when no Supabase env vars are set.
// It should enforce the same rules and messages as the database functions.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { demoApi as api, resetDemo } from "../src/lib/demo.ts";
import { addDays, venueDate } from "../src/lib/time.ts";

const today = venueDate();
const rid = () => crypto.randomUUID();

async function signedInWithProfile(name = "Demo Player") {
  await api.signUp("player@example.com", "secret1");
  await api.saveProfile({ display_name: name, avatar_color: "pink", show_on_leaderboard: true, show_spindex: true });
}

beforeEach(() => resetDemo());

test("sign up validates and signs in; sign in checks the password", async () => {
  await assert.rejects(api.signUp("not-an-email", "secret1"), /doesn't look right/);
  await assert.rejects(api.signUp("a@example.com", "123"), /at least 6 characters/);
  const res = await api.signUp("a@example.com", "secret1");
  assert.equal(res.needsConfirmation, false);
  assert.equal((await api.getUser())?.email, "a@example.com");
  await assert.rejects(api.signUp("a@example.com", "secret1"), /already an account/);
  await api.signOut();
  assert.equal(await api.getUser(), null);
  await assert.rejects(api.signIn("a@example.com", "wrong-pass"), /don't match/);
  await api.signIn("a@example.com", "secret1");
  assert.ok(await api.getUser());
});

test("nickname rules match the database", async () => {
  await api.signUp("b@example.com", "secret1");
  const p = { avatar_color: "pink", show_on_leaderboard: true, show_spindex: true };
  await assert.rejects(api.saveProfile({ ...p, display_name: "x" }), /2–20 characters/);
  await assert.rejects(api.saveProfile({ ...p, display_name: "Shit Talker" }), /different nickname/);
  const saved = await api.saveProfile({ ...p, display_name: "  Spin   Doctor " });
  assert.equal(saved.display_name, "Spin Doctor");
  const me = await api.getMe();
  assert.equal(me.profile?.display_name, "Spin Doctor");
});

test("timer: one active session, idempotent start, too-short stop, idempotent stop", async () => {
  await signedInWithProfile();
  await assert.rejects(api.logSession({ played_on: today, minutes: 0, client_request_id: rid() }), /Enter between 5 and 180/);
  const key = rid();
  const a = await api.startSession(key);
  assert.equal(a.status, "active");
  const again = await api.startSession(key);
  assert.equal(again.id, a.id, "same client_request_id returns the same session");
  await assert.rejects(api.startSession(rid()), /already have a session running/);
  await assert.rejects(api.logSession({ played_on: today, minutes: 30, client_request_id: rid() }), /Finish your running session first/);
  const stopped = await api.stopSession(a.id);
  assert.equal(stopped.status, "cancelled");
  assert.ok(stopped.flags.includes("too_short"));
  const second = await api.stopSession(a.id);
  assert.equal(second.status, "cancelled");
  assert.equal(second.minutes, 0, "second stop changes nothing");
});

test("log past play: limits, backdating, duplicates and the daily cap", async () => {
  await signedInWithProfile();
  await assert.rejects(api.logSession({ played_on: today, minutes: 181, client_request_id: rid() }), /Enter between 5 and 180/);
  await assert.rejects(api.logSession({ played_on: addDays(today, 1), minutes: 60, client_request_id: rid() }), /in the future/);
  await assert.rejects(api.logSession({ played_on: addDays(today, -8), minutes: 60, client_request_id: rid() }), /last 7 days/);
  const key = rid();
  const first = await api.logSession({ played_on: addDays(today, -1), minutes: 60, note: "Doubles", client_request_id: key });
  assert.equal(first.status, "pending");
  assert.equal(first.method, "manual");
  assert.equal(first.played_on, addDays(today, -1));
  const retry = await api.logSession({ played_on: addDays(today, -1), minutes: 60, client_request_id: key });
  assert.equal(retry.id, first.id, "retrying the same request doesn't double count");
  await assert.rejects(api.logSession({ played_on: addDays(today, -1), minutes: 60, client_request_id: rid() }), /already logged 60 minutes/);
  await api.logSession({ played_on: addDays(today, -1), minutes: 180, client_request_id: rid() });
  await assert.rejects(
    api.logSession({ played_on: addDays(today, -1), minutes: 90, client_request_id: rid() }),
    /more than 300 minutes in one day/,
  );
  const history = await api.mySessions();
  assert.equal(history.length, 2);
});

test("pending minutes show on the community board only; sample players are labeled", async () => {
  await signedInWithProfile("Board Tester");
  await api.logSession({ played_on: today, minutes: 45, client_request_id: rid() });
  const verified = await api.leaderboard("minutes", "week", "verified");
  const community = await api.leaderboard("minutes", "week", "community");
  assert.ok(!verified.some((r) => r.is_me), "self-reported time isn't verified");
  const me = community.find((r) => r.is_me);
  assert.ok(me, "self-reported time appears in community scope");
  assert.equal(me.value, 45);
  for (const r of [...verified, ...community].filter((x) => !x.is_me)) {
    assert.match(r.display_name, /^Sample · /, "every non-user row is labeled as sample data");
  }
  const ranks = community.map((r) => r.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  const stats = (await api.getMe()).stats;
  assert.equal(stats?.week_pending, 45);
  assert.equal(stats?.rank_week_verified, null);
  assert.equal(stats?.rank_week_community, me.rank);
});

test("hiding from public boards keeps personal stats", async () => {
  await signedInWithProfile("Private Pat");
  await api.logSession({ played_on: today, minutes: 30, client_request_id: rid() });
  await api.saveProfile({ display_name: "Private Pat", avatar_color: "blue", show_on_leaderboard: false, show_spindex: true });
  const community = await api.leaderboard("minutes", "week", "community");
  assert.ok(!community.some((r) => r.is_me));
  const display = await api.displayData();
  assert.ok(!JSON.stringify(display).includes("Private Pat"));
  assert.equal((await api.getMe()).stats?.week_pending, 30);
});

test("crews: create, invite rules, sample crew join, leave", async () => {
  await signedInWithProfile();
  await assert.rejects(api.createCrew("ab"), /3–24 characters/);
  await api.createCrew("Paddle Pals");
  let crew = await api.myCrew("week", "community");
  assert.equal(crew?.name, "Paddle Pals");
  assert.equal(crew?.is_owner, true);
  assert.equal(crew?.rank, null, "a one-person crew isn't ranked yet");
  await assert.rejects(api.createCrew("Second Crew"), /Leave your current crew first/);
  await assert.rejects(api.joinCrew("DEMO2027"), /already in a crew/);
  await api.leaveCrew();
  assert.equal(await api.myCrew("week", "community"), null);
  await assert.rejects(api.joinCrew("NOPE0000"), /didn't work/);
  const preview = await api.previewCrew("demo-2027");
  assert.equal(preview?.name, "Sample · Spin Doctors");
  await api.joinCrew("demo2027");
  crew = await api.myCrew("week", "community");
  assert.equal(crew?.members.length, 4);
  assert.equal(crew?.is_owner, false);
  await assert.rejects(api.renameCrew("New Name"), /Only the crew owner/);
});

test("SPINDEX is range-checked and always self-reported in demo", async () => {
  await signedInWithProfile("Rated Riley");
  await assert.rejects(api.submitSpindex(4000), /0 to 3000/);
  await api.submitSpindex(1450, "From the SPINDEX app");
  const me = await api.getMe();
  assert.equal(me.spindex?.status, "unverified");
  assert.equal(me.spindex?.source, "self_reported");
  const verified = await api.leaderboard("spindex", "all", "verified");
  assert.ok(!verified.some((r) => r.is_me));
  const community = await api.leaderboard("spindex", "all", "community");
  assert.equal(community.find((r) => r.is_me)?.detail, "self_reported");
});

test("achievements: ten codes with progress", async () => {
  await signedInWithProfile();
  await api.logSession({ played_on: today, minutes: 75, client_request_id: rid() });
  const list = await api.achievements();
  assert.equal(list.length, 10);
  const byCode = Object.fromEntries(list.map((a) => [a.code, a]));
  assert.ok(byCode.first_session.earned_at);
  assert.ok(byCode.first_hour.earned_at);
  assert.equal(byCode.minutes_300.progress, 75);
  assert.equal(byCode.minutes_300.earned_at, null);
  assert.equal(byCode.first_verified.progress, 0, "demo has no staff approvals");
});

test("staff tools are unavailable in demo mode", async () => {
  await assert.rejects(api.admin.analytics(), /Staff tools need the live database/);
});

test("delete account wipes the demo user", async () => {
  await signedInWithProfile();
  await api.deleteAccount();
  assert.equal(await api.getUser(), null);
  await assert.rejects(api.signIn("player@example.com", "secret1"), /don't match/);
});
