import { useState } from "react";
import { api, errorText } from "../lib/api";
import { navigate } from "../lib/router";
import { Logo } from "../components/Logo";
import { Button, Field, InlineError, useToast } from "../components/ui";

export default function ResetPassword() {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="welcome">
      <div className="welcome-top">
        <Logo size="md" />
      </div>
      <main className="welcome-main">
        <h1 className="hero-title" style={{ fontSize: "clamp(40px, 12vw, 56px)" }}>
          New password
        </h1>
        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw.length < 6) return setError("Use at least 6 characters.");
            setBusy(true);
            setError("");
            try {
              await api.updatePassword(pw);
              toast("Password updated. You're signed in.");
              navigate("/", { replace: true });
              window.location.reload();
            } catch (err) {
              setError(errorText(err));
              setBusy(false);
            }
          }}
        >
          <Field label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint="At least 6 characters" />
          {error && <InlineError>{error}</InlineError>}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Save and continue
          </Button>
        </form>
      </main>
      <footer className="welcome-foot">Morrisville Rewards · Beta</footer>
    </div>
  );
}
