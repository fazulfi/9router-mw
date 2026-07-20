import { fetchRedis } from "../lib/api.js";
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
} from "../lib/state.js";

function ActiveList({ rows }) {
  if (!rows?.length) {
    return (
      <EmptyBlock
        title="No active counters"
        message="The bounded active set is empty. The cluster may be idle, or Redis live counters are not populated."
      />
    );
  }
  return (
    <div className="data-list">
      {rows.map((row, i) => (
        <article
          key={`${row.connectionId || "c"}-${row.model || "m"}-${i}`}
          className="data-row"
        >
          <div className="data-row-main">
            <p className="data-primary">{row.model || "—"}</p>
            <span className="data-meta">{formatCount(row.count)}</span>
          </div>
          <p className="data-meta">
            connection · {row.connectionId || "—"}
          </p>
        </article>
      ))}
    </div>
  );
}

function RecentList({ rows }) {
  if (!rows?.length) {
    return (
      <EmptyBlock
        title="No recent events"
        message="The allowlisted recent list is empty."
      />
    );
  }
  return (
    <div className="data-list">
      {rows.map((row, i) => (
        <article
          key={`${row.timestamp || i}-${row.model || ""}-${i}`}
          className="data-row"
        >
          <div className="data-row-main">
            <p className="data-primary">
              {row.provider || "provider"} · {row.model || "model"}
            </p>
            <StatusBadge
              tone={
                String(row.status || "").toLowerCase().includes("err")
                  ? "danger"
                  : "neutral"
              }
              dot={false}
            >
              {row.status || "—"}
            </StatusBadge>
          </div>
          <p className="data-meta">
            {[
              row.endpoint ? `endpoint ${row.endpoint}` : null,
              row.tokens != null ? `${formatCount(row.tokens)} tokens` : null,
              row.connectionId ? `conn ${row.connectionId}` : null,
              row.timestamp ? String(row.timestamp) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </article>
      ))}
    </div>
  );
}

export default function RedisPage() {
  const { view, data } = useMwResource(fetchRedis, []);
  const { snapshot, connection } = useDashboardSSE({
    enabled: view.phase !== "unauthenticated",
  });

  const mode = mapRedisMode(data?.mode);
  const lastError = formatLastError(data?.lastError);
  const active = snapshot?.active?.length ? snapshot.active : data?.active || [];
  const recent = snapshot?.recent?.length ? snapshot.recent : data?.recent || [];

  return (
    <PageChrome
      title="Redis"
      description="Bounded live snapshot — SCAN/GET/LRANGE allowlisted fields only. Never KEYS. Stream updates via /mw/api/v1/stream."
      actions={<StatusBadge tone={mode.tone}>{mode.label}</StatusBadge>}
    >
      {view.phase === "loading" ? <LoadingBlock label="Loading Redis snapshot" /> : null}

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
          {lastError ? (
            <StateBanner tone="warning" title="Last error" message={lastError} />
          ) : null}

          <p className="data-meta">
            Live stream: <strong>{connection}</strong>
            {snapshot ? " · last frame applied" : " · waiting for SSE frame"}
          </p>

          <section className="panel panel-elevated" aria-labelledby="active-heading">
            <h2 id="active-heading" className="panel-title">
              Active ({active.length})
            </h2>
            <ActiveList rows={active} />
          </section>

          <section className="panel panel-elevated" aria-labelledby="recent-heading">
            <h2 id="recent-heading" className="panel-title">
              Recent ({recent.length})
            </h2>
            <RecentList rows={recent} />
          </section>
        </div>
      ) : null}
    </PageChrome>
  );
}
