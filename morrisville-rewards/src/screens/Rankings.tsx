import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, Info, Trophy, Users } from "lucide-react";
import { api, errorText } from "../lib/api";
import { Link } from "../lib/router";
import { formatDay, formatNumber } from "../lib/time";
import type { BoardKey, CrewRow, LeaderRow, Period, Scope } from "../lib/types";
import { useApp } from "../state";
import { Avatar, Chip, EmptyState, InlineError, Segmented, Skeleton } from "../components/ui";

const BOARD_LABEL: Record<BoardKey, string> = {
  minutes: "Minutes",
  crews: "Crews",
  streaks: "Streaks",
  longest: "Longest session",
  spindex: "SPINDEX",
};
const ORDER: BoardKey[] = ["minutes", "crews", "streaks", "longest", "spindex"];
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
        const rows = await api.crewLeaderboard(period, scope, 50);
        if (n === ask.current) setCrews(rows);
      } else {
        const rows = await api.leaderboard(board, HAS_PERIOD.includes(board) ? period : "all", scope, 50);
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
              { value: "week", label: "This week" },
              { value: "month", label: "This month" },
              { value: "all", label: "All time" },
            ]}
          />
        )}
        {(board === "spindex" || board === "streaks") && (
          <p className="scope-note">
            <Info size={15} aria-hidden />
            <span>
              {board === "spindex"
                ? "Ratings players add on their profile. Staff-checked ones say Verified."
                : "Weeks in a row with at least one session."}
            </span>
          </p>
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
          <Skeleton count={5} height={60} />
        ) : (
          <CrewBoard rows={crews} minSize={me.settings.crew_min_size} />
        )
      ) : players === null ? (
        <Skeleton count={5} height={60} />
      ) : (
        <PlayerBoard rows={players} board={board} />
      )}
    </div>
  );
}

function valueOf(board: BoardKey, r: LeaderRow): { value: string; unit: string; sub: string } {
  switch (board) {
    case "streaks":
      return { value: String(r.value), unit: r.value === 1 ? "week" : "weeks", sub: `Best ${r.secondary ?? r.value} · ${r.sessions ?? 0} active weeks` };
    case "longest":
      return { value: formatNumber(r.value), unit: "min", sub: r.detail ? formatDay(r.detail) : "" };
    case "spindex":
      return { value: String(r.value), unit: "SPINDEX", sub: r.detail === "verified" ? "Verified by staff" : "Self-reported" };
    default:
      return { value: formatNumber(r.value), unit: "min", sub: `${r.sessions ?? 0} session${r.sessions === 1 ? "" : "s"}` };
  }
}

function PlayerBoard({ rows, board }: { rows: LeaderRow[]; board: BoardKey }) {
  if (!rows.length)
    return (
      <EmptyState
        icon={<Trophy size={24} />}
        title="Nobody's on the board yet"
        text={board === "spindex" ? "No ratings here yet. Add your SPINDEX on your profile." : "Log a session to be the first name up here."}
      />
    );
  const top = rows.filter((r) => r.rank <= 3);
  const rest = rows.filter((r) => r.rank > 3);
  return (
    <>
      <div className="podium" aria-label="Top three">
        {[top[1], top[0], top[2]].map((r, i) =>
          r ? (
            <div key={r.user_id} className={`podium-spot ${r.rank === 1 ? "first" : ""} ${r.is_me ? "me" : ""}`}>
              <span className="podium-rank num">#{r.rank}</span>
              <Avatar name={r.display_name} color={r.avatar_color} size={r.rank === 1 ? 52 : 44} />
              <span className="podium-name">{r.is_me ? "You" : r.display_name}</span>
              <span className="podium-value num">{valueOf(board, r).value}</span>
              <span className="podium-unit">{valueOf(board, r).unit}</span>
            </div>
          ) : (
            <div key={`empty-${i}`} aria-hidden />
          ),
        )}
      </div>
      {rest.length > 0 && (
        <div className="list" role="list">
          {rest.map((r, i) => {
            const v = valueOf(board, r);
            const gap = i > 0 && r.rank - rest[i - 1].rank > 1;
            return (
              <div key={r.user_id} role="listitem">
                {gap && <div className="rank-gap">…</div>}
                <div className={`rank-row ${r.is_me ? "me" : ""}`}>
                  <span className="rank-num num">{r.rank}</span>
                  <Avatar name={r.display_name} color={r.avatar_color} size={36} />
                  <span className="rank-name">
                    <strong>
                      {r.display_name} {r.is_me && <span className="you-tag">YOU</span>}
                    </strong>
                    <span>
                      {board === "spindex" ? <Chip tone={r.detail === "verified" ? "ok" : "neutral"}>{v.sub}</Chip> : v.sub}
                    </span>
                  </span>
                  <span className="rank-value num">
                    {v.value}
                    <small>{v.unit}</small>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function CrewBoard({ rows, minSize }: { rows: CrewRow[]; minSize: number }) {
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
  return (
    <>
      <div className="list" role="list">
        {rows.map((c) => (
          <div key={c.crew_id} role="listitem" className={`rank-row ${c.is_mine ? "me" : ""}`}>
            <span className="rank-num num">{c.rank}</span>
            <span className="crew-badge">
              <Users size={18} />
            </span>
            <span className="rank-name">
              <strong>
                {c.name} {c.is_mine && <span className="you-tag">YOUR CREW</span>}
              </strong>
              <span>
                {c.members} members · {formatNumber(c.avg_minutes)} min each
              </span>
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
