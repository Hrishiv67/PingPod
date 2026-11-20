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
  const [players, setPlayers] = useState<LeaderRow[] | null>(null);
  const [crews, setCrews] = useState<CrewRow[] | null>(null);
  const [error, setError] = useState("");
  const ask = useRef(0);

  const load = useCallback(async () => {
    const n = ++ask.current;
    setError("");
    try {
      if (board === "crews") {
        const rows = await api.crewLeaderboard(period, scope, 200);
        if (n === ask.current) setCrews(rows);
      } else {
        const rows = await api.leaderboard(board, HAS_PERIOD.includes(board) ? period : "all", scope, 200);
        if (n === ask.current) setPlayers(rows);
      }
    } catch (err) {
      if (n === ask.current) setError(errorText(err));
    }
  }, [board, period, scope]);

  useEffect(() => {
    setPlayers(null);
    setCrews(null);
    void load();
  }, [load, version]);

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
      return { value: String(r.value), unit: "SPINDEX", sub: r.detail === "verified" ? "Verified" : "" };
    default:
      return { value: formatNumber(r.value), unit: "min", sub: `${r.sessions ?? 0} session${r.sessions === 1 ? "" : "s"}` };
  }
}

function AddSpindex() {
  return (
    <Link to="/me" className="panel spindex-prompt">
      <span>
        <strong>Add your SPINDEX</strong>
        <span>Put your rating on this board. It takes a few seconds.</span>
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
function YourSpot({ rows, board, onFind }: { rows: LeaderRow[]; board: BoardKey; onFind: () => void }) {
  const me = rows.find((r) => r.is_me);
  if (!me) {
    const text = NOT_ON_BOARD[board as Exclude<BoardKey, "crews">];
    return text ? (
      <div className="your-spot empty">
        <span>{text}</span>
      </div>
    ) : null;
  }
  const above = rows.find((r) => r.rank === me.rank - 1);
  const below = rows.find((r) => r.rank === me.rank + 1);
  const v = valueOf(board, me);
  let line: string;
  if (above) {
    const gap = above.value - me.value;
    line = gap > 0 ? `${gapText(board, gap)} behind #${above.rank} ${above.display_name}` : `Tied with #${above.rank} ${above.display_name}`;
  } else if (below) {
    const lead = me.value - below.value;
    line = lead > 0 ? `${gapText(board, lead)} ahead of #2 ${below.display_name}` : `Tied with ${below.display_name}`;
  } else {
    line = "You're the only one on this board so far.";
  }
  return (
    <button type="button" className="your-spot" onClick={onFind}>
      <span className="your-spot-rank num">
        #{me.rank}
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
  return (
    <>
      {prompt}
      {!hidden && <YourSpot rows={rows} board={board} onFind={scrollToMe} />}
      <div className="list" role="list">
        {rows.map((r, i) => {
          const v = valueOf(board, r);
          const gap = i > 0 && r.rank - rows[i - 1].rank > 1;
          return (
            <div key={r.user_id} role="listitem">
              {gap && <div className="rank-gap">…</div>}
              <button
                type="button"
                id={r.is_me ? "rank-me" : undefined}
                className={`rank-row tappable ${r.rank <= 3 ? `top top-${r.rank}` : ""} ${r.is_me ? "me" : ""}`}
                onClick={() => setOpen(r)}
              >
                <span className="rank-num num">{r.rank}</span>
                <Avatar name={r.display_name} color={r.avatar_color} path={r.avatar_path} size={38} />
                <span className="rank-name">
                  <strong>
                    {r.display_name} {r.is_me && <span className="you-tag">YOU</span>}
                  </strong>
                  {v.sub && (
                    <span>
                      {board === "spindex" ? <Chip tone="ok">{v.sub}</Chip> : v.sub}
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
  const mine = rows.find((c) => c.is_mine);
  const above = mine ? rows.find((c) => c.rank === mine.rank - 1) : undefined;
  const below = mine ? rows.find((c) => c.rank === mine.rank + 1) : undefined;
  return (
    <>
      {mine ? (
        <button type="button" className="your-spot" onClick={scrollToMe}>
          <span className="your-spot-rank num">
            #{mine.rank}
            <small>of {rows.length}</small>
          </span>
          <span className="your-spot-text">
            <strong>{mine.name}</strong>
            <span>
              {above
                ? above.minutes > mine.minutes
                  ? `${formatNumber(above.minutes - mine.minutes)} min behind #${above.rank} ${above.name}`
                  : `Tied with #${above.rank} ${above.name}`
                : below
                  ? `${formatNumber(mine.minutes - below.minutes)} min ahead of #2 ${below.name}`
                  : "The only crew on the board so far."}
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
        {rows.map((c) => (
          <div
            key={c.crew_id}
            id={c.is_mine ? "rank-me" : undefined}
            role="listitem"
            className={`rank-row ${c.rank <= 3 ? `top top-${c.rank}` : ""} ${c.is_mine ? "me" : ""}`}
          >
            <span className="rank-num num">{c.rank}</span>
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
