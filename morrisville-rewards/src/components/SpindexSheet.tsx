import { useState } from "react";
import { api, errorText } from "../lib/api";
import { useApp } from "../state";
import { Button, Field, InlineError, Sheet, useToast } from "./ui";

/** Add or update your SPINDEX rating (used on Home and on the profile). */
export default function SpindexSheet({ onClose }: { onClose: () => void }) {
  const { me, refresh, bump } = useApp();
  const toast = useToast();
  const claim = me.spindex ?? null;
  const [rating, setRating] = useState(claim ? String(claim.rating) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = Number(rating);
  const valid = rating !== "" && Number.isInteger(value) && value >= 0 && value <= 3000;
  return (
    <Sheet title="Your SPINDEX" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return setError("SPINDEX ratings run from 0 to 3000.");
          setBusy(true);
          setError("");
          try {
            await api.submitSpindex(value, note.trim() || undefined);
            await refresh();
            bump();
            toast("SPINDEX saved.");
            onClose();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field
          label="Rating (0–3000)"
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min={0}
          max={3000}
          value={rating}
          onChange={(e) => setRating(e.target.value)}
        />
        <Field
          label="Where's it from? (optional)"
          maxLength={200}
          placeholder="e.g. SPINDEX app, Nov 2026"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {claim?.status === "verified" && (
          <p className="small-print">Saving a new number replaces your verified rating with a self-reported one.</p>
        )}
        {error && <InlineError>{error}</InlineError>}
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!rating}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}
