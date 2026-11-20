import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { store } from "../lib/storage";
import { useApp } from "../state";
import { Button, Sheet } from "./ui";

// Research survey for the high school project. The link opens the Google Form in a new tab;
// nothing about the player is added to it, so answers stay anonymous.
//   • Pop-up: shown once, a moment after a new player lands on Home.
//   • Footer card: stays at the bottom of Home until they actually open the survey.
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

export function SurveyPopup() {
  const { url, id, opened, markOpened } = useSurvey();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!url || opened || !id || store.get<string>(popupKey(id))) return;
    const t = window.setTimeout(() => setShow(true), 1200);
    return () => window.clearTimeout(t);
  }, [url, opened, id]);
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
  return (
    <a className={`survey-line ${opened ? "done" : ""}`} href={url} target="_blank" rel="noopener noreferrer" onClick={markOpened}>
      <span>{opened ? "Research survey · thanks for helping" : "Help our school research · short anonymous survey"}</span>
      <ChevronRight size={16} aria-hidden />
    </a>
  );
}
