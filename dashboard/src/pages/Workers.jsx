import { fetchWorkers } from "../lib/api.js";
import { useMwResource } from "../hooks/useMwResource.js";
import { PageChrome } from "../components/PageChrome.jsx";
import {
  LoadingBlock,
  StateBanner,
  StatusBadge,
} from "../components/StateBanner.jsx";
import { mapWorkerAvailability } from "../lib/state.js";

export default function WorkersPage() {
  const { view, data } = useMwResource(fetchWorkers, []);
  const mapped = mapWorkerAvailability(data?.availability);

  return (
    <PageChrome
      title="Workers"
      description="Honest worker observability for Phase 1. Availability only — no fabricated PIDs, hostnames, or load charts."
    >
      {view.phase === "loading" ? <LoadingBlock label="Loading workers" /> : null}

      {view.banner ? (
        <StateBanner
          tone={view.banner.tone}
          title={view.banner.title}
          message={view.banner.message}
          role={view.phase === "unauthenticated" ? "alert" : "status"}
        />
      ) : null}

      {view.phase === "ok" ||
      view.phase === "degraded" ||
      view.phase === "empty" ? (
        <div className="stack-lg">
          <section className="panel panel-elevated" aria-labelledby="workers-status">
            <h2 id="workers-status" className="panel-title">
              Availability
            </h2>
            <div className="stack">
              <div className="data-row-main">
                <p className="data-primary" style={{ fontSize: "1.25rem" }}>
                  {mapped.label}
                </p>
                <StatusBadge tone={mapped.tone}>{data?.availability || "unavailable"}</StatusBadge>
              </div>
              <p className="data-meta" style={{ fontSize: "0.88rem", lineHeight: 1.55 }}>
                {mapped.detail}
              </p>
              {data?.schemaVersion != null ? (
                <p className="data-meta">
                  Schema version: {String(data.schemaVersion)}
                </p>
              ) : (
                <p className="data-meta">Schema version not reported.</p>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="workers-limits">
            <h2 id="workers-limits" className="panel-title">
              Phase 1 limits
            </h2>
            <ul className="prose-list">
              <li>No process lists, CPU, or memory gauges.</li>
              <li>No invented worker counts when observability is offline.</li>
              <li>
                Status values are limited to what the API returns (typically{" "}
                <strong>unavailable</strong> or <strong>degraded</strong>).
              </li>
            </ul>
          </section>
        </div>
      ) : null}
    </PageChrome>
  );
}
