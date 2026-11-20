import { useEffect, useState } from "react";
import { ChevronRight, ClipboardList } from "lucide-react";
import { store } from "../lib/storage";
import { useApp } from "../state";

// Research survey for the high school project. The link opens the Google Form in a new tab;
// nothing about the player is added to it, so answers stay anonymous.
//   • The "How it works" slides end with the ask (first visit, and for existing players once).
//   • Home keeps a survey card: pink until it's opened, then a plain card (still easy to find).
const openedKey = (id: string) => `pingpod-survey-${id}`;

export const SURVEY_ASK =
  "We're high school students running this pilot with PingPod Morrisville to learn what keeps players coming back. Mind answering a short, anonymous survey?";

export const surveyOpened = (id: string) => store.get<string>(openedKey(id)) === "opened";

export function markSurveyOpened(id: string) {
  store.set(openedKey(id), "opened");
  window.dispatchEvent(new Event("pingpod-survey"));
}

export function SurveyFooter() {
  const { me } = useApp();
  const url = me.settings.survey_url ?? null;
  const id = me.profile?.id ?? "";
  const [opened, setOpened] = useState(() => !id || surveyOpened(id));
  // Updates when the survey is opened from the tutorial or elsewhere.
  useEffect(() => {
    const sync = () => setOpened(!id || surveyOpened(id));
    window.addEventListener("pingpod-survey", sync);
    return () => window.removeEventListener("pingpod-survey", sync);
  }, [id]);
  if (!url) return null;
  return (
    <a
      className={`survey-card ${opened ? "done" : ""}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => !opened && markSurveyOpened(id)}
    >
      <span className="survey-card-icon">
        <ClipboardList size={20} aria-hidden />
      </span>
      <span className="survey-card-text">
        <strong>{opened ? "Research survey" : "Help our school research"}</strong>
        <span>{opened ? "Thanks for helping! Tap to open it again." : "A short, anonymous survey. It really helps."}</span>
      </span>
      <ChevronRight size={20} aria-hidden />
    </a>
  );
}
