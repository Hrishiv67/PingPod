import { useState } from "react";
import { Download } from "lucide-react";
import { api, errorText, type ExportKind } from "../lib/api";
import type { Analytics as AnalyticsData, WeeklyRow } from "../lib/types";
import { Button, InlineError, ProgressBar, Skeleton, useToast } from "../components/ui";
import { formatDateTime, formatDay, formatNumber, venueDate } from "../lib/time";
import { Note, SectionHead, downloadText, toCsv, useLoad } from "./shared";

const PLAYER_GOAL = 20;
const CREW_GOAL = 4;

export default function Analytics() {
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

  return (
    <section className="adm-section">
      <SectionHead
        title="Analytics"
        sub={data ? `Updated ${formatDateTime(data.generated_at)}${data.pilot_start ? ` · pilot from ${formatDay(data.pilot_start)}` : ""}` : "Pilot participation at a glance."}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void reload()} loading={loading && !!data}>
            Refresh
          </Button>
        }
      />
      {loading && !data ? (
        <Skeleton height={96} count={4} />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : data ? (
        <Body data={data} />
      ) : null}

      <div className="adm-export">
        <h2>Export CSV</h2>
        <p className="adm-small adm-muted">
          Exports use pseudonymous player codes (like P3f9a12c0) — no names, emails or notes.
        </p>
        <div className="adm-actions">
          <Button icon={<Download size={16} />} loading={exporting === "weekly"} onClick={() => void exportCsv("weekly")}>
            Weekly totals
          </Button>
          <Button icon={<Download size={16} />} loading={exporting === "players"} onClick={() => void exportCsv("players")}>
            Per-player totals
          </Button>
          <Button icon={<Download size={16} />} loading={exporting === "sessions"} onClick={() => void exportCsv("sessions")}>
            Session rows
          </Button>
        </div>
      </div>
    </section>
  );
}

function Body({ data }: { data: AnalyticsData }) {
  const timerShare = data.sessions.counted ? Math.round((data.sessions.timer / data.sessions.counted) * 100) : 0;
  return (
    <>
      <div className="adm-kpis">
        <Kpi label="Registered players" value={data.registered_players} goal={PLAYER_GOAL} foot={`${data.accounts} accounts total`} />
        <Kpi label="Players with a session" value={data.players_with_session} goal={PLAYER_GOAL} />
        <Kpi label="Repeat players" value={data.repeat_players_weeks} foot={`2+ weeks · ${data.repeat_players_days} on 2+ days`} />
        <Kpi label="Sessions" value={data.sessions.counted} foot={`${data.sessions.approved} approved · ${data.sessions.pending} pending · ${data.sessions.rejected} rejected`} />
        <Kpi label="Approved minutes" value={data.minutes.approved} foot={`${formatNumber(data.minutes.pending)} pending`} />
        <Kpi label="Active crews" value={data.crews.eligible} goal={CREW_GOAL} foot={`${data.crews.active_this_week} with play this week · ${data.crews.total} created`} />
        <Kpi
          label="Timer vs logged"
          value={`${timerShare}%`}
          foot={`${data.sessions.timer} live timer · ${data.sessions.manual} logged later${data.sessions.auto_closed ? ` · ${data.sessions.auto_closed} auto-closed` : ""}`}
        />
        <Kpi label="Open requests" value={data.open_requests} foot={`SPINDEX: ${data.spindex.verified} verified · ${data.spindex.self_reported} self-reported`} />
      </div>
      {data.sessions.active_now > 0 && <p className="adm-small adm-muted">{data.sessions.active_now} playing right now.</p>}

      <Note>
        This is app activity: timers players started and time they logged, approved by staff. It doesn't independently prove
        someone visited PingPod Morrisville. Goals (20+ players, 4+ active crews) are targets, not results.
      </Note>

      {data.weekly.length > 0 && (
        <>
          <div className="adm-charts">
            <BarChart title="Active players per week" rows={data.weekly} pick={(w) => w.active_players} />
            <BarChart title="Approved minutes per week" rows={data.weekly} pick={(w) => w.approved_minutes} />
          </div>
          <WeeklyTable rows={data.weekly} />
        </>
      )}
    </>
  );
}

function Kpi({ label, value, goal, foot }: { label: string; value: number | string; goal?: number; foot?: string }) {
  const n = typeof value === "number" ? value : null;
  return (
    <div className="adm-kpi">
      <span className="adm-kpi-label">{label}</span>
      <strong className="num">
        {n == null ? value : formatNumber(n)}
        {goal != null && <small> / {goal}</small>}
      </strong>
      {goal != null && n != null && <ProgressBar value={n} max={goal} label={`${label} toward goal`} />}
      {foot && <span className="adm-kpi-foot">{foot}</span>}
    </div>
  );
}

function weekLabel(w: string) {
  return formatDay(w).replace(/^\w+, /, "");
}

function BarChart({ title, rows, pick }: { title: string; rows: WeeklyRow[]; pick: (w: WeeklyRow) => number }) {
  const shown = rows.slice(-8);
  const max = Math.max(1, ...shown.map(pick));
  return (
    <figure className="adm-chart">
      <figcaption>{title}</figcaption>
      <div className="adm-bars" role="img" aria-label={`${title}: ${shown.map((w) => `${weekLabel(w.week_start)} ${pick(w)}`).join(", ")}`}>
        {shown.map((w) => (
          <div key={w.week_start} className="adm-bar">
            <span className="adm-bar-value num">{formatNumber(pick(w))}</span>
            <span className="adm-bar-fill" style={{ height: `${Math.max(2, (pick(w) / max) * 100)}%` }} />
            <span className="adm-bar-label">{weekLabel(w.week_start)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

const COLS: { key: keyof WeeklyRow; label: string }[] = [
  { key: "active_players", label: "Active" },
  { key: "returning_players", label: "Returning" },
  { key: "new_signups", label: "New sign-ups" },
  { key: "sessions", label: "Sessions" },
  { key: "timer_sessions", label: "Timer" },
  { key: "manual_sessions", label: "Logged" },
  { key: "approved_minutes", label: "Approved min" },
  { key: "pending_minutes", label: "Pending min" },
  { key: "crews_with_play", label: "Crews playing" },
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
              <th key={c.key} scope="col">
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
                <td key={c.key} data-label={c.label} className="num">
                  {formatNumber(Number(w[c.key]))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
