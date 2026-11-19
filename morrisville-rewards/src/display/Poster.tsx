import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Printer, TriangleAlert } from "lucide-react";
import { api } from "../lib/api";
import { PingPodMark } from "../components/Logo";
import { Button, Segmented } from "../components/ui";
import { displayUrl, isLocalUrl, resolveAppUrl } from "./appUrl";
import "../styles/tokens.css";
import "../styles/ui.css";
import "./poster.css";

type Layout = "poster" | "cards";

const STEPS = ["Scan the code", "Create your account (about a minute)", "Tap Start playing"];
const SMALL_PRINT =
  "A local pilot at PingPod Morrisville. Not the official PingPod app or booking system. Leaderboards show nicknames only.";

/** Printable join sign (/poster): a letter-size poster or two table cards per page. */
export default function Poster() {
  const [url, setUrl] = useState(() => resolveAppUrl(null));
  const [fromSettings, setFromSettings] = useState(false);
  const [layout, setLayout] = useState<Layout>("poster");
  const [qr, setQr] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .publicSettings()
      .then((s) => {
        if (!cancelled && s?.public_app_url) {
          setUrl(resolveAppUrl(s.public_app_url));
          setFromSettings(true);
        }
      })
      .catch(() => {
        /* fall back to env/origin */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Vector QR so it prints sharp at any size.
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((svg) => {
        if (!cancelled) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (!cancelled) setQr("");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "PingPod Morrisville Rewards — join sign";
    document.documentElement.classList.add("poster-mode");
    return () => {
      document.title = previousTitle;
      document.documentElement.classList.remove("poster-mode");
    };
  }, []);

  const local = isLocalUrl(url);
  const shown = displayUrl(url);

  return (
    <div className="poster-root">
      <div className="poster-toolbar no-print">
        <a className="poster-back" href="/">
          <ArrowLeft size={18} aria-hidden /> Back to app
        </a>
        <h1>Print the join sign</h1>
        <Segmented<Layout>
          label="Layout"
          value={layout}
          onChange={setLayout}
          options={[
            { value: "poster", label: "Poster (letter)" },
            { value: "cards", label: "Table cards (2 per page)" },
          ]}
        />
        <p className="poster-check">
          This sign links to <strong>{shown}</strong>. Check that's the live address before printing
          {fromSettings ? " (it comes from Admin → Settings)." : "."}
        </p>
        {local && (
          <p className="poster-warning" role="alert">
            <TriangleAlert size={18} aria-hidden /> This is a test address, so printed signs won't work. Open this page on the live
            site or set the public app URL in Admin → Settings.
          </p>
        )}
        <Button variant="primary" size="lg" icon={<Printer size={20} aria-hidden />} onClick={() => window.print()} disabled={!qr}>
          Print
        </Button>
      </div>

      <div className={`poster-pages poster-pages-${layout}`}>
        {layout === "poster" ? (
          <section className="paper paper-poster" aria-label="Poster preview">
            <SignHeader />
            <div className="poster-headline">
              <h2>
                The competition
                <br />
                <em>starts here.</em>
              </h2>
              <p>Track your playing time. Compete with friends. Climb the leaderboard.</p>
            </div>
            <div className="poster-qr">
              {qr && <img src={qr} alt={`QR code: ${shown}`} />}
              <span>Scan to join</span>
            </div>
            <ol className="poster-steps">
              {STEPS.map((s, i) => (
                <li key={s}>
                  <span className="step-num">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <footer className="poster-small">
              <p>{SMALL_PRINT}</p>
              <strong>{shown}</strong>
            </footer>
          </section>
        ) : (
          <section className="paper paper-cards" aria-label="Table cards preview">
            <TableCard qr={qr} url={shown} />
            <div className="cut-line" aria-hidden>
              <span>cut here</span>
            </div>
            <TableCard qr={qr} url={shown} />
          </section>
        )}
      </div>
    </div>
  );
}

function SignHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={`sign-head ${compact ? "sign-head-compact" : ""}`}>
      <span className="sign-brand">
        <PingPodMark height={24} />
        <span className="sign-wordmark">PINGPOD</span>
      </span>
      <span className="sign-tag">MORRISVILLE REWARDS · BETA</span>
    </header>
  );
}

function TableCard({ qr, url }: { qr: string; url: string }) {
  return (
    <article className="table-card">
      <div className="card-qr">
        {qr && <img src={qr} alt={`QR code: ${url}`} />}
        <span>Scan to join</span>
      </div>
      <div className="card-text">
        <SignHeader compact />
        <h2>
          The competition
          <br />
          <em>starts here.</em>
        </h2>
        <ol className="card-steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <span className="step-num">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <p className="card-small">{SMALL_PRINT}</p>
        <strong className="card-url">{url}</strong>
      </div>
    </article>
  );
}
