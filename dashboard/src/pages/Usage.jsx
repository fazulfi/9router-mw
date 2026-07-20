import { useState } from "react";
import { fetchUsage, USAGE_PERIODS } from "../lib/api.js";
import { useMwResource } from "../hooks/useMwResource.js";
import { PageChrome } from "../components/PageChrome.jsx";
import {
  EmptyBlock,
  LoadingBlock,
  StateBanner,
} from "../components/StateBanner.jsx";
import { formatCount } from "../lib/state.js";

export default function UsagePage() {
  const [period, setPeriod] = useState("24h");
  const { view, data } = useMwResource(
    (opts) => fetchUsage(period, opts),
    [period],
  );

  return (
    <PageChrome
      title="Usage"
      description="Aggregated request and token totals for the selected window. Periods: 24h, 7d, 30d. Zero values mean no traffic."
    >
      <div className="chip-row" role="group" aria-label="Usage period">
        {USAGE_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            className="chip"
            aria-pressed={period === p}
            onClick={() => setPeriod(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {view.phase === "loading" ? <LoadingBlock label="Loading usage" /> : null}

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
          <div className="stat-grid">
            <article className="stat-card">
              <p className="stat-label">Period</p>
              <p className="stat-value" style={{ fontSize: "1.25rem" }}>
                {data?.period || period}
              </p>
              <p className="stat-hint">Server-projected window</p>
            </article>
            <article className="stat-card">
              <p className="stat-label">Requests</p>
              <p className="stat-value">{formatCount(data?.totalRequests)}</p>
              <p className="stat-hint">Total requests</p>
            </article>
            <article className="stat-card">
              <p className="stat-label">Tokens</p>
              <p className="stat-value">{formatCount(data?.totalTokens)}</p>
              <p className="stat-hint">Total tokens</p>
            </article>
            <article className="stat-card">
              <p className="stat-label">Success / errors</p>
              <p className="stat-value" style={{ fontSize: "1.25rem" }}>
                {formatCount(data?.successCount)}
                <span style={{ color: "var(--color-subtle)", fontWeight: 500 }}>
                  {" "}
                  / {formatCount(data?.errorCount)}
                </span>
              </p>
              <p className="stat-hint">Outcome counts</p>
            </article>
          </div>

          {view.showEmpty ? (
            <div style={{ marginTop: "1rem" }}>
              <EmptyBlock
                title="No usage in this window"
                message="All aggregate counters are zero for the selected period. A zero value means quiet traffic — the data is real, not missing."
              />
            </div>
          ) : null}
        </>
      ) : null}
    </PageChrome>
  );
}
