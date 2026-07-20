import { NavLink } from "react-router-dom";
import {
  Activity,
  Boxes,
  Gauge,
  LayoutDashboard,
  Server,
  Settings,
} from "lucide-react";

const TABS = [
  { to: "/", end: true, label: "Overview", short: "Home", icon: LayoutDashboard },
  { to: "/providers", label: "Providers", short: "Providers", icon: Boxes },
  { to: "/workers", label: "Workers", short: "Workers", icon: Server },
  { to: "/redis", label: "Redis", short: "Redis", icon: Activity },
  { to: "/usage", label: "Usage", short: "Usage", icon: Gauge },
  { to: "/settings", label: "Settings", short: "Settings", icon: Settings },
];

/**
 * Mobile-first bottom navigation. Paths resolve under Vite base `/mw/`.
 * Each tab has a full accessible name (aria-label), a visible short label
 * at wider viewports, and a sr-only "(current)" marker when active.
 * On very narrow viewports the visible label is hidden but the aria-label
 * remains so screen readers and the visible name stay in sync.
 */
export function BottomTabs() {
  return (
    <nav className="tabbar" aria-label="Primary">
      <div className="tabbar-inner">
        {TABS.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="tab-link"
            aria-label={label}
          >
            {({ isActive }) => (
              <>
                <Icon aria-hidden="true" />
                <span className="tab-label">{label}</span>
                {isActive ? (
                  <span className="sr-only">(current page)</span>
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
