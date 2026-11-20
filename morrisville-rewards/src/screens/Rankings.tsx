import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, EyeOff, Trophy, Users } from "lucide-react";
import { api, errorText } from "../lib/api";
import { Link } from "../lib/router";
import { formatDay, formatNumber } from "../lib/time";
import type { BoardKey, CrewRow, LeaderRow, Period, Scope } from "../lib/types";
import { useApp } from "../state";
import { Avatar, Chip, EmptyState, InlineError, Segmented } from "../components/ui";
import LogoLoader from "../components/LogoLoader";
import CrewBadge from "../components/CrewBadge";
import PlayerCardSheet from "../components/PlayerCardSheet";
import { sameScore, tiePlaces } from "../lib/ranks";

const BOARD_LABEL: Record<BoardKey, string> = {
  minutes: "Minutes",
  crews: "Crews",
  streaks: "Streaks",
  longest: "Longest",
  spindex: "SPINDEX",
};
const ORDER: BoardKey[] = ["minutes", "spindex", "crews", "streaks", "longest"];
const HAS_PERIOD: BoardKey[] = ["minutes", "crews", "longest"];

export default function Rankings() {
  const { me, version } = useApp();
  const enabled = ORDER.filter((b) => me.settings.boards_enabled.includes(b));
  const [board, setBoard] = useState<BoardKey>(enabled[0] ?? "minutes");
  const [period, setPeriod] = useState<Period>("week");
  const scope: Scope = me.settings.default_board_scope;
  // Rows remember which board they belong to, so a tab switch never draws one board's rows as
  // another's (that used to crash SPINDEX → Longest, where "verified" was read as a date).
  const [loaded, setLoaded] = useState<{ key: string; rows: LeaderRow[] } | null>(null);
  const [loadedCrews, setLoadedCrews] = useState<{ key: string; rows: CrewRow[] } | null>(null);
  const [error, setError] = useState("");
  const ask = useRef(0);

  const load = useCallback(async () => {
    const n = ++ask.current;
    setError("");
    try {
      const key = `${board}|${HAS_PERIOD.includes(board) ? period : "all"}`;
      if (board === "crews") {
        const rows = await api.crewLeaderboard(period, scope, 200);
        if (n === ask.current) setLoadedCrews({ key, rows });
      } else {
        const rows = await api.leaderboard(board, HAS_PERIOD.includes(board) ? period : "all", scope, 200);
        if (n === ask.current) setLoaded({ key, rows });
      }
    } catch (err) {
      if (n === ask.current) setError(errorText(err));
    }
  }, [board, period, scope]);

  useEffect(() => {
    void load();
  }, [load, version]);
  const viewKey = `${board}|${HAS_PERIOD.includes(board) ? period : "all"}`;
  const players = loaded?.key === viewKey ? loaded.rows : null;
  const crews = loadedCrews?.key === viewKey ? loadedCrews.rows : null;

  // Live: refetch when anyone's standings change (debounced), and when returning to the app.
  useEffect(() => {
    let t: number | undefined;
    const kick = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void load(), 1500);
    };
    let off = () => {};
    try {
      off = api.subscribeBoards(kick);
    } catch {
      /* polling below still works */
    }
    const poll = window.setInterval(() => !document.hidden && void load(), 45_000);
    const vis = () => !document.hidden && void load();
    document.addEventListener("visibilitychange", vis);
    return () => {
      off();
      window.clearTimeout(t);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [load]);

  const hidden = !me.profile!.show_on_leaderboard || me.profile!.hidden_by_admin;

  return (
    <div className="page">
      <div className="page-title">
        <h1>Leaderboard</h1>
      </div>

      <div className="board-controls">
        <div className="board-tabs" role="tablist" aria-label="Leaderboard">
          {enabled.map((b) => (
            <button key={b} role="tab" className="board-tab" aria-selected={board === b} onClick={() => setBoard(b)}>
              {BOARD_LABEL[b]}
            </button>
          ))}
        </div>
        {HAS_PERIOD.includes(board) && (
          <Segmented<Period>
            label="Time period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "day", label: "Today" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "all", label: "All time" },
            ]}
          />
        )}
      </div>

      {hidden && board !== "crews" && (
        <div className="panel inline-note">
          <EyeOff size={16} aria-hidden />
          <span>
            You're hidden from public boards.{" "}
            <Link to="/me" className="link-btn" style={{ padding: 0, minHeight: 0 }}>
              Privacy settings
            </Link>
          </span>
        </div>
      )}

      {error ? (
        <InlineError onRetry={() => void load()}>{error}</InlineError>
      ) : board === "crews" ? (
        crews === null ? (
          <LogoLoader label="Loading leaderboard" />
        ) : (
          <CrewBoard rows={crews} minSize={me.settings.crew_min_size} hasCrew={Boolean(me.crew)} />
        )
      ) : players === null ? (
        <LogoLoader label="Loading leaderboard" />
      ) : (
        <PlayerBoard rows={players} board={board} hasSpindex={Boolean(me.spindex)} hidden={hidden} />
      )}
    </div>
  );
}

