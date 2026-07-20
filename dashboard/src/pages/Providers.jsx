import { useState } from "react";
import { fetchProviders } from "../lib/api.js";
import { useMwResource } from "../hooks/useMwResource.js";
import { PageChrome } from "../components/PageChrome.jsx";
import {
  EmptyBlock,
  LoadingBlock,
  StateBanner,
  StatusBadge,
} from "../components/StateBanner.jsx";
import { formatCount } from "../lib/state.js";

const INITIAL_PROVIDER_LIMIT = 8;

function providerLabel(item) {
  if (!item || typeof item !== "object") return "Unknown";
  return (
    item.provider ||
    item.name ||
    item.id ||
    item.slug ||
    "Provider"
  );
}

function providerMeta(item) {
  if (!item || typeof item !== "object") return null;
  const bits = [];
  if (item.accountCount != null) bits.push(`${formatCount(item.accountCount)} accounts`);
  if (item.modelCount != null) bits.push(`${formatCount(item.modelCount)} models`);
  if (item.status) bits.push(String(item.status));
  if (item.enabled === true) bits.push("enabled");
  if (item.enabled === false) bits.push("disabled");
  return bits.length ? bits.join(" · ") : "Summary row";
}

function summarize(providers) {
  if (!Array.isArray(providers) || providers.length === 0) {
    return { total: 0, enabled: 0, accounts: 0, models: 0 };
  }
  let enabled = 0;
  let accounts = 0;
  let models = 0;
  for (const p of providers) {
    if (p && typeof p === "object") {
      if (p.enabled === true) enabled += 1;
      if (Number.isFinite(Number(p.accountCount))) accounts += Number(p.accountCount);
      if (Number.isFinite(Number(p.modelCount))) models += Number(p.modelCount);
    }
  }
  return { total: providers.length, enabled, accounts, models };
}

export default function ProvidersPage() {
  const { view, data } = useMwResource(fetchProviders, []);
  const providers = Array.isArray(data?.providers) ? data.providers : [];
  const mode = data?.mode || "degraded";
  const [showAll, setShowAll] = useState(false);

  const summary = summarize(providers);
  const visibleProviders = showAll
    ? providers
    : providers.slice(0, INITIAL_PROVIDER_LIMIT);
  const overflow = providers.length - visibleProviders.length;
  const isExpanded = showAll && overflow > 0;

  return (
    <PageChrome
      title="Providers"
      description="Read-only provider inventory from the multi-worker SQLite adapter. Secrets are stripped before render."
      actions={
        <StatusBadge tone={mode === "ok" ? "ok" : "warning"}>
          {mode === "ok" ? "Adapter OK" : "Degraded"}
        </StatusBadge>
      }
    >
      {view.phase === "loading" ? <LoadingBlock label="Loading providers" /> : null}

      {view.banner ? (
        <StateBanner
          tone={view.banner.tone}
          title={view.banner.title}
          message={view.banner.message}
          role={view.phase === "unauthenticated" ? "alert" : "status"}
        />
      ) : null}

      {view.phase === "ok" || view.phase === "degraded" || view.phase === "empty" ? (
        <>
          {mode === "degraded" && view.phase !== "unauthenticated" ? (
            <StateBanner
              tone="warning"
              title="Provider adapter degraded"
              message="The read-only SQLite adapter is unavailable or partial. Showing an empty or incomplete list rather than inventing providers."
            />
          ) : null}

          {providers.length === 0 ? (
            <EmptyBlock
              title="No providers to show"
              message="Either the inventory is empty, or the operator dashboard could not open the read-only adapter. Use the main dashboard for full provider management."
            />
          ) : (
            <>
              <section
                className="stat-grid"
                aria-label="Provider summary"
                style={{ marginBottom: "1rem" }}
              >
                <article className="stat-card">
                  <p className="stat-label">Providers</p>
                  <p className="stat-value">{formatCount(summary.total)}</p>
                  <p className="stat-hint">Total in inventory</p>
                </article>
                <article className="stat-card">
                  <p className="stat-label">Enabled</p>
                  <p className="stat-value">{formatCount(summary.enabled)}</p>
                  <p className="stat-hint">Active for routing</p>
                </article>
                <article className="stat-card">
                  <p className="stat-label">Accounts</p>
                  <p className="stat-value">{formatCount(summary.accounts)}</p>
                  <p className="stat-hint">Across all providers</p>
                </article>
                <article className="stat-card">
                  <p className="stat-label">Models</p>
                  <p className="stat-value">{formatCount(summary.models)}</p>
                  <p className="stat-hint">Unique model entries</p>
                </article>
              </section>

              <section id="provider-list-panel" className="panel panel-elevated" aria-label="Provider list">
                <h2 className="panel-title">
                  {providers.length} provider{providers.length === 1 ? "" : "s"}
                  {!showAll && overflow > 0
                    ? ` · showing first ${INITIAL_PROVIDER_LIMIT}`
                    : null}
                </h2>
                <div className="data-list">
                  {visibleProviders.map((item, index) => (
                    <article
                      key={`${providerLabel(item)}-${index}`}
                      className="data-row"
                    >
                      <div className="data-row-main">
                        <p className="data-primary">{providerLabel(item)}</p>
                      </div>
                      <p className="data-meta">{providerMeta(item)}</p>
                    </article>
                  ))}
                </div>
                {overflow > 0 || isExpanded ? (
                  <div style={{ marginTop: "0.85rem" }}>
                    <button
                      type="button"
                      className="chip"
                      aria-expanded={showAll}
                      aria-controls="provider-list-panel"
                      onClick={() => setShowAll((v) => !v)}
                    >
                      {showAll
                        ? `Show less`
                        : `Show all ${providers.length} providers`}
                    </button>
                  </div>
                ) : null}
              </section>
            </>
          )}
        </>
      ) : null}
    </PageChrome>
  );
}
