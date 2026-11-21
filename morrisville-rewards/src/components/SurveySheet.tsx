import { useEffect, useRef, useState } from "react";
import { Check, ClipboardList, X } from "lucide-react";
import { api, errorText } from "../lib/api";
import { cleanAnswers, SURVEY, SURVEY_INTRO, type SurveyAnswers, type SurveyQuestion } from "../lib/survey";
import { PingPodMark } from "./Logo";
import "./survey.css";

// The research survey, one question per screen. Answers are sent once at the end and saved
// without the player's account (see submit_survey); closing early sends nothing.

export default function SurveySheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState(-1); // -1 intro, 0..n-1 questions, n thanks
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const n = SURVEY.length;
  const q = step >= 0 && step < n ? SURVEY[step] : null;

  useEffect(() => {
    document.body.classList.add("no-scroll");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("no-scroll");
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [step]);

  const set = (id: string, v: string | string[] | number) => setAnswers((a) => ({ ...a, [id]: v }));
  const answered = (qq: SurveyQuestion) => {
    const v = answers[qq.id];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "";
  };
  const canNext = !q || !("required" in q && q.required) || answered(q);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api.submitSurvey(cleanAnswers(answers));
      setStep(n);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sv" role="dialog" aria-modal="true" aria-label="Research survey">
      <div className="sv-top">
        <PingPodMark height={16} />
        {q && <span className="sv-count num">{step + 1} / {n}</span>}
        <button type="button" className="sv-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      {q && (
        <div className="sv-bar" aria-hidden>
          <span style={{ width: `${((step + 1) / n) * 100}%` }} />
        </div>
      )}

      <div className="sv-body" ref={body}>
        {step === -1 && (
          <div className="sv-intro">
            <span className="sv-icon">
              <ClipboardList size={26} />
            </span>
            <h2>{SURVEY_INTRO.title}</h2>
            <p>{SURVEY_INTRO.text}</p>
            <p className="sv-fine">
              {SURVEY_INTRO.by} · Questions? {SURVEY_INTRO.contact}
            </p>
          </div>
        )}
        {q && <Question key={q.id} q={q} value={answers[q.id]} other={answers[`${q.id}_other`] as string | undefined} set={set} />}
        {step === n && (
          <div className="sv-intro">
            <span className="sv-icon done">
              <Check size={28} strokeWidth={3} />
            </span>
            <h2>Thank you!</h2>
            <p>Your answers help us build a better rewards program for PingPod.</p>
          </div>
        )}
      </div>

      <div className="sv-foot">
        {error && <p className="sv-error">{error}</p>}
        {step === -1 && (
          <button type="button" className="btn btn-primary btn-lg sv-next" onClick={() => setStep(0)}>
            Start
          </button>
        )}
        {q && (
          <div className="sv-actions">
            <button type="button" className="sv-back" onClick={() => setStep(step - 1)}>
              Back
            </button>
            {step < n - 1 ? (
              <button type="button" className="btn btn-primary btn-lg sv-next" disabled={!canNext} onClick={() => setStep(step + 1)}>
                {answered(q) ? "Next" : "Skip"}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-lg sv-next" disabled={busy} onClick={() => void submit()}>
                {busy ? "Sending…" : "Send answers"}
              </button>
            )}
          </div>
        )}
        {step === n && (
          <button type="button" className="btn btn-primary btn-lg sv-next" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

function Question({
  q,
  value,
  other,
  set,
}: {
  q: SurveyQuestion;
  value: SurveyAnswers[string] | undefined;
  other: string | undefined;
  set: (id: string, v: string | string[] | number) => void;
}) {
  return (
    <div className="sv-q">
      <h2>{q.text}</h2>
      {q.kind === "multi" && <p className="sv-hint">Pick all that apply.</p>}
      {(q.kind === "single" || q.kind === "multi") && (
        <div className="sv-options" role={q.kind === "single" ? "radiogroup" : "group"}>
          {[...q.options, ...(q.other ? ["Other"] : [])].map((o) => {
            const on = q.kind === "single" ? value === o : Array.isArray(value) && value.includes(o);
            return (
              <button
                key={o}
                type="button"
                role={q.kind === "single" ? "radio" : "checkbox"}
                aria-checked={on}
                className={`sv-opt ${on ? "on" : ""} ${q.kind}`}
                onClick={() => {
                  if (q.kind === "single") set(q.id, o);
                  else {
                    const list = Array.isArray(value) ? value : [];
                    set(q.id, on ? list.filter((x) => x !== o) : [...list, o]);
                  }
                }}
              >
                <span className="sv-mark" aria-hidden>
                  {on && <Check size={14} strokeWidth={3.2} />}
                </span>
                {o}
              </button>
            );
          })}
          {q.other && (q.kind === "single" ? value === "Other" : Array.isArray(value) && value.includes("Other")) && (
            <input
              className="input sv-other"
              placeholder="Tell us more"
              maxLength={300}
              value={other ?? ""}
              onChange={(e) => set(`${q.id}_other`, e.target.value)}
              autoFocus
            />
          )}
        </div>
      )}
      {q.kind === "scale" && (
        <div className="sv-scale">
          <div className="sv-scale-row" role="radiogroup">
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} type="button" role="radio" aria-checked={value === v} className={`sv-dot num ${value === v ? "on" : ""}`} onClick={() => set(q.id, v)}>
                {v}
              </button>
            ))}
          </div>
          <div className="sv-scale-ends">
            <span>{q.low}</span>
            <span>{q.high}</span>
          </div>
        </div>
      )}
      {q.kind === "text" && (
        <textarea
          className="input sv-text"
          rows={5}
          maxLength={1000}
          placeholder={q.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => set(q.id, e.target.value)}
        />
      )}
    </div>
  );
}
