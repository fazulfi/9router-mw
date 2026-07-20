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

export default function ProvidersPage() {
  const { view, data } = useMwResource(fetchProviders, []);
  const providers = Array.isArray(data?.providers) ? data.providers : [];
  const mode = data?.mode || "degraded";

  return (
    <PageChrome
      title="Providers"
      description="Read-only provider inventory summary from the multi-worker SQLite adapter. Secrets are stripped before render."
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
              message="Either the inventory is empty, or the companion could not open the read-only adapter. Check the main dashboard for full provider management."
            />
          ) : (
            <section className="panel panel-elevated" aria-label="Provider list">
              <h2 className="panel-title">
                {providers.length} provider{providers.length === 1 ? "" : "s"}
              </h2>
              <div className="data-list">
                {providers.map((item, index) => (
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
            </section>
          )}
        </>
      ) : null}
    </PageChrome>
  );
}
