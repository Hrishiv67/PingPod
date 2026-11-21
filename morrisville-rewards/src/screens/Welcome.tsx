import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, Users } from "lucide-react";
import { api, errorText } from "../lib/api";
import { domainAcceptsMail, suggestEmail } from "../lib/emailCheck";
import type { CrewPreview } from "../lib/types";
import { Logo } from "../components/Logo";
import Tutorial from "../components/Tutorial";
import { Button, Chip, Field, IconButton, InlineError, Sheet } from "../components/ui";

type Step = "email" | "password";

export default function Welcome({ inviteCode }: { inviteCode: string | null }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgot, setForgot] = useState(false);
  const [invite, setInvite] = useState<CrewPreview | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [dismissedFor, setDismissedFor] = useState("");
  const [how, setHow] = useState(false);

  useEffect(() => {
    if (!inviteCode) return;
    void api
      .previewCrew(inviteCode)
      .then(setInvite)
      .catch(() => setInvite(null));
  }, [inviteCode]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!emailOk) return setError("Enter a valid email address.");
    setBusy(true);
    setError("");
    try {
      if (step === "email") {
        const e = email.trim();
        const better = dismissedFor === e.toLowerCase() ? null : suggestEmail(e);
        if (better) {
          setSuggestion(better);
          setBusy(false);
          return;
        }
        if ((await domainAcceptsMail(e)) === false) {
          setBusy(false);
          return setError("That email address can't receive email. Check it for a typo.");
        }
        const result = await api.enterWithEmail(e);
        if (result === "password") {
          setStep("password");
          setBusy(false);
        }
        // "in": the app switches screens on its own.
        return;
      }
      if (!password) {
        setBusy(false);
        return setError("Enter your password.");
      }
      await api.signIn(email, password);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-top">
        <Logo size="md" />
        <Chip tone="pink">Morrisville · Beta</Chip>
      </div>

      <main className="welcome-main">
        <div className="hero">
          <h1 className="hero-title">
            Track your play.
            <br />
            <em>Climb the board.</em>
          </h1>
          <p className="hero-sub">Log your table time at PingPod Morrisville and climb the weekly leaderboard.</p>
        </div>

        {inviteCode && (
          <div className="invite-banner">
            <Users size={22} aria-hidden />
            <div>
              <strong>{invite ? `You're invited to join ${invite.name}` : "You've got a crew invite"}</strong>
              <div className="small-print">Enter your email and you'll join the crew right after.</div>
            </div>
          </div>
        )}

        <form className="auth-form" onSubmit={submit} noValidate>
          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSuggestion(null);
              if (step === "password") {
                setStep("email");
                setPassword("");
              }
              setError("");
            }}
            required
          />
          {step === "password" && (
            <>
              <div className="invite-banner" role="status">
                <span>This is a staff account. Enter your staff password.</span>
              </div>
              <div className="password-wrap">
                <Field
                  label="Password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
                <IconButton type="button" label={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>
                  {show ? <EyeOff size={20} /> : <Eye size={20} />}
                </IconButton>
              </div>
              <div className="auth-row">
                <button type="button" className="link-btn" onClick={() => setForgot(true)}>
                  Forgot it?
                </button>
              </div>
            </>
          )}
          {suggestion && (
            <div className="email-suggest" role="status">
              <span>
                Did you mean <strong>{suggestion}</strong>?
              </span>
              <span className="email-suggest-actions">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setEmail(suggestion);
                    setSuggestion(null);
                  }}
                >
                  Yes, fix it
                </button>
                <button
                  type="button"
                  className="link-btn quiet"
                  onClick={() => {
                    setDismissedFor(email.trim().toLowerCase());
                    setSuggestion(null);
                  }}
                >
                  No, mine is right
                </button>
              </span>
            </div>
          )}
          {error && <InlineError>{error}</InlineError>}
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!email.trim()}>
            {step === "email" ? "Continue" : "Sign in"}
          </Button>
        </form>
        <button type="button" className="link-btn welcome-how" onClick={() => setHow(true)}>
          How it works
        </button>
      </main>
      {how && <Tutorial onClose={() => setHow(false)} />}

      <footer className="welcome-foot">
        A local PingPod Morrisville pilot · not the PingPod booking app
        {api.mode === "demo" && (
          <>
            <br />
            <strong>Demo mode</strong> — data stays in this browser.
          </>
        )}
      </footer>

      {forgot && <ForgotSheet initialEmail={email} onClose={() => setForgot(false)} />}
    </div>
  );
}

function ForgotSheet({ initialEmail, onClose }: { initialEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <Sheet title="Reset password" onClose={onClose}>
      {sent ? (
        <>
          <p className="sheet-text">If there's an account for {email}, a reset link is on its way. Open it on this phone.</p>
          <Button variant="primary" size="lg" block onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api.sendPasswordReset(email);
              setSent(true);
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <InlineError>{error}</InlineError>}
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!email.includes("@")}>
            Send reset link
          </Button>
          <p className="small-print">Can't get the email? Ask at the front desk.</p>
        </form>
      )}
    </Sheet>
  );
}
