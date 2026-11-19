import { useState, type FormEvent } from "react";
import { api, errorText } from "../lib/api";
import { navigate } from "../lib/router";
import { KEYS, store } from "../lib/storage";
import { AVATAR_COLORS, type AvatarColor } from "../lib/types";
import { useApp } from "../state";
import { Logo } from "../components/Logo";
import { Avatar, Button, Field, InlineError, Toggle } from "../components/ui";

export const NICKNAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,19}$/;

export function nicknameProblem(name: string): string {
  const v = name.trim().replace(/\s+/g, " ");
  if (v.length < 2) return "At least 2 characters.";
  if (v.length > 20) return "20 characters max.";
  if (!NICKNAME_RE.test(v)) return "Letters, numbers, spaces, _ . or - (start with a letter or number).";
  return "";
}

export function ColorPicker({ value, onChange, name }: { value: AvatarColor; onChange: (c: AvatarColor) => void; name: string }) {
  return (
    <div className="color-picks" role="radiogroup" aria-label="Avatar color">
      {AVATAR_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className="color-pick"
          onClick={() => onChange(c)}
        >
          <Avatar name={name || "You"} color={c} size={34} />
        </button>
      ))}
    </div>
  );
}

export default function Onboarding() {
  const { refresh, signOut } = useApp();
  const [name, setName] = useState("");
  const [color, setColor] = useState<AvatarColor>("pink");
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const problem = nicknameProblem(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setError("");
    try {
      await api.saveProfile({
        display_name: name.trim().replace(/\s+/g, " "),
        avatar_color: color,
        show_on_leaderboard: visible,
        show_spindex: true,
      });
      const invite = store.get<string>(KEYS.invite);
      await refresh();
      if (invite) navigate(`/join/${invite}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-top">
        <Logo size="md" />
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
      <main className="welcome-main">
        <div className="stack-sm">
          <h1 className="hero-title">Pick your nickname</h1>
          <p className="hero-sub">Other players see this. Your email stays private.</p>
        </div>
        <form className="auth-form" onSubmit={submit} noValidate>
          <Field
            label="Nickname"
            autoComplete="nickname"
            autoCapitalize="words"
            maxLength={20}
            placeholder="e.g. TopspinTaylor"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            error={touched && name ? problem : undefined}
          />
          <div className="stack-sm">
            <span className="label">Avatar color</span>
            <ColorPicker value={color} onChange={setColor} name={name} />
          </div>
          <div className="panel" style={{ padding: "4px 16px" }}>
            <Toggle
              checked={visible}
              onChange={setVisible}
              label="Show me on the leaderboard"
              description="Shown in the app and on the in-store screen."
            />
          </div>
          {error && <InlineError>{error}</InlineError>}
          <Button type="submit" variant="primary" size="xl" block loading={busy}>
            Let's play
          </Button>
        </form>
      </main>
      <footer className="welcome-foot">Morrisville Rewards · Beta</footer>
    </div>
  );
}
