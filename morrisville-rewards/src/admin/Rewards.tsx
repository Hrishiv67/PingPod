import { useState } from "react";
import { Gift, Plus } from "lucide-react";
import { api, errorText } from "../lib/api";
import type { Reward } from "../lib/types";
import { Button, Chip, EmptyState, InlineError, Sheet, Toggle, useToast } from "../components/ui";
import LogoLoader from "../components/LogoLoader";
import { formatDateTime } from "../lib/time";
import { Note, OwnerOnly, SectionHead, useLoad } from "./shared";

export default function Rewards({ isOwner, rewardsVisible }: { isOwner: boolean; rewardsVisible: boolean }) {
  const { data, error, loading, reload } = useLoad(() => api.admin.rewards(), []);
  const [editing, setEditing] = useState<Reward | "new" | null>(null);

  return (
    <section className="adm-section">
      <SectionHead
        title="Rewards"
        sub="Physical prizes, kept off until they're approved."
        actions={
          isOwner ? (
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing("new")}>
              New reward
            </Button>
          ) : undefined
        }
      />
      <Note tone="warn">
        <strong>Physical rewards stay off until Joe approves the terms.</strong> Don't promise free time, discounts or merch to
        anyone until then. A reward can only be turned on with an approval note (who approved it and how it's fulfilled).
      </Note>
      <p className="adm-small adm-muted">
        Rewards visible to players: <b className={rewardsVisible ? "adm-ok-text" : ""}>{rewardsVisible ? "On" : "Off"}</b> — the
        master switch lives in Settings. Players only see rewards that are on <em>and</em> when the master switch is on.
      </p>
      {!isOwner && <OwnerOnly>Only an owner can create or change rewards.</OwnerOnly>}

      {loading && !data ? (
        <LogoLoader label="Loading rewards" />
      ) : error ? (
        <InlineError onRetry={reload}>{error}</InlineError>
      ) : !data?.length ? (
        <EmptyState icon={<Gift />} title="No rewards yet" text="Nothing is promised to players. Add one here once the terms are approved." />
      ) : (
        <ul className="adm-list">
          {data.map((r) => (
            <li key={r.id} className="adm-card">
              <div className="adm-card-top">
                <div className="adm-card-title">
                  <strong>{r.title}</strong>
                  <span>Updated {formatDateTime(r.updated_at)}</span>
                </div>
                <Chip tone={r.enabled ? "ok" : "neutral"}>{r.enabled ? "On" : "Off"}</Chip>
              </div>
              {r.description && <p className="adm-message">{r.description}</p>}
              {r.criteria && <p className="adm-small">How to earn: {r.criteria}</p>}
              <p className="adm-small adm-muted">Approval: {r.approval_note || "not recorded"}</p>
              {isOwner && (
                <div className="adm-actions">
                  <Button size="sm" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <RewardSheet reward={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </section>
  );
}

function RewardSheet({ reward, onClose, onSaved }: { reward: Reward | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(reward?.title ?? "");
  const [description, setDescription] = useState(reward?.description ?? "");
  const [criteria, setCriteria] = useState(reward?.criteria ?? "");
  const [approval, setApproval] = useState(reward?.approval_note ?? "");
  const [enabled, setEnabled] = useState(reward?.enabled ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const canEnable = approval.trim().length >= 5;

  return (
    <Sheet title={reward ? "Edit reward" : "New reward"} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api.admin.saveReward({
              id: reward?.id ?? null,
              title,
              description,
              criteria,
              enabled: enabled && canEnable,
              approval_note: approval,
            });
            toast("Reward saved");
            onSaved();
            onClose();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="rw-title">Title</label>
          <input id="rw-title" className="input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
        </div>
        <div className="field">
          <label htmlFor="rw-desc">Description</label>
          <textarea id="rw-desc" className="input" maxLength={300} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rw-crit">How players earn it</label>
          <textarea
            id="rw-crit"
            className="input"
            maxLength={300}
            rows={2}
            placeholder="e.g. #1 on the verified weekly minutes board"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="rw-approval">Approval note</label>
          <textarea
            id="rw-approval"
            className="input"
            maxLength={300}
            rows={2}
            placeholder="e.g. Approved by Joe 12/1 — redeem at front desk, one per week"
            value={approval}
            onChange={(e) => setApproval(e.target.value)}
          />
          <div className="field-hint">Required before turning the reward on.</div>
        </div>
        <Toggle
          checked={enabled && canEnable}
          disabled={!canEnable}
          onChange={setEnabled}
          label="Reward is on"
          description={canEnable ? "Players see it when the master switch in Settings is on." : "Add an approval note first."}
        />
        {error && <InlineError>{error}</InlineError>}
        <div className="stack-sm">
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={title.trim().length < 3}>
            Save reward
          </Button>
          <Button type="button" variant="ghost" size="lg" block onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
