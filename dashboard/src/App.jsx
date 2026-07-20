import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.jsx";
import OverviewPage from "./pages/Overview.jsx";
import ProvidersPage from "./pages/Providers.jsx";
import WorkersPage from "./pages/Workers.jsx";
import RedisPage from "./pages/Redis.jsx";
import UsagePage from "./pages/Usage.jsx";
import SettingsPage from "./pages/Settings.jsx";

/**
 * Companion SPA routes under Vite base `/mw/`.
 * BrowserRouter basename must match import.meta.env.BASE_URL (with trailing slash stripped for RR).
 */
export default function App() {
  const basename = (import.meta.env.BASE_URL || "/mw/").replace(/\/$/, "") || "/";

  return (
    <BrowserRouter basename={basename}>
      <a href="#main-content" className="sr-only">
        Skip to main content
      </a>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="workers" element={<WorkersPage />} />
          <Route path="redis" element={<RedisPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