function valueOf(board: BoardKey, r: LeaderRow): { value: string; unit: string; sub: string } {
  switch (board) {
    case "streaks":
      return {
        value: String(r.value),
        unit: r.value === 1 ? "day" : "days",
        sub: r.secondary != null && r.secondary > r.value ? `Best ${r.secondary} days` : "",
      };
    case "longest":
      return { value: formatNumber(r.value), unit: "min", sub: r.detail ? formatDay(r.detail) : "" };
    case "spindex":
      return { value: String(r.value), unit: "SPINDEX", sub: r.detail === "verified" ? "Verified" : "Self-reported" };
    default:
      return { value: formatNumber(r.value), unit: "min", sub: `${r.sessions ?? 0} session${r.sessions === 1 ? "" : "s"}` };
  }
}

function AddSpindex() {
  return (
    <Link to="/me" className="panel spindex-prompt">
      <span>
        <strong>Add your SPINDEX</strong>
        <span>Your PingPod skill rating. It shows as self-reported until staff check it.</span>
      </span>
      <ChevronRight size={18} aria-hidden />
    </Link>
  );
}

/** Unit for a gap between two players ("15 min", "2 days", "40 points"). */
function gapText(board: BoardKey, n: number): string {
  if (board === "streaks") return `${n} ${n === 1 ? "day" : "days"}`;
  if (board === "spindex") return `${n} ${n === 1 ? "point" : "points"}`;
  return `${formatNumber(n)} min`;
}

const NOT_ON_BOARD: Record<Exclude<BoardKey, "crews">, string> = {
  minutes: "You're not on this board yet. Log a session to get ranked.",
  longest: "You're not on this board yet. Log a session to get ranked.",
  streaks: "Play on two days in a row to get on this board.",
  spindex: "",
};

/** Where you stand: your rank out of everyone, and how far from the next spot up. */
function YourSpot({ rows, places, board, onFind }: { rows: LeaderRow[]; places: number[]; board: BoardKey; onFind: () => void }) {
  const i = rows.findIndex((r) => r.is_me);
  if (i < 0) {
    const text = NOT_ON_BOARD[board as Exclude<BoardKey, "crews">];
    return text ? (
      <div className="your-spot empty">
        <span>{text}</span>
      </div>
    ) : null;
  }
  const me = rows[i];
  const v = valueOf(board, me);
  const tied = rows.filter((r, j) => j !== i && sameScore(board, r, me));
  let ahead = -1;
  for (let j = i - 1; j >= 0; j--)
    if (!sameScore(board, rows[j], me)) {
      ahead = j;
      break;
    }
  const behind = rows.findIndex((r, j) => j > i && !sameScore(board, r, me));
  const tiedText = tied.length ? `Tied with ${tied[0].display_name}${tied.length > 1 ? ` and ${tied.length - 1} more` : ""}` : "";
  let line: string;
  if (ahead >= 0) {
    const a = rows[ahead];
    line =
      board === "spindex" && a.detail === "verified" && me.detail !== "verified"
        ? "Verified ratings rank first. Get yours checked to move up."
        : `${gapText(board, a.value - me.value)} behind #${places[ahead]} ${a.display_name}`;
    if (tiedText) line = `${tiedText} · ${line}`;
  } else if (tiedText) {
    line = `${tiedText} for #${places[i]}`;
  } else if (behind >= 0) {
    line = `${gapText(board, me.value - rows[behind].value)} ahead of #${places[behind]} ${rows[behind].display_name}`;
  } else {
    line = "You're the only one on this board so far.";
  }
  return (
    <button type="button" className="your-spot" onClick={onFind}>
      <span className="your-spot-rank num">
        #{places[i]}
        <small>of {rows.length}</small>
      </span>
      <span className="your-spot-text">
        <strong className="num">
          {v.value}
          <small>{v.unit}</small>
        </strong>
        <span>{line}</span>
      </span>
      <span className="your-spot-find">Find me</span>
    </button>
  );
}

