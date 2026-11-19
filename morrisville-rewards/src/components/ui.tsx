import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Check, CircleAlert, Loader2, X } from "lucide-react";
import type { AvatarColor, SessionStatus } from "../lib/types";

// ── Buttons ───────────────────────────────────────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "danger" | "light";
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  block = false,
  icon,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      className={`btn btn-${variant} btn-${size} ${block ? "btn-block" : ""} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="spin" size={18} aria-hidden /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

// ── Text bits ─────────────────────────────────────────────────────────
export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "pink" | "ok" | "warn" | "bad" }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  active: "Playing now",
  pending: "Pending verification",
  approved: "Verified",
  rejected: "Not approved",
  cancelled: "Not counted",
};
const STATUS_TONE: Record<SessionStatus, "neutral" | "pink" | "ok" | "warn" | "bad"> = {
  active: "pink",
  pending: "warn",
  approved: "ok",
  rejected: "bad",
  cancelled: "neutral",
};
export function StatusChip({ status, short = false }: { status: SessionStatus; short?: boolean }) {
  const label = short && status === "pending" ? "Pending" : STATUS_LABEL[status];
  return <Chip tone={STATUS_TONE[status]}>{label}</Chip>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

export function Avatar({
  name,
  color = "pink",
  size = 40,
}: {
  name: string;
  color?: AvatarColor | null;
  size?: number;
}) {
  const initials = name
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <span
      className={`avatar avatar-${color ?? "pink"}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner-row" role="status">
      <Loader2 className="spin" size={20} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ height = 56, count = 3 }: { height?: number; count?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function InlineError({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <CircleAlert size={18} aria-hidden />
      <span>{children}</span>
      {onRetry && (
        <button className="link-btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

// ── Forms ─────────────────────────────────────────────────────────────
export function Field({
  label,
  hint,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? `${id}-d` : undefined} {...input} />
      {(error || hint) && (
        <div id={`${id}-d`} className={error ? "field-error" : "field-hint"}>
          {error || hint}
        </div>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className="toggle-row" htmlFor={id}>
      <span className="toggle-text">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Bottom sheet dialog ───────────────────────────────────────────────
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.sheet-close)");
    (first ?? ref.current)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="sheet-grabber" aria-hidden />
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Close" className="sheet-close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="sheet-text">{body}</div>
      {error && <InlineError>{error}</InlineError>}
      <div className="stack-sm">
        <Button
          variant={danger ? "danger" : "primary"}
          size="lg"
          block
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onConfirm();
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Something went wrong.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" size="lg" block onClick={onClose} disabled={busy}>
          Never mind
        </Button>
      </div>
    </Sheet>
  );
}

// ── Toasts ────────────────────────────────────────────────────────────
type Toast = { id: number; text: string; tone: "ok" | "bad" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "bad") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "bad" ? 5000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === "bad" ? "alert" : "status"}>
            {t.tone === "ok" ? <Check size={18} aria-hidden /> : <CircleAlert size={18} aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Online/offline state with a re-render on change. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
