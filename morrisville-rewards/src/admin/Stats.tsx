import { useState } from "react";
import { Download } from "lucide-react";
import { api, errorText, type ExportKind } from "../lib/api";
import type { Analytics, WeeklyRow } from "../lib/types";
import { Button, InlineError, ProgressBar, Skeleton, useToast } from "../components/ui";
import { formatDay, formatNumber, venueDate } from "../lib/time";
import { SectionHead, downloadText, toCsv, useLoad } from "./shared";

const PLAYER_GOAL = 20;
const CREW_GOAL = 4;

const EXPORTS: { kind: ExportKind; label: string; text: string }[] = [
  { kind: "weekly", label: "Weekly summary", text: "One row per week: players, sessions, minutes." },
  { kind: "players", label: "Players", text: "One row per player, with anonymous codes instead of names." },
  { kind: "sessions", label: "Sessions", text: "Every session, with anonymous codes instead of names." },
];

export default function Stats() {
  const { data, error, loading, reload } = useLoad(() => api.admin.analytics(), []);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const toast = useToast();

  async function exportCsv(kind: ExportKind) {
    setExporting(kind);
    try {
      const rows = await api.admin.exportRows(kind);
      if (!rows.length) {
        toast("Nothing to export yet", "bad");
        return;
      }
      downloadText(`pingpod-morrisville-${kind}-${venueDate()}.csv`, toCsv(rows));
      toast(`Downloaded ${rows.length} rows`);
    } catch (err) {
      toast(errorText(err), "bad");
    } finally {
      setExporting(null);
    }
  }

  const pilot =
    data?.pilot_start && data?.pilot_end ? `Pilot ${formatDay(data.pilot_start)} – ${formatDay(data.pilot_end)}` : undefined;

  return (
    <section className="adm-section">
      <SectionHead
        title="Stats"
        sub={pilot}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void reload()} loading={loading && !!data}>
            Refresh
          </Button>
        }
      />
      {loading && !data ? (
        <Skeleton height={96} count={3} />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : data ? (
        <Body data={data} />
      ) : null}

      <div className="adm-export">
        <h2>Download CSV</h2>
        <ul className="adm-rows">
          {EXPORTS.map((e) => (
            <li key={e.kind} className="adm-row adm-row-export">
              <div className="adm-row-main">
                <strong>{e.label}</strong>
                <span className="adm-row-meta">{e.text}</span>
              </div>
              <div className="adm-row-actions">
                <Button size="sm" icon={<Download size={16} />} loading={exporting === e.kind} onClick={() => void exportCsv(e.kind)}>
                  Download
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Body({ data }: { data: Analytics }) {
  const minutes = data.minutes.approved + data.minutes.pending;
  const timerShare = data.sessions.counted ? Math.round((data.sessions.timer / data.sessions.counted) * 100) : 0;
  return (
    <>
      <div className="adm-kpis">
        <Kpi label="Signed up" value={data.registered_players} goal={PLAYER_GOAL} />
        <Kpi label="Played at least once" value={data.players_with_session} goal={PLAYER_GOAL} />
        <Kpi label="Came back" value={data.repeat_players_weeks} foot="Played in 2 or more weeks" />
        <Kpi label="Sessions" value={data.sessions.counted} foot={data.sessions.counted ? `${timerShare}% used the timer` : undefined} />
        <Kpi label="Minutes played" value={minutes} />
        <Kpi label="Active crews" value={data.crews.eligible} goal={CREW_GOAL} foot={`${data.crews.active_this_week} played this week`} />
      </div>
      <p className="adm-fine">Counts come from timers and logged sessions in the app. They don't prove someone visited.</p>
      {data.weekly.length > 0 && <WeeklyTable rows={data.weekly} />}
    </>
  );
}

function Kpi({ label, value, goal, foot }: { label: string; value: number; goal?: number; foot?: string }) {
  return (
    <div className="adm-kpi">
      <span className="adm-kpi-label">{label}</span>
      <strong className="num">
        {formatNumber(value)}
        {goal != null && <small> / {goal}</small>}
      </strong>
      {goal != null && <ProgressBar value={value} max={goal} label={`${label} toward the goal of ${goal}`} />}
      {foot && <span className="adm-kpi-foot">{foot}</span>}
    </div>
  );
}

const COLS: { label: string; pick: (w: WeeklyRow) => number }[] = [
  { label: "Players", pick: (w) => w.active_players },
  { label: "Returning", pick: (w) => w.returning_players },
  { label: "New", pick: (w) => w.new_signups },
  { label: "Sessions", pick: (w) => w.sessions },
  { label: "Minutes", pick: (w) => w.approved_minutes + w.pending_minutes },
  { label: "Crews", pick: (w) => w.crews_with_play },
];

function WeeklyTable({ rows }: { rows: WeeklyRow[] }) {
  return (
    <div className="adm-table-wrap">
      <h2>By week</h2>
      <table className="adm-table">
        <thead>
          <tr>
            <th scope="col">Week of</th>
            {COLS.map((c) => (
              <th key={c.label} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((w) => (
            <tr key={w.week_start}>
              <th scope="row">{formatDay(w.week_start)}</th>
              {COLS.map((c) => (
                <td key={c.label} data-label={c.label} className="num">
                  {formatNumber(c.pick(w))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
