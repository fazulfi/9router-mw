import { getRedis } from "open-sse/services/redisClient";

const DEFAULT_TTL_MS = 300_000;

function redisKey(provider, state) {
  const namespace = process.env.MW_RUNTIME_NAMESPACE || process.env.PORT || "default";
  return `mw:${namespace}:oauth:pending:${provider}:${state}`;
}

function getEffectiveTTL() {
  const value = Number(process.env.OAUTH_PENDING_TTL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TTL_MS;
}

async function requireRedis() {
  const redis = await getRedis();
  if (!redis) throw new Error("OAuth session store unavailable");
  return redis;
}

export async function registerPendingSession(provider, { state, codeVerifier, redirectUri }) {
  if (!state || !codeVerifier || !redirectUri) return false;

  const entry = {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  };
  const redis = await requireRedis();
  await redis.set(redisKey(provider, state), JSON.stringify(entry), "PX", getEffectiveTTL());
  return true;
}

export async function getPendingSession(provider, state) {
  if (!state) return null;
  const redis = await requireRedis();
  const raw = await redis.get(redisKey(provider, state));
  return raw ? JSON.parse(raw) : null;
}

export async function updatePendingSession(provider, state, updates) {
  if (!state) return null;
  const redis = await requireRedis();
  const key = redisKey(provider, state);
  const raw = await redis.get(key);
  if (!raw) return null;
  const updated = { ...JSON.parse(raw), ...updates };
  await redis.set(key, JSON.stringify(updated), "PX", getEffectiveTTL());
  return updated;
}

export async function deletePendingSession(provider, state) {
  if (!state) return;
  const redis = await requireRedis();
  await redis.del(redisKey(provider, state));
}
