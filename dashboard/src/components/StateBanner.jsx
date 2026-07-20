import { AlertCircle, AlertTriangle, Info, ShieldAlert } from "lucide-react";

const ICONS = {
  danger: ShieldAlert,
  warning: AlertTriangle,
  info: Info,
  neutral: AlertCircle,
};

/**
 * @param {{ tone?: 'danger'|'warning'|'info'|'neutral', title: string, message: string, role?: string }} props
 */
export function StateBanner({
  tone = "neutral",
  title,
  message,
  role = "status",
}) {
  const Icon = ICONS[tone] || ICONS.neutral;
  return (
    <div
      className={`banner banner-${tone}`}
      role={role}
      aria-live={tone === "danger" ? "assertive" : "polite"}
    >
      <Icon size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <p className="banner-title">{title}</p>
        <p className="banner-message">{message}</p>
      </div>
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="skeleton" style={{ height: "5.5rem" }} />
      <div className="skeleton" style={{ height: "8rem" }} />
      <div className="skeleton" style={{ height: "8rem" }} />
    </div>
  );
}

export function EmptyBlock({ title, message }) {
  return (
    <div className="state-block" role="status">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}

export function StatusBadge({ tone = "neutral", children, dot = true }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot ? <span className="badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
