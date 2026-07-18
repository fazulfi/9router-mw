/**
 * Cross-worker circuit breaker (Fase 4).
 * Key: mw:cb:{accountId}  HASH { state, failures, successes, openedAt, halfOpenAt }
 * States: CLOSED | OPEN | HALF
 * Fail-open: Redis down → treat as CLOSED (allow traffic, degraded).
 */

import { withRedis } from "./redisClient.js";

const KEY_PREFIX = "mw:cb:";
const STATE_CLOSED = "CLOSED";
const STATE_OPEN = "OPEN";
const STATE_HALF = "HALF";

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_SUCCESS_THRESHOLD = 2;
const DEFAULT_OPEN_MS = 30_000;
const DEFAULT_TTL_SEC = 600;

/** @type {Map<string, { state: string, failures: number, successes: number, openedAt: number }>} */
const localCb = new Map();

function cbKey(accountId) {
  return `${KEY_PREFIX}${accountId}`;
}

function thresholds() {
  return {
    failureThreshold: Math.max(
      1,
      Number(process.env.MW_CB_FAILURE_THRESHOLD || DEFAULT_FAILURE_THRESHOLD) || DEFAULT_FAILURE_THRESHOLD,
    ),
    successThreshold: Math.max(
      1,
      Number(process.env.MW_CB_SUCCESS_THRESHOLD || DEFAULT_SUCCESS_THRESHOLD) || DEFAULT_SUCCESS_THRESHOLD,
    ),
    openMs: Math.max(1_000, Number(process.env.MW_CB_OPEN_MS || DEFAULT_OPEN_MS) || DEFAULT_OPEN_MS),
    ttlSec: Math.max(60, Number(process.env.MW_CB_TTL_SEC || DEFAULT_TTL_SEC) || DEFAULT_TTL_SEC),
  };
}

function emptyState() {
  return {
    state: STATE_CLOSED,
    failures: 0,
    successes: 0,
    openedAt: 0,
    mode: "local",
  };
}

function parseHash(hash) {
  if (!hash || typeof hash !== "object") return emptyState();
  return {
    state: hash.state || STATE_CLOSED,
    failures: Number(hash.failures || 0),
    successes: Number(hash.successes || 0),
    openedAt: Number(hash.openedAt || 0),
    mode: "redis",
  };
}

function maybeTransitionOpen(state, openMs) {
  if (state.state !== STATE_OPEN) return state;
  const openedAt = state.openedAt || 0;
  if (openedAt > 0 && Date.now() - openedAt >= openMs) {
    return { ...state, state: STATE_HALF, successes: 0 };
  }
  return state;
}

/**
 * @param {string} accountId
 * @returns {Promise<{ state: string, failures: number, successes: number, openedAt: number, mode: string, allow: boolean }>}
 */
export async function getBreakerState(accountId) {
  if (!accountId) {
    const s = emptyState();
    return { ...s, allow: true };
  }
  const { openMs } = thresholds();
  const key = cbKey(accountId);

  const state = await withRedis(
    async (redis) => {
      const hash = await redis.hgetall(key);
      if (!hash || Object.keys(hash).length === 0) {
        return { ...emptyState(), mode: "redis" };
      }
      return parseHash(hash);
    },
    () => {
      const local = localCb.get(accountId);
      return local ? { ...local, mode: "local" } : emptyState();
    },
  );

  const transitioned = maybeTransitionOpen(state, openMs);
  if (transitioned.state !== state.state && transitioned.mode === "redis") {
    // best-effort persist HALF transition
    await withRedis(
      async (redis) => {
        await redis.hset(key, "state", STATE_HALF, "successes", "0");
      },
      () => null,
    );
  } else if (transitioned.state !== state.state && transitioned.mode === "local") {
    localCb.set(accountId, {
      state: transitioned.state,
      failures: transitioned.failures,
      successes: transitioned.successes,
      openedAt: transitioned.openedAt,
    });
  }

  const allow = transitioned.state !== STATE_OPEN;
  return { ...transitioned, allow };
}

