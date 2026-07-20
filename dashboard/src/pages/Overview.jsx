import { fetchOverview } from "../lib/api.js";
import { useMwResource } from "../hooks/useMwResource.js";
import { useDashboardSSE } from "../hooks/useDashboardSSE.js";
import { PageChrome } from "../components/PageChrome.jsx";
import {
  EmptyBlock,
  LoadingBlock,
  StateBanner,
  StatusBadge,
} from "../components/StateBanner.jsx";
import {
  formatCount,
  formatLastError,
  mapRedisMode,
  mapWorkerAvailability,
} from "../lib/state.js";

export default function OverviewPage() {
  const { view, data } = useMwResource(fetchOverview, []);
  const { snapshot, connection, errorMessage } = useDashboardSSE({
    enabled: view.phase !== "unauthenticated",
  });

  const redisMode = mapRedisMode(data?.redis?.mode);
  const workers = mapWorkerAvailability(data?.workers?.availability);
  const lastError = formatLastError(data?.redis?.lastError);
  const liveActive = snapshot?.active?.length ?? null;

  return (
    <PageChrome
      title="Overview"
      description="Bounded multi-worker health: Redis live counts and honest worker availability. No secrets, no mutations."
    >
      {view.phase === "loading" ? <LoadingBlock label="Loading overview" /> : null}

      {view.banner ? (
        <StateBanner
          tone={view.banner.tone}
          title={view.banner.title}
          message={view.banner.message}
          role={view.phase === "unauthenticated" ? "alert" : "status"}
        />
      ) : null}

      {view.phase === "ok" || view.phase === "degraded" || view.phase === "empty" ? (
        <div className="stack-lg">
          <div className="stat-grid">
            <article className="stat-card">
              <p className="stat-label">Redis mode</p>
              <p className="stat-value" style={{ fontSize: "1.15rem" }}>
                <StatusBadge tone={redisMode.tone}>{redisMode.label}</StatusBadge>
              </p>
              <p className="stat-hint">{redisMode.detail}</p>
            </article>

            <article className="stat-card">
              <p className="stat-label">Active counters</p>
              <p className="stat-value">
                {formatCount(data?.redis?.activeCount)}
              </p>
              <p className="stat-hint">Bounded live counter keys</p>
            </article>

            <article className="stat-card">
              <p className="stat-label">Recent events</p>
              <p className="stat-value">
                {formatCount(data?.redis?.recentCount)}
              </p>
              <p className="stat-hint">Allowlisted recent list length</p>
            </article>

            <article className="stat-card">
              <p className="stat-label">Workers</p>
              <p className="stat-value" style={{ fontSize: "1.15rem" }}>
                <StatusBadge tone={workers.tone}>{workers.label}</StatusBadge>
              </p>
              <p className="stat-hint">{workers.detail}</p>
            </article>
          </div>

          {lastError ? (
            <StateBanner
              tone="warning"
              title="Redis last error"
              message={lastError}
            />
          ) : null}

          <section className="panel panel-elevated" aria-labelledby="live-heading">
            <h2 id="live-heading" className="panel-title">
              Live stream
            </h2>
            <div className="stack">
              <div className="data-row-main">
                <p className="data-primary">SSE · /mw/api/v1/stream</p>
                <StatusBadge
                  tone={
                    connection === "open"
                      ? "ok"
                      : connection === "error"
                        ? "danger"
                        : "neutral"
                  }
                >
                  {connection}
                </StatusBadge>
              </div>
              {errorMessage ? (
                <p className="data-meta">{errorMessage}</p>
              ) : (
                <p className="data-meta">
                  {liveActive != null
                    ? `${liveActive} active row(s) in last stream frame`
                    : "Waiting for first stream frame…"}
                </p>
              )}
            </div>
          </section>

          {view.showEmpty ? (
            <EmptyBlock
              title="Quiet for now"
              message="Overview loaded, but Redis counts are empty or fully degraded. That is expected when the cluster is idle."
            />
          ) : null}
        </div>
      ) : null}
    </PageChrome>
  );
}
