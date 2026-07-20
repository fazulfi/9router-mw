import { PageChrome } from "../components/PageChrome.jsx";
import { StateBanner, StatusBadge } from "../components/StateBanner.jsx";

/**
 * Settings is intentionally read-only in Phase 1.
 * No password fields, login forms, or mutation controls.
 */
export default function SettingsPage() {
  const base = import.meta.env.BASE_URL || "/mw/";

  return (
    <PageChrome
      title="Settings"
      description="Phase 1 companion configuration is informational only. Authentication reuses the existing main dashboard session cookie."
      actions={<StatusBadge tone="info">Read-only</StatusBadge>}
    >
      <div className="stack-lg">
        <StateBanner
          tone="info"
          title="No mutations here"
          message="This companion does not change passwords, API keys, worker counts, or Redis configuration. Use the main 9router dashboard for account and provider management."
        />

        <section className="panel panel-elevated" aria-labelledby="auth-heading">
          <h2 id="auth-heading" className="panel-title">
            Authentication
          </h2>
          <div className="kv-grid">
            <div className="kv-row">
              <p className="kv-key">Session</p>
              <p className="kv-val">
                Existing cookie session from the main dashboard (auth_token JWT).
                This SPA never stores tokens in localStorage or sessionStorage.
              </p>
            </div>
            <div className="kv-row">
              <p className="kv-key">Sign-in</p>
              <p className="kv-val">
                If APIs return 401, open the main dashboard, sign in there, then
                return to this companion. No password field is shown on these pages.
              </p>
            </div>
            <div className="kv-row">
              <p className="kv-key">Shell</p>
              <p className="kv-val">
                The HTML shell under {base} is public; JSON APIs under /mw/api/v1/*
                require the same-origin session cookie.
              </p>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="api-heading">
          <h2 id="api-heading" className="panel-title">
            API surface
          </h2>
          <div className="kv-grid">
            <div className="kv-row">
              <p className="kv-key">Base</p>
              <p className="kv-val">/mw/api/v1/</p>
            </div>
            <div className="kv-row">
              <p className="kv-key">Methods</p>
              <p className="kv-val">GET only · credentials: include</p>
            </div>
            <div className="kv-row">
              <p className="kv-key">Stream</p>
              <p className="kv-val">
                EventSource → /mw/api/v1/stream (never /api/usage/stream)
              </p>
            </div>
            <div className="kv-row">
              <p className="kv-key">Vite base</p>
              <p className="kv-val">{base}</p>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="phase-heading">
          <h2 id="phase-heading" className="panel-title">
            Phase 1 scope
          </h2>
          <ul className="prose-list">
            <li>Observation of Redis live snapshots, usage aggregates, and worker availability.</li>
            <li>Secret fields (apiKey, accessToken, credential, password, internalSecret) are stripped client-side as a second line of defense.</li>
            <li>No KEYS, no provider secret inventory, no deploy or process controls.</li>
          </ul>
        </section>
      </div>
    </PageChrome>
  );
}
