import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { api, errorText } from "../lib/api";
import { navigate } from "../lib/router";
import { KEYS, store } from "../lib/storage";
import type { CrewPreview } from "../lib/types";
import { useApp } from "../state";
import { Button, EmptyState, InlineError, Skeleton, useToast } from "../components/ui";

export default function JoinCrew({ code }: { code: string }) {
  const { me, refresh, bump } = useApp();
  const toast = useToast();
  const [preview, setPreview] = useState<CrewPreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    store.remove(KEYS.invite);
    void api
      .previewCrew(code)
      .then(setPreview)
      .catch((err) => {
        setError(errorText(err));
        setPreview(null);
      });
  }, [code]);

  const done = () => navigate("/crew", { replace: true });

  if (preview === undefined)
    return (
      <div className="page">
        <Skeleton count={2} height={120} />
      </div>
    );
  if (!preview)
    return (
      <div className="page">
        <EmptyState
          icon={<Users size={24} />}
          title="That invite didn't work"
          text={error || "The code may have changed. Ask your friend for a new link or code."}
          action={
            <Button variant="primary" onClick={done}>
              Go to Crews
            </Button>
          }
        />
      </div>
    );

  const full = preview.members >= preview.max_members;
  const already = me.crew?.name === preview.name;
  return (
    <div className="page">
      <div className="page-title">
        <div className="eyebrow" style={{ color: "var(--pink)" }}>
          Crew invite
        </div>
        <h1>{preview.name}</h1>
        <p>
          {preview.members}/{preview.max_members} members
        </p>
      </div>
      {already ? (
        <div className="panel stack">
          <p>You're already in this crew.</p>
          <Button variant="primary" size="lg" block onClick={done}>
            Open crew
          </Button>
        </div>
      ) : me.crew ? (
        <div className="panel stack">
          <p>
            You're in <strong>{me.crew.name}</strong>. Leave it first on the Crew tab to join {preview.name}.
          </p>
          <Button variant="secondary" size="lg" block onClick={done}>
            Go to my crew
          </Button>
        </div>
      ) : full ? (
        <div className="panel stack">
          <p>This crew is full. Ask the owner to make room, or start your own.</p>
          <Button variant="secondary" size="lg" block onClick={done}>
            Go to Crews
          </Button>
        </div>
      ) : (
        <div className="stack">
          <p className="small-print">Your minutes from now on count toward {preview.name}. Past play stays yours.</p>
          {error && <InlineError>{error}</InlineError>}
          <Button
            variant="primary"
            size="xl"
            block
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api.joinCrew(code);
                toast(`You joined ${preview.name}!`);
                await refresh();
                bump();
                done();
              } catch (err) {
                setError(errorText(err));
                setBusy(false);
              }
            }}
          >
            Join crew
          </Button>
          <Button variant="ghost" onClick={done}>
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}
