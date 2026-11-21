import { useEffect, useState } from "react";
import { ChevronRight, MailCheck } from "lucide-react";
import { api, errorText } from "../lib/api";
import { useApp } from "../state";
import { Button, Field, InlineError, Sheet, useToast } from "./ui";

/**
 * Optional: verify your email with a one-time code to be eligible for possible future rewards.
 * Sits at the bottom of Home (in blue, so it reads differently from the pink actions) until done.
 */
export default function VerifyEmailCard() {
  const { me } = useApp();
  const [open, setOpen] = useState(false);
  if (!me.profile || me.profile.email_verified_at) return null;
  return (
    <>
      <button type="button" className="verify-card" onClick={() => setOpen(true)}>
        <MailCheck size={20} aria-hidden />
        <span>
          <strong>Verify your email</strong>
          <span>Be eligible for possible future rewards.</span>
        </span>
        <ChevronRight size={18} aria-hidden />
      </button>
      {open && <VerifySheet onClose={() => setOpen(false)} />}
    </>
  );
}

function VerifySheet({ onClose }: { onClose: () => void }) {
  const { user, refresh, bump } = useApp();
  const toast = useToast();
  const [step, setStep] = useState<"intro" | "code">("intro");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  async function send() {
    setBusy(true);
    setError("");
    try {
      await api.sendEmailCode();
      setStep("code");
      setWait(60);
    } catch (err) {
      setError(sendError(errorText(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Verify your email" onClose={onClose}>
      {step === "intro" ? (
        <div className="stack">
          <p className="sheet-text">
            We'll email a code to <strong>{user.email}</strong>. Verified players are eligible for possible future
            rewards.
          </p>
          {error && <InlineError>{error}</InlineError>}
          <Button variant="primary" size="lg" block loading={busy} onClick={() => void send()}>
            Send code
          </Button>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api.verifyEmailCode(code);
              await refresh();
              bump();
              toast("Email verified. You're eligible for future rewards.");
              onClose();
            } catch (err) {
              setError(errorText(err));
              setBusy(false);
            }
          }}
        >
          <p className="sheet-text">
            Check <strong>{user.email}</strong> (and your spam folder) for the code, or tap the link in that email on this
            phone.
          </p>
          <Field
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={8}
            className="code-input"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ""));
              setError("");
            }}
            error={error || undefined}
            autoFocus
          />
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={code.length < 6}>
            Verify
          </Button>
          <button type="button" className="link-btn quiet" disabled={wait > 0 || busy} onClick={() => void send()}>
            {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
          </button>
        </form>
      )}
    </Sheet>
  );
}

/** Supabase's sending errors in plain words. */
function sendError(text: string) {
  if (/rate limit|too many|seconds/i.test(text)) return "Too many emails just now. Wait a minute and try again.";
  if (/smtp|sending|confirmation|mail/i.test(text)) return "We couldn't send the email right now. Try again in a few minutes.";
  return text;
}
