const REQUEST_PHASE_NAMES = [
  "ingress_ms",
  "auth_total_ms",
  "routing_total_ms",
  "db_overlap_ms",
  "translation_ms",
  "compression_ms",
  "request_before_dispatch_total_ms",
  "upstream_headers_ms",
  "response_ms",
  "fallback_total_ms",
];

const REQUEST_PHASE_SET = new Set(REQUEST_PHASE_NAMES);

export function requestNow() {
  return globalThis.performance.now();
}

function normalizeMilliseconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) ? rounded : null;
}

export function elapsedRequestMilliseconds(startedAt, endedAt = requestNow()) {
  return normalizeMilliseconds(endedAt - startedAt) ?? 0;
}

export function sanitizeRequestPhases(phases) {
  const sanitized = {};
  for (const name of REQUEST_PHASE_NAMES) {
    const value = normalizeMilliseconds(phases?.[name]);
    if (value !== null) sanitized[name] = value;
  }
  return sanitized;
}

export function recordRequestPhase(phases, name, startedAt, endedAt = requestNow()) {
  if (!phases || !REQUEST_PHASE_SET.has(name)) return;
  const duration = normalizeMilliseconds(endedAt - startedAt);
  if (duration === null) return;
  const current = normalizeMilliseconds(phases[name]) ?? 0;
  const total = normalizeMilliseconds(current + duration);
  if (total !== null) phases[name] = total;
}

export async function measureRequestPhase(phases, name, operation) {
  const startedAt = requestNow();
  try {
    return await operation();
  } finally {
    recordRequestPhase(phases, name, startedAt);
  }
}

export function finalizeRequestPhases(phases, responseStartedAt, endedAt = requestNow()) {
  const finalized = sanitizeRequestPhases(phases);
  if (Number.isFinite(responseStartedAt)) {
    recordRequestPhase(finalized, "response_ms", responseStartedAt, endedAt);
  }
  return finalized;
}

export function createRequestTiming() {
  return { requestStartedAt: requestNow(), phases: {} };
}

export function cloneRequestTiming(timing) {
  const cloned = {
    requestStartedAt: Number.isFinite(timing?.requestStartedAt)
      ? timing.requestStartedAt
      : requestNow(),
    phases: sanitizeRequestPhases(timing?.phases),
  };
  if (Number.isFinite(timing?.attemptStartedAt)) {
    cloned.attemptStartedAt = timing.attemptStartedAt;
  }
  return cloned;
}

export function snapshotRequestTiming(timing) {
  const snapshot = cloneRequestTiming(timing);
  Object.freeze(snapshot.phases);
  return Object.freeze(snapshot);
}

export function createAttemptTiming(admissionTiming, extraPhases) {
  const parent = cloneRequestTiming(admissionTiming);
  return {
    requestStartedAt: parent.requestStartedAt,
    attemptStartedAt: requestNow(),
    phases: {
      ...parent.phases,
      ...sanitizeRequestPhases(extraPhases),
    },
  };
}

export function buildRequestLatency(timing, {
  ttft = 0,
  responseStartedAt,
  endedAt = requestNow(),
  terminal = true,
} = {}) {
  const current = cloneRequestTiming(timing);
  const attemptStartedAt = Number.isFinite(current.attemptStartedAt)
    ? current.attemptStartedAt
    : current.requestStartedAt;
  return {
    ttft: normalizeMilliseconds(ttft) ?? 0,
    total: elapsedRequestMilliseconds(attemptStartedAt, endedAt),
    request_total: elapsedRequestMilliseconds(current.requestStartedAt, endedAt),
    phases: terminal
      ? finalizeRequestPhases(current.phases, responseStartedAt, endedAt)
      : sanitizeRequestPhases(current.phases),
  };
}