function scrollToMe() {
  const el = document.getElementById("rank-me");
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

function PlayerBoard({ rows, board, hasSpindex, hidden }: { rows: LeaderRow[]; board: BoardKey; hasSpindex: boolean; hidden: boolean }) {
  const [open, setOpen] = useState<LeaderRow | null>(null);
  const prompt = board === "spindex" && !hasSpindex ? <AddSpindex /> : null;
  if (!rows.length)
    return (
      <>
        {prompt}
        <EmptyState
          icon={<Trophy size={24} />}
          title="Nobody's on the board yet"
          text={board === "spindex" ? "Be the first rating on the SPINDEX board." : "Log a session to be the first name up here."}
        />
      </>
    );
  const places = tiePlaces(board, rows);
  const verifiedCount = board === "spindex" ? rows.filter((r) => r.detail === "verified").length : 0;
  return (
    <>
      {prompt}
      {!hidden && <YourSpot rows={rows} places={places} board={board} onFind={scrollToMe} />}
      <div className="list" role="list">
        {rows.map((r, i) => {
          const v = valueOf(board, r);
          const gap = i > 0 && r.rank - rows[i - 1].rank > 1;
          const place = places[i];
          // SPINDEX: staff-verified ratings first, then self-reported ones, each under its own heading.
          const heading =
            board === "spindex" && (i === 0 || rows[i - 1].detail !== r.detail)
              ? r.detail === "verified"
                ? "Verified by staff"
                : verifiedCount
                  ? "Self-reported"
                  : null
              : null;
          return (
            <div key={r.user_id} role="listitem">
              {heading && <div className="rank-heading">{heading}</div>}
              {gap && <div className="rank-gap">…</div>}
              <button
                type="button"
                id={r.is_me ? "rank-me" : undefined}
                className={`rank-row tappable ${place <= 3 ? `top top-${place}` : ""} ${r.is_me ? "me" : ""}`}
                onClick={() => setOpen(r)}
              >
                <span className="rank-num num">{place}</span>
                <Avatar name={r.display_name} color={r.avatar_color} path={r.avatar_path} size={38} />
                <span className="rank-name">
                  <strong>
                    {r.display_name} {r.is_me && <span className="you-tag">YOU</span>}
                  </strong>
                  {v.sub && (
                    <span>
                      {board === "spindex" ? <Chip tone={r.detail === "verified" ? "ok" : "neutral"}>{v.sub}</Chip> : v.sub}
                    </span>
                  )}
                </span>
                <span className="rank-value num">
                  {v.value}
                  <small>{v.unit}</small>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {open && <PlayerCardSheet userId={open.user_id} name={open.display_name} onClose={() => setOpen(null)} />}
    </>
  );
}

function CrewBoard({ rows, minSize, hasCrew }: { rows: CrewRow[]; minSize: number; hasCrew: boolean }) {
  if (!rows.length)
    return (
      <EmptyState
        icon={<Users size={24} />}
        title="No crews on the board yet"
        text={`Crews need at least ${minSize} members to rank. Start one and invite a friend.`}
        action={
          <Link to="/crew" className="btn btn-primary btn-md" style={{ textDecoration: "none" }}>
            Start a crew
          </Link>
        }
      />
    );
  const places = tiePlaces("crews", rows.map((c) => ({ rank: c.rank, value: c.minutes })));
  const mi = rows.findIndex((c) => c.is_mine);
  const mine = mi >= 0 ? rows[mi] : undefined;
  const tied = mine ? rows.find((c) => c !== mine && c.minutes === mine.minutes) : undefined;
  const aboveIdx = mine ? rows.map((c) => c.minutes > mine.minutes).lastIndexOf(true) : -1;
  const above = aboveIdx >= 0 ? rows[aboveIdx] : undefined;
  const belowIdx = mine ? rows.findIndex((c) => c.minutes < mine.minutes) : -1;
  const below = belowIdx >= 0 ? rows[belowIdx] : undefined;
  return (
    <>
      {mine ? (
        <button type="button" className="your-spot" onClick={scrollToMe}>
          <span className="your-spot-rank num">
            #{places[mi]}
            <small>of {rows.length}</small>
          </span>
          <span className="your-spot-text">
            <strong>{mine.name}</strong>
            <span>
              {[
                tied ? `Tied with ${tied.name}` : "",
                above
                  ? `${formatNumber(above.minutes - mine.minutes)} min behind #${places[aboveIdx]} ${above.name}`
                  : !tied && below
                    ? `${formatNumber(mine.minutes - below.minutes)} min ahead of #${places[belowIdx]} ${below.name}`
                    : "",
              ]
                .filter(Boolean)
                .join(" · ") || "The only crew on the board so far."}
            </span>
          </span>
          <span className="your-spot-find">Find us</span>
        </button>
      ) : (
        <div className="your-spot empty">
          <span>{hasCrew ? `Your crew shows up here once it has ${minSize}+ members.` : "Join or start a crew to compete together."}</span>
        </div>
      )}
      <div className="list" role="list">
        {rows.map((c, i) => (
          <div
            key={c.crew_id}
            id={c.is_mine ? "rank-me" : undefined}
            role="listitem"
            className={`rank-row ${places[i] <= 3 ? `top top-${places[i]}` : ""} ${c.is_mine ? "me" : ""}`}
          >
            <span className="rank-num num">{places[i]}</span>
            <CrewBadge emblem={c.emblem} color={c.color} size={38} />
            <span className="rank-name">
              <strong>
                {c.name} {c.is_mine && <span className="you-tag">YOUR CREW</span>}
              </strong>
              <span>{c.motto || `${c.members} members · ${formatNumber(c.avg_minutes)} min each`}</span>
            </span>
            <span className="rank-value num">
              {formatNumber(c.minutes)}
              <small>min</small>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
