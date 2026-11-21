// The research survey (Green Hope High School DECA), asked inside the app. Answers are anonymous:
// they're saved without the player's account. Keys q1…q15 match the server's check.

export type SurveyQuestion =
  | { id: string; kind: "single" | "multi"; text: string; options: string[]; other?: boolean; required?: boolean }
  | { id: string; kind: "scale"; text: string; low: string; high: string }
  | { id: string; kind: "text"; text: string; placeholder?: string };

export const SURVEY_INTRO = {
  title: "PingPod survey",
  text: "Green Hope High School DECA research on PingPod and rewards. Anonymous, about 3 minutes.",
  contact: "spoorthi.vup@gmail.com",
  by: "Spoorthi, Janhawi and Hrishiv",
};

const FREQUENCY = ["Multiple times a week", "Once a week", "A few times a month", "Once a month", "Rarely"];

export const SURVEY: SurveyQuestion[] = [
  {
    id: "q1", kind: "single", required: true, other: true,
    text: "What is your relationship with PingPod?",
    options: [
      "I visit PingPod regularly",
      "I've visited a few times",
      "I've visited once",
      "Not yet, but I'm interested",
      "I support opening a PingPod location",
    ],
  },
  { id: "q2", kind: "single", text: "How often do you play ping pong?", options: [...FREQUENCY, "Never, but I'm interested in trying it"] },
  {
    id: "q3", kind: "multi", other: true,
    text: "What first interested you in PingPod?",
    options: [
      "Playing 24/7",
      "Convenient, automated booking and access",
      "Playing with friends or family",
      "A fun activity",
      "Practicing and improving my skills",
      "The private court experience",
      "A nearby location",
    ],
  },
  { id: "q4", kind: "text", text: "Why did you feel PingPod needed a location here?", placeholder: "Your answer" },
  {
    id: "q5", kind: "multi", other: true,
    text: "What keeps you most engaged with PingPod compared to other table tennis places?",
    options: [
      "24/7 availability",
      "Easy online booking",
      "Convenient location",
      "Court quality",
      "Affordable pricing",
      "Privacy and flexibility",
      "Time with friends",
      "Chances to practice",
    ],
  },
  { id: "q6", kind: "single", text: "How often do you book PingPod courts?", options: [...FREQUENCY, "I haven't booked yet"] },
  {
    id: "q7", kind: "multi", other: true,
    text: "What affects how often you book?",
    options: [
      "Price per session",
      "Court availability",
      "Location and convenience",
      "Beginner-friendly feel",
      "My friends' availability",
      "Special occasions or events",
      "Wanting to practice",
      "Discounts or promotions",
    ],
  },
  {
    id: "q8", kind: "single", other: true,
    text: "What's the biggest thing stopping you from booking more?",
    options: [
      "Price",
      "No courts at my preferred times",
      "Location or transportation",
      "Coordinating with friends",
      "Lack of time",
      "I already go as often as I want",
      "I haven't tried PingPod yet",
    ],
  },
  { id: "q9", kind: "single", text: "About how much do you usually spend per booking?", options: ["Less than $10", "$10–30", "$30–50", "$50 or more", "I haven't booked yet"] },
  {
    id: "q10", kind: "multi", other: true,
    text: "What would get you to visit more often?",
    options: [
      "Discounts on bookings",
      "Rewards for repeat visits",
      "Referral bonuses for bringing friends",
      "Group booking deals",
      "Tournaments or events",
      "Membership benefits",
    ],
  },
  {
    id: "q11", kind: "single",
    text: "Have you used a loyalty or rewards program before?",
    options: ["Yes, often", "Yes, but rarely", "No, but I'd be interested", "No, and I'm not interested"],
  },
  { id: "q12", kind: "scale", text: "How interested would you be in a PingPod rewards program?", low: "Not interested", high: "Extremely interested" },
  {
    id: "q13", kind: "multi",
    text: "Which rewards would get you to book more?",
    options: [
      "Points for every booking",
      "Points for playing games",
      "Bonus points for winning",
      "Streaks for regular visits",
      "Badges for milestones",
      "A customer leaderboard",
      "Creating or joining teams",
      "Rewards for referring friends",
      "Discounts or free court time",
      "Leagues and tournaments",
    ],
  },
  {
    id: "q14", kind: "single",
    text: "Would a program with points, streaks, badges, leaderboards and teams get you to visit more?",
    options: ["Very likely", "Somewhat likely", "Not sure", "Somewhat unlikely", "Very unlikely"],
  },
  { id: "q15", kind: "text", text: "Anything else that would make you join a rewards program and come back to play?", placeholder: "Ideas, features, anything" },
];

export type SurveyAnswers = Record<string, string | string[] | number>;

/** Drops empty answers and trims text, ready to send. */
export function cleanAnswers(a: SurveyAnswers): SurveyAnswers {
  const out: SurveyAnswers = {};
  for (const [k, v] of Object.entries(a)) {
    if (Array.isArray(v)) {
      if (v.length) out[k] = v;
    } else if (typeof v === "string") {
      const t = v.trim().slice(0, 1000);
      if (t) out[k] = t;
    } else if (typeof v === "number") out[k] = v;
  }
  return out;
}
