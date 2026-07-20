import { useState } from "react";
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
  mapConnectionLabel,
  mapRedisMode,
} from "../lib/state.js";

const ACTIVE_INITIAL = 6;
const RECENT_INITIAL = 10;

function ActiveList({ rows, expanded, onToggle, total }) {
  const visible = expanded ? rows : rows.slice(0, ACTIVE_INITIAL);
  const overflow = rows.length - visible.length;
  if (rows.length === 0) {
    return (
      <EmptyBlock
        title="No active counters"
        message="The active set is empty. The cluster may be idle, or Redis live counters are not populated."
      />
    );
  }
  return (
    <>
      <div className="data-list" id="redis-active-list">
        {visible.map((row, i) => (
          <article
            key={`${row.model || "m"}-${i}`}
            className="data-row"
          >
            <div className="data-row-main">
              <p className="data-primary">{row.model || "—"}</p>
              <span className="data-meta">{formatCount(row.count)}</span>
            </div>
          </article>
        ))}
      </div>
      {overflow > 0 || expanded ? (
        <div style={{ marginTop: "0.85rem" }}>
          <button
            type="button"
            className="chip"
            aria-expanded={expanded}
            aria-controls="redis-active-list"
            onClick={onToggle}
          >
            {expanded
              ? "Show less"
              : `Show all ${total} active`}
          </button>
        </div>
      ) : null}
    </>
  );
}

function RecentList({ rows, expanded, onToggle, total }) {
  const visible = expanded ? rows : rows.slice(0, RECENT_INITIAL);
  const overflow = rows.length - visible.length;
  if (rows.length === 0) {
    return (
      <EmptyBlock
        title="No recent events"
        message="The recent list is empty."
      />
    );
  }
  return (
    <>
      <div className="data-list" id="redis-recent-list">
        {visible.map((row, i) => (
          <article
            key={`${row.timestamp || i}-${i}`}
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
                row.timestamp ? String(row.timestamp) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </article>
        ))}
      </div>
      {overflow > 0 || expanded ? (
        <div style={{ marginTop: "0.85rem" }}>
          <button
            type="button"
            className="chip"
            aria-expanded={expanded}
            aria-controls="redis-recent-list"
            onClick={onToggle}
          >
            {expanded
              ? "Show less"
              : `Show all ${total} recent`}
          </button>
        </div>
      ) : null}
    </>
  );
}

export default function RedisPage() {
  const { view, data } = useMwResource(fetchRedis, []);
  const { snapshot, connection } = useDashboardSSE({
    enabled: view.phase !== "unauthenticated",
  });

  const [activeExpanded, setActiveExpanded] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);

  const mode = mapRedisMode(data?.mode);
  const lastError = formatLastError(data?.lastError);
  const active = snapshot?.active?.length ? snapshot.active : data?.active || [];
  const recent = snapshot?.recent?.length ? snapshot.recent : data?.recent || [];

  return (
    <PageChrome
      title="Redis"
      description="Live snapshot from Redis. Read-only, allowlisted fields, no KEYS. Stream updates are same-origin."
      actions={
        <StatusBadge tone={mode.tone}>
          {mode.label}
        </StatusBadge>
      }
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

          <div className="data-row-main">
            <p className="data-meta">
              Live stream: <strong>{mapConnectionLabel(connection)}</strong>
              {snapshot ? " · last frame applied" : " · waiting for first frame"}
            </p>
          </div>

          <section className="panel panel-elevated" aria-labelledby="active-heading">
            <h2 id="active-heading" className="panel-title">
              Active ({active.length})
            </h2>
            <ActiveList
              rows={active}
              expanded={activeExpanded}
              onToggle={() => setActiveExpanded((v) => !v)}
              total={active.length}
            />
          </section>

          <section className="panel panel-elevated" aria-labelledby="recent-heading">
            <h2 id="recent-heading" className="panel-title">
              Recent ({recent.length})
            </h2>
            <RecentList
              rows={recent}
              expanded={recentExpanded}
              onToggle={() => setRecentExpanded((v) => !v)}
              total={recent.length}
            />
          </section>
        </div>
      ) : null}
    </PageChrome>
  );
}
