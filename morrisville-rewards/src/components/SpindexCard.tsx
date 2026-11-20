import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state";
import { Button, ConfirmSheet, useToast } from "./ui";
import SpindexSheet from "./SpindexSheet";

/** Your SPINDEX on Home: one big number with Update / Remove (or a quick Add). Just for fun. */
export default function SpindexCard() {
  const { me, refresh, bump } = useApp();
  const toast = useToast();
  const claim = me.spindex ?? null;
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  return (
    <section className="section">
      <div className="section-head">
        <h2>SPINDEX</h2>
      </div>
      <div className="panel spindex-card">
        {claim ? (
          <>
            <span className="spindex-value num">{claim.rating}</span>
            <div className="row-2">
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Update
              </Button>
              <Button variant="ghost" onClick={() => setRemoving(true)}>
                Remove
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="spindex-empty">Add your PingPod skill rating to get on the SPINDEX board.</p>
            <Button variant="secondary" block onClick={() => setOpen(true)}>
              Add my SPINDEX
            </Button>
          </>
        )}
      </div>
      {open && <SpindexSheet onClose={() => setOpen(false)} />}
      {removing && (
        <ConfirmSheet
          title="Remove SPINDEX?"
          body={<p>Your rating comes off your profile and the SPINDEX board.</p>}
          confirmLabel="Remove rating"
          danger
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            await api.removeSpindex();
            await refresh();
            bump();
            toast("SPINDEX removed.");
          }}
        />
      )}
    </section>
  );
}