/**
 * @param {string} accountId
 */
export async function recordBreakerSuccess(accountId) {
  if (!accountId) return emptyState();
  const { successThreshold, ttlSec } = thresholds();
  const key = cbKey(accountId);

  return withRedis(
    async (redis) => {
      const hash = parseHash(await redis.hgetall(key));
      let next = { ...hash };

      if (next.state === STATE_HALF) {
        next.successes = (next.successes || 0) + 1;
        if (next.successes >= successThreshold) {
          next = { state: STATE_CLOSED, failures: 0, successes: 0, openedAt: 0, mode: "redis" };
        }
      } else if (next.state === STATE_CLOSED) {
        next.failures = 0;
        next.successes = 0;
      } else if (next.state === STATE_OPEN) {
        // success while OPEN shouldn't happen if we skip OPEN accounts
        next = { state: STATE_HALF, failures: next.failures, successes: 1, openedAt: next.openedAt, mode: "redis" };
      }

      await redis.hset(key, {
        state: next.state,
        failures: String(next.failures),
        successes: String(next.successes),
        openedAt: String(next.openedAt || 0),
      });
      await redis.expire(key, ttlSec);
      return next;
    },
    () => {
      const cur = localCb.get(accountId) || emptyState();
      let next = { ...cur, mode: "local" };
      if (next.state === STATE_HALF) {
        next.successes = (next.successes || 0) + 1;
        if (next.successes >= successThreshold) {
          next = { state: STATE_CLOSED, failures: 0, successes: 0, openedAt: 0, mode: "local" };
        }
      } else if (next.state === STATE_CLOSED) {
        next.failures = 0;
      }
      localCb.set(accountId, {
        state: next.state,
        failures: next.failures,
        successes: next.successes,
        openedAt: next.openedAt,
      });
      return next;
    },
  );
}

/**
 * @param {string} accountId
 */
export async function recordBreakerFailure(accountId) {
  if (!accountId) return emptyState();
  const { failureThreshold, ttlSec } = thresholds();
  const key = cbKey(accountId);

  return withRedis(
    async (redis) => {
      const hash = parseHash(await redis.hgetall(key));
      let next = { ...hash, mode: "redis" };

      if (next.state === STATE_HALF) {
        next = {
          state: STATE_OPEN,
          failures: (next.failures || 0) + 1,
          successes: 0,
          openedAt: Date.now(),
          mode: "redis",
        };
      } else {
        next.failures = (next.failures || 0) + 1;
        next.successes = 0;
        if (next.failures >= failureThreshold) {
          next.state = STATE_OPEN;
          next.openedAt = Date.now();
        } else {
          next.state = STATE_CLOSED;
        }
      }

      await redis.hset(key, {
        state: next.state,
        failures: String(next.failures),
        successes: String(next.successes),
        openedAt: String(next.openedAt || 0),
      });
      await redis.expire(key, ttlSec);
      return next;
    },
    () => {
      const cur = localCb.get(accountId) || emptyState();
      let next = { ...cur, mode: "local" };
      if (next.state === STATE_HALF) {
        next = {
          state: STATE_OPEN,
          failures: (next.failures || 0) + 1,
          successes: 0,
          openedAt: Date.now(),
          mode: "local",
        };
      } else {
        next.failures = (next.failures || 0) + 1;
        next.successes = 0;
        if (next.failures >= failureThreshold) {
          next.state = STATE_OPEN;
          next.openedAt = Date.now();
        } else {
          next.state = STATE_CLOSED;
        }
      }
      localCb.set(accountId, {
        state: next.state,
        failures: next.failures,
        successes: next.successes,
        openedAt: next.openedAt,
      });
      return next;
    },
  );
}

export function resetLocalBreaker() {
  localCb.clear();
}

export const BREAKER_STATES = { CLOSED: STATE_CLOSED, OPEN: STATE_OPEN, HALF: STATE_HALF };
export const CIRCUIT_BREAKER_KEY_PREFIX = KEY_PREFIX;
