const REQUEST_PHASE_NAMES = [
  "ingress_ms",
  "auth_ms",
  "routing_ms",
  "db_ms",
  "translation_ms",
  "compression_ms",
  "local_before_dispatch_ms",
  "upstream_headers_ms",
  "response_ms",
];

const REQUEST_PHASE_SET = new Set(REQUEST_PHASE_NAMES);

function normalizeMilliseconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) ? rounded : null;
}

export function sanitizeRequestPhases(phases) {
  const sanitized = {};
  for (const name of REQUEST_PHASE_NAMES) {
    const value = normalizeMilliseconds(phases?.[name]);
    if (value !== null) sanitized[name] = value;
  }
  return sanitized;
}

export function recordRequestPhase(phases, name, startedAt, endedAt = Date.now()) {
  if (!phases || !REQUEST_PHASE_SET.has(name)) return;
  const duration = normalizeMilliseconds(endedAt - startedAt);
  if (duration === null) return;
  const current = normalizeMilliseconds(phases[name]) ?? 0;
  const total = normalizeMilliseconds(current + duration);
  if (total !== null) phases[name] = total;
}

export async function measureRequestPhase(phases, name, operation) {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    recordRequestPhase(phases, name, startedAt);
  }
}

export function finalizeRequestPhases(phases, responseStartedAt, endedAt = Date.now()) {
  const finalized = sanitizeRequestPhases(phases);
  if (Number.isFinite(responseStartedAt)) {
    recordRequestPhase(finalized, "response_ms", responseStartedAt, endedAt);
  }
  return finalized;
}

export function cloneRequestTiming(timing) {
  return {
    startedAt: Number.isFinite(timing?.startedAt) ? timing.startedAt : Date.now(),
    phases: sanitizeRequestPhases(timing?.phases),
  };
}
