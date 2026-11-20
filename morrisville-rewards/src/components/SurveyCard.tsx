import { useEffect, useState } from "react";
import { ChevronRight, ClipboardList } from "lucide-react";
import { store } from "../lib/storage";
import { useApp } from "../state";
import { Button, Sheet } from "./ui";

// Research survey for the high school project. The link opens the Google Form in a new tab;
// nothing about the player is added to it, so answers stay anonymous.
//   • Pop-up: shown once, after the player's first saved session (not before they've played).
//   • Footer line: always at the bottom of Home; it turns quiet once they've opened the survey.
const openedKey = (id: string) => `pingpod-survey-${id}`;
const popupKey = (id: string) => `pingpod-survey-popup-${id}`;
const ASK = "We're high school students running this pilot with PingPod Morrisville for a research project. Mind answering a short anonymous survey?";

function useSurvey() {
  const { me } = useApp();
  const url = me.settings.survey_url ?? null;
  const id = me.profile?.id ?? "";
  const [opened, setOpened] = useState(() => !id || store.get<string>(openedKey(id)) === "opened");
  // Other survey cards on the page update when one of them is used.
  useEffect(() => {
    const sync = () => setOpened(!id || store.get<string>(openedKey(id)) === "opened");
    window.addEventListener("pingpod-survey", sync);
    return () => window.removeEventListener("pingpod-survey", sync);
  }, [id]);
  const markOpened = () => {
    store.set(openedKey(id), "opened");
    store.set(popupKey(id), "seen");
    window.dispatchEvent(new Event("pingpod-survey"));
  };
  return { url, id, opened, markOpened };
}

export function SurveyPopup({ ready }: { ready: boolean }) {
  const { url, id, opened, markOpened } = useSurvey();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!ready || !url || opened || !id || store.get<string>(popupKey(id))) return;
    const t = window.setTimeout(() => setShow(true), 900);
    return () => window.clearTimeout(t);
  }, [ready, url, opened, id]);
  if (!show || !url) return null;
  const close = () => {
    store.set(popupKey(id), "seen");
    setShow(false);
  };
  return (
    <Sheet title="Quick favor?" onClose={close}>
      <div className="stack">
        <p className="sheet-text">{ASK}</p>
        <a
          className="btn btn-primary btn-lg btn-block"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            markOpened();
            setShow(false);
          }}
        >
          Take the survey
        </a>
        <Button variant="ghost" block onClick={close}>
          Maybe later
        </Button>
        <p className="small-print" style={{ textAlign: "center" }}>
          It stays at the bottom of Home if you'd rather do it later.
        </p>
      </div>
    </Sheet>
  );
}

export function SurveyFooter() {
  const { url, opened, markOpened } = useSurvey();
  if (!url) return null;
  // Before it's opened: a small, quiet card. After: a muted "thanks" line that stays put.
  if (opened)
    return (
      <a className="survey-line done" href={url} target="_blank" rel="noopener noreferrer">
        <span>Research survey · thanks for helping</span>
        <ChevronRight size={16} aria-hidden />
      </a>
    );
  return (
    <a className="survey-card" href={url} target="_blank" rel="noopener noreferrer" onClick={markOpened}>
      <span className="survey-card-icon">
        <ClipboardList size={18} aria-hidden />
      </span>
      <span className="survey-card-text">
        <strong>Help our school research</strong>
        <span>A short, anonymous survey</span>
      </span>
      <ChevronRight size={18} aria-hidden />
    </a>
  );
}
