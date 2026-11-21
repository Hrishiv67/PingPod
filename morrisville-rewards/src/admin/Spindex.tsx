import { useState } from "react";
import { Gauge } from "lucide-react";
import { api } from "../lib/api";
import type { AdminSpindex } from "../lib/types";
import { Avatar, Button, Chip, ConfirmSheet, EmptyState, InlineError, useToast } from "../components/ui";
import LogoLoader from "../components/LogoLoader";
import { formatDateTime } from "../lib/time";
import { ActionSheet, FilterChips, SectionHead, useLoad } from "./shared";

type Filter = "unverified" | "verified" | "rejected" | "all";
type SheetState = { kind: "verify" | "reject" | "unverify"; r: AdminSpindex } | null;

export default function Spindex({ myId, onChanged }: { myId: string; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>("unverified");
  const { data, error, loading, reload } = useLoad(() => api.admin.spindex(filter), [filter]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const toast = useToast();

  const done = (text: string) => {
    toast(text);
    void reload();
    onChanged();
  };

  return (
    <section className="adm-section">
      <SectionHead
        title="SPINDEX ratings"
        sub="Players add these themselves. Verify one only after they show you the rating in the SPINDEX app."
      />
      <div className="adm-toolbar">
        <FilterChips<Filter>
          label="Rating status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "unverified", label: "Self-reported" },
            { value: "verified", label: "Verified" },
            { value: "rejected", label: "Declined" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      {loading && !data ? (
        <LogoLoader label="Loading ratings" />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !data?.length ? (
        <EmptyState
          icon={<Gauge />}
          title={filter === "unverified" ? "Nothing waiting" : "No ratings here"}
          text={filter === "unverified" ? "Self-reported ratings appear here when players add them." : undefined}
        />
      ) : (
        <ul className="adm-list">
          {data.map((r) => {
            const own = r.user_id === myId;
            return (
              <li key={r.id} className="adm-card">
                <div className="adm-card-top">
                  <Avatar name={r.display_name} size={36} />
                  <div className="adm-card-title">
                    <strong>{r.display_name}</strong>
                    <span>Added {formatDateTime(r.created_at)}</span>
                  </div>
                  <span className="adm-rating num">{r.rating}</span>
                </div>
                <div className="adm-meta">
                  {r.status === "verified" ? (
                    <Chip tone="ok">Verified by staff</Chip>
                  ) : r.status === "rejected" ? (
                    <Chip tone="bad">Declined</Chip>
                  ) : r.status === "superseded" ? (
                    <Chip>Replaced</Chip>
                  ) : (
                    <Chip tone="warn">Self-reported</Chip>
                  )}
                </div>
                {r.player_note && <blockquote className="adm-quote">“{r.player_note}”</blockquote>}
                {r.verified_at && (
                  <p className="adm-muted adm-small">
                    {r.status === "rejected" ? "Rejected" : "Verified"} {formatDateTime(r.verified_at)}
                    {r.verified_by_name ? ` by ${r.verified_by_name}` : ""}
                    {r.verification_source ? ` — ${r.verification_source}` : ""}
                  </p>
                )}
                {own ? (
                  <p className="adm-muted adm-small">Your own rating — another staff member must verify it.</p>
                ) : r.status === "unverified" ? (
                  <div className="adm-actions">
                    <Button size="sm" variant="primary" onClick={() => setSheet({ kind: "verify", r })}>
                      Verify
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setSheet({ kind: "reject", r })}>
                      Decline
                    </Button>
                  </div>
                ) : r.status === "verified" ? (
                  <div className="adm-actions">
                    <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "unverify", r })}>
                      Undo verification
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {sheet?.kind === "verify" && (
        <ActionSheet
          title={`Verify ${sheet.r.rating}`}
          description={<p>{sheet.r.display_name}'s rating will show as Verified on their profile and the SPINDEX board.</p>}
          confirmLabel="Verify rating"
          text={{
            label: "How did you verify?",
            required: true,
            placeholder: "e.g. Saw SPINDEX app at front desk 11/20",
            hint: "Saved with the rating and in the activity log.",
          }}
          onSubmit={async (_m, source) => {
            await api.admin.reviewSpindex(sheet.r.id, "verify", source);
            done("Rating verified");
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "reject" && (
        <ActionSheet
          title="Decline rating"
          danger
          description={<p>The rating comes off {sheet.r.display_name}'s profile and every board. They can add a new one.</p>}
          confirmLabel="Decline"
          text={{ label: "Note", required: false, placeholder: "e.g. Couldn't confirm; asked them to show the app next visit" }}
          onSubmit={async (_m, note) => {
            await api.admin.reviewSpindex(sheet.r.id, "reject", note);
            done("Rating rejected");
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "unverify" && (
        <ConfirmSheet
          title="Undo verification?"
          body={<p>{sheet.r.display_name}'s rating goes back to Self-reported.</p>}
          confirmLabel="Undo verification"
          onConfirm={async () => {
            await api.admin.reviewSpindex(sheet.r.id, "unverify");
            done("Verification removed");
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}
