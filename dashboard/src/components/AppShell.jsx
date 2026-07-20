import { Outlet } from "react-router-dom";
import { BottomTabs } from "./BottomTabs.jsx";

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-mark">
            <div className="brand-orb" aria-hidden="true" />
            <div className="brand-copy">
              <p className="brand-title">9router MW</p>
              <p className="brand-sub">Operator dashboard · read-only</p>
            </div>
          </div>
          <span className="badge badge-neutral" title="No mutations from this dashboard">
            Read-only
          </span>
        </div>
      </header>

      <main id="main-content" className="app-main" tabIndex={-1}>
        <Outlet />
      </main>

      <BottomTabs />
    </div>
  );
}
