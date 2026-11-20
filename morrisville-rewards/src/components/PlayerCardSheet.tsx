import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { api, errorText } from "../lib/api";
import { useApp } from "../state";
import { formatNumber } from "../lib/time";
import type { PlayerCard } from "../lib/types";
import { Avatar, Button, InlineError, Sheet, useToast } from "./ui";
import CrewBadge from "./CrewBadge";
import LogoLoader from "./LogoLoader";

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "America/New_York" });

/** Tap a player anywhere (leaderboard, crew) to see their public profile. */
export default function PlayerCardSheet({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const { me } = useApp();
  const toast = useToast();
  const [card, setCard] = useState<PlayerCard | null>(null);
  const [error, setError] = useState("");
  const myCrew = me.crew ?? null;

  // Invite someone you just found on the board to your crew (share sheet, or copy the link).
  async function invite() {
    if (!myCrew || !card) return;
    const url = `${window.location.origin}/join/${myCrew.invite_code}`;
    const text = `${card.display_name}, join my crew "${myCrew.name}" on PingPod Morrisville Rewards`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "PingPod Morrisville crew invite", text, url });
        return;
      } catch {
        /* cancelled: fall back to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Invite link copied. Send it to them.");
    } catch {
      toast("Couldn't copy the link. Find it on the Crew tab.", "bad");
    }
  }
  useEffect(() => {
    let live = true;
    api
      .playerCard(userId)
      .then((c) => live && setCard(c))
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [userId]);

  return (
    <Sheet title={card?.display_name ?? name} onClose={onClose}>
      {error ? (
        <InlineError>{error}</InlineError>
      ) : !card ? (
        <LogoLoader label="Loading profile" />
      ) : (
        <div className="player-card">
          <div className="player-card-head">
            <Avatar name={card.display_name} color={card.avatar_color} path={card.avatar_path} size={84} />
            <div className="player-card-who">
              {card.bio ? <p className="player-card-bio">{card.bio}</p> : null}
              {card.crew && (
                <span className="player-card-crew">
                  <CrewBadge emblem={card.crew.emblem} color={card.crew.color} size={22} />
                  {card.crew.name}
                </span>
              )}
            </div>
          </div>
          <div className="stat-strip">
            <div className="stat-cell">
              <span className="stat-label">This week</span>
              <span className="stat-value num">
                {formatNumber(card.week_minutes)}
                <small>min</small>
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Week rank</span>
              <span className={`stat-value num ${card.rank_week ? "pink" : ""}`}>{card.rank_week ? `#${card.rank_week}` : "—"}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Streak</span>
              <span className="stat-value num">
                {card.current_streak}
                <small>{card.current_streak === 1 ? "day" : "days"}</small>
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">SPINDEX</span>
              <span className="stat-value num">{card.spindex ? card.spindex.rating : "—"}</span>
            </div>
          </div>
          <p className="small-print">
            {formatNumber(card.total_minutes)} min in {card.sessions} {card.sessions === 1 ? "session" : "sessions"} · since{" "}
            {monthYear.format(new Date(card.member_since))}
          </p>
          {myCrew && !card.is_me && !card.crew && (
            <Button variant="secondary" block icon={<UserPlus size={18} />} onClick={() => void invite()}>
              Invite to {myCrew.name}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
