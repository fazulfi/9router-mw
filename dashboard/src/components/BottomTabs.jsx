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
  { to: "/", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "/providers", label: "Providers", icon: Boxes },
  { to: "/workers", label: "Workers", icon: Server },
  { to: "/redis", label: "Redis", icon: Activity },
  { to: "/usage", label: "Usage", icon: Gauge },
  { to: "/settings", label: "Settings", icon: Settings },
];

/**
 * Mobile-first bottom navigation. Paths resolve under Vite base `/mw/`.
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
                <span>{label}</span>
                {isActive ? <span className="sr-only">(current)</span> : null}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
