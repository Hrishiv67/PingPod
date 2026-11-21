import { ChevronRight, ClipboardList } from "lucide-react";
import { store } from "../lib/storage";
import { useApp } from "../state";

// Research survey for our high school project, taken right in the app (answers are anonymous).
//   • The "How it works" slides end with the ask (first visit, and for existing players once).
//   • Home keeps a survey card: pink outline until it's done, then a plain "thanks" card.
const askedKey = (id: string) => `pingpod-survey-${id}`;

export const SURVEY_ASK = "We're high school students studying what keeps players coming back. Mind taking a short, anonymous survey?";

/** Whether the tutorial's survey ask was already shown/used on this phone. */
export const surveyOpened = (id: string) => store.get<string>(askedKey(id)) === "opened";
export function markSurveyOpened(id: string) {
  store.set(askedKey(id), "opened");
}

/** Opens the in-app survey (App renders it). */
export function openSurvey() {
  window.dispatchEvent(new Event("pingpod-open-survey"));
}

export function SurveyFooter() {
  const { me } = useApp();
  const done = Boolean(me.profile?.survey_done_at);
  if (done)
    return (
      <div className="survey-card done" role="status">
        <span className="survey-card-icon">
          <ClipboardList size={20} aria-hidden />
        </span>
        <span className="survey-card-text">
          <strong>Research survey</strong>
          <span>Done. Thanks for helping!</span>
        </span>
      </div>
    );
  return (
    <button type="button" className="survey-card" onClick={openSurvey}>
      <span className="survey-card-icon">
        <ClipboardList size={20} aria-hidden />
      </span>
      <span className="survey-card-text">
        <strong>Help our school research</strong>
        <span>A short, anonymous survey. It really helps.</span>
      </span>
      <ChevronRight size={20} aria-hidden />
    </button>
  );
}
