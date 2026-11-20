import { useState } from "react";
import { store } from "../lib/storage";
import { useApp } from "../state";

const key = (userId: string) => `pingpod-survey-${userId}`;

/**
 * One-time research ask for new players. Opens the survey in a new tab; nothing about the player is
 * added to the link, so answers stay anonymous. Hidden for good once opened or dismissed (this device).
 */
export default function SurveyCard() {
  const { me } = useApp();
  const url = me.settings.survey_url;
  const id = me.profile?.id ?? "";
  const [hidden, setHidden] = useState(() => !id || store.get<string>(key(id)) !== null);
  if (!url || hidden) return null;
  const close = (how: "opened" | "later") => {
    store.set(key(id), how);
    setHidden(true);
  };
  return (
    <section className="survey-card" aria-label="Research survey">
      <div className="survey-card-text">
        <strong>Quick favor?</strong>
        <span>
          We're high school students running this pilot with PingPod Morrisville for a research project. Mind answering a short
          anonymous survey?
        </span>
      </div>
      <div className="survey-card-actions">
        <a className="btn btn-primary btn-md" href={url} target="_blank" rel="noopener noreferrer" onClick={() => close("opened")}>
          Take the survey
        </a>
        <button type="button" className="link-btn quiet" onClick={() => close("later")}>
          Not now
        </button>
      </div>
    </section>
  );
}
