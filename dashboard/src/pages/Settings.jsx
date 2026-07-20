import { PageChrome } from "../components/PageChrome.jsx";
import { StateBanner, StatusBadge } from "../components/StateBanner.jsx";

/**
 * Settings is intentionally read-only.
 * No password fields, login forms, or mutation controls.
 * This page is the operator's guide to what the dashboard reads, how it
 * authenticates, and what it does not change.
 */
export default function SettingsPage() {
  return (
    <PageChrome
      title="Settings"
      description="Operator guide for the read-only dashboard. Authentication reuses the existing main dashboard session cookie. No mutations are made from these pages."
      actions={<StatusBadge tone="info">Read-only</StatusBadge>}
    >
      <div className="stack-lg">
        <StateBanner
          tone="info"
          title="No mutations here"
          message="This dashboard never changes passwords, API keys, worker counts, Redis configuration, or any other setting. Use the main 9router dashboard for account and provider management."
        />

        <section className="panel panel-elevated" aria-labelledby="auth-heading">
          <h2 id="auth-heading" className="panel-title">
            Authentication
          </h2>
          <div className="kv-grid">
            <div className="kv-row">
              <p className="kv-key">Session</p>
              <p className="kv-val">
                Same cookie session as the main dashboard. This dashboard never
                stores tokens in localStorage or sessionStorage.
              </p>
            </div>
            <div className="kv-row">
              <p className="kv-key">Sign-in</p>
              <p className="kv-val">
                If APIs return 401, open the main dashboard, sign in there, then
                return here. No password field is shown on these pages.
              </p>
            </div>
            <div className="kv-row">
              <p className="kv-key">Shell</p>
              <p className="kv-val">
                The dashboard pages load publicly, but JSON data requires a valid
                same-origin session cookie from the main dashboard.
              </p>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="data-heading">
          <h2 id="data-heading" className="panel-title">
            How data reaches the dashboard
          </h2>
          <div className="kv-grid">
            <div className="kv-row">
              <p className="kv-key">Source</p>
              <p className="kv-val">
                Same backend cluster; requests are read-only and carry the same
                session cookie used by the main dashboard.
              </p>
            </div>
            <div className="kv-row">
              <p className="kv-key">Live stream</p>
              <p className="kv-val">
                Active and recent Redis counters refresh automatically while this
                dashboard is open.
              </p>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="scope-heading">
          <h2 id="scope-heading" className="panel-title">
            Operator scope
          </h2>
          <ul className="prose-list">
            <li>Observation of Redis live snapshots, usage aggregates, and worker availability.</li>
            <li>Secret fields (apiKey, accessToken, credential, password, internalSecret) are stripped client-side as a second line of defense.</li>
            <li>No KEYS, no provider secret inventory, no deploy or process controls.</li>
            <li>No data is written back to the cluster from this dashboard.</li>
          </ul>
        </section>
      </div>
    </PageChrome>
  );
}
