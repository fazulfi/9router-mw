import { fetchWorkers } from "../lib/api.js";
import { useMwResource } from "../hooks/useMwResource.js";
import { PageChrome } from "../components/PageChrome.jsx";
import {
  EmptyBlock,
  LoadingBlock,
  StateBanner,
  StatusBadge,
} from "../components/StateBanner.jsx";
import { mapWorkerAvailability } from "../lib/state.js";

const WORKER_HONEST_FIELDS = [
  "availability",
  "schemaVersion",
  "expectedCount",
  "freshCount",
  "missingWorkerIds",
];
const WORKER_PER_WORKER_FIELDS = ["workerId", "status", "observedAt", "ageMs"];

function projectHonest(data) {
  if (!data || typeof data !== "object") return {};
  const out = {};
  for (const k of WORKER_HONEST_FIELDS) {
    if (data[k] != null) out[k] = data[k];
  }
  return out;
}

function projectPerWorker(workers) {
  if (!Array.isArray(workers)) return [];
  const out = [];
  for (const w of workers) {
    if (!w || typeof w !== "object") continue;
    const safe = {};
    for (const k of WORKER_PER_WORKER_FIELDS) {
      if (w[k] != null) safe[k] = w[k];
    }
    // Require the allowlisted core fields to be valid
    if (
      typeof safe.workerId !== "string" ||
      typeof safe.status !== "string" ||
      typeof safe.observedAt !== "number" ||
      typeof safe.ageMs !== "number"
    ) {
      continue;
    }
    out.push(safe);
  }
  return out;
}

function formatCount(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

function formatAge(ageMs) {
  if (ageMs == null) return "—";
  const n = Number(ageMs);
  if (!Number.isFinite(n)) return "—";
  if (n < 1_000) return `${n} ms`;
  if (n < 60_000) return `${(n / 1_000).toFixed(1)} s`;
  return `${(n / 60_000).toFixed(1)} m`;
}

export default function WorkersPage() {
  const { view, data } = useMwResource(fetchWorkers, []);
  const mapped = mapWorkerAvailability(data?.availability);
  const honest = projectHonest(data);
  const cards = projectPerWorker(data?.workers);
  const hasExpected = honest.expectedCount != null;
  const hasFresh = honest.freshCount != null;
  const hasSchema = honest.schemaVersion != null;
  const missingIds = Array.isArray(honest.missingWorkerIds)
    ? honest.missingWorkerIds.slice().sort()
    : [];

  return (
    <PageChrome
      title="Workers"
      description="Worker availability reflects what the backend reports. No process IDs, hostnames, or load metrics are shown unless the backend provides them."
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
                <StatusBadge tone={mapped.tone}>
                  {honest.availability || "unavailable"}
                </StatusBadge>
              </div>
              <p
                className="data-meta"
                style={{ fontSize: "0.88rem", lineHeight: 1.55 }}
              >
                {mapped.detail}
              </p>
              {hasSchema ? (
                <p className="data-meta">
                  Schema version: {String(honest.schemaVersion)}
                </p>
              ) : null}
            </div>
          </section>

          <section className="panel panel-elevated" aria-labelledby="workers-counts">
            <h2 id="workers-counts" className="panel-title">
              Reported counts
            </h2>
            {hasExpected || hasFresh ? (
              <div className="stat-grid">
                <article className="stat-card">
                  <p className="stat-label">Expected</p>
                  <p className="stat-value">{formatCount(honest.expectedCount)}</p>
                  <p className="stat-hint">Workers expected by the backend</p>
                </article>
                <article className="stat-card">
                  <p className="stat-label">Fresh</p>
                  <p className="stat-value">{formatCount(honest.freshCount)}</p>
                  <p className="stat-hint">Workers reporting a recent heartbeat</p>
                </article>
              </div>
            ) : (
              <EmptyBlock
                title="No worker counts available"
                message="The backend did not report expected or fresh worker counts. This view only shows what the API returns."
              />
            )}
          </section>

          <section className="panel panel-elevated" aria-labelledby="workers-cards">
            <h2 id="workers-cards" className="panel-title">
              Per-worker cards
            </h2>
            {cards.length > 0 ? (
              <ul className="stat-grid" aria-label="Worker cards">
                {cards.map((w) => (
                  <li
                    key={w.workerId}
                    className="stat-card"
                    data-worker-id={w.workerId}
                  >
                    <p className="stat-label">Worker {w.workerId}</p>
                    <p className="stat-value" style={{ fontSize: "1.5rem" }}>
                      {w.status}
                    </p>
                    <p className="stat-hint">Age: {formatAge(w.ageMs)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyBlock
                title="No fresh workers to display"
                message="No worker reported a fresh heartbeat in the bounded MGET range. This view only renders when the backend provides safe worker fields."
              />
            )}
            {missingIds.length > 0 ? (
              <p
                className="data-meta"
                style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}
              >
                Missing slots: {missingIds.join(", ")}
              </p>
            ) : null}
            <p className="data-meta" style={{ fontSize: "0.8rem", marginTop: "0.75rem" }}>
              Per-worker telemetry: workerId, status, observedAt, ageMs only.
            </p>
          </section>


        </div>
      ) : null}
    </PageChrome>
  );
}
