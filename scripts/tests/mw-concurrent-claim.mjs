#!/usr/bin/env node
/**
 * Fase 4 exit test: concurrent account semaphore claim (no double-claim).
 * Same Redis key + Lua as open-sse/services/accountSemaphore.js (mw:sem:*, max=1).
 * Exit 0=PASS, 2=redis down, 1=assert fail, 4=wrong port
 */
import Redis from "ioredis";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 6381;
const KEY_PREFIX = "mw:sem:";
const ROUNDS = Number(process.env.MW_CLAIM_ROUNDS || 5);
const ACCOUNT_BASE = "mw-claim-test-" + Date.now();

const ACQUIRE_LUA = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local cur = tonumber(redis.call('GET', key) or '0')
if cur >= max then
  return {0, cur}
end
cur = redis.call('INCR', key)
if cur == 1 then
  redis.call('EXPIRE', key, ttl)
elseif redis.call('TTL', key) < 0 then
  redis.call('EXPIRE', key, ttl)
end
return {1, cur}
`;

const RELEASE_LUA = `
local key = KEYS[1]
local cur = tonumber(redis.call('GET', key) or '0')
if cur <= 0 then
  redis.call('DEL', key)
  return 0
end
cur = redis.call('DECR', key)
if cur <= 0 then
  redis.call('DEL', key)
  return 0
end
return cur
`;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function createClient() {
  const url = process.env.REDIS_URL && process.env.REDIS_URL.trim();
  const options = {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 1500,
    lazyConnect: true,
  };
  if (url) return new Redis(url, options);
  return new Redis({
    host: (process.env.REDIS_HOST && process.env.REDIS_HOST.trim()) || DEFAULT_HOST,
    port: Number(process.env.REDIS_PORT || DEFAULT_PORT) || DEFAULT_PORT,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0) || 0,
    ...options,
  });
}

async function acquire(redis, accountId, max = 1, ttlSec = 30) {
  const key = KEY_PREFIX + accountId;
  const result = await redis.eval(ACQUIRE_LUA, 1, key, String(max), String(ttlSec));
  return { acquired: Number(result && result[0]) === 1, count: Number((result && result[1]) || 0), key };
}

async function release(redis, accountId) {
  const key = KEY_PREFIX + accountId;
  return Number(await redis.eval(RELEASE_LUA, 1, key));
}

async function oneRound(redis, round) {
  const accountId = ACCOUNT_BASE + "-r" + round;
  const key = KEY_PREFIX + accountId;
  await redis.del(key);

  const pair = await Promise.all([acquire(redis, accountId, 1), acquire(redis, accountId, 1)]);
  const a = pair[0];
  const b = pair[1];
  const winners = [a, b].filter((x) => x.acquired);
  const losers = [a, b].filter((x) => !x.acquired);

  console.log(JSON.stringify({ round, accountId, a, b, winners: winners.length }));

  assert(winners.length === 1, "round " + round + ": expected exactly 1 winner, got " + winners.length);
  assert(losers.length === 1, "round " + round + ": expected exactly 1 loser, got " + losers.length);

  const third = await acquire(redis, accountId, 1);
  assert(!third.acquired, "round " + round + ": third acquire should fail while slot held");

  await release(redis, accountId);
  const after = await acquire(redis, accountId, 1);
  assert(after.acquired, "round " + round + ": acquire after release should succeed");
  await release(redis, accountId);

  const finalCount = Number((await redis.get(key)) || 0);
  assert(finalCount === 0, "round " + round + ": slot count should be 0, got " + finalCount);
  await redis.del(key);
  return { round, pass: true };
}

async function main() {
  console.log("=== mw-concurrent-claim (Fase 4) ===");
  console.log(
    JSON.stringify({
      REDIS_URL: process.env.REDIS_URL ? "[set]" : "[unset]",
      REDIS_HOST: process.env.REDIS_HOST || DEFAULT_HOST,
      REDIS_PORT: process.env.REDIS_PORT || String(DEFAULT_PORT),
      REDIS_PASSWORD: process.env.REDIS_PASSWORD ? "[set]" : "[unset]",
      ROUNDS,
      KEY_PREFIX,
    }),
  );

  const redis = createClient();
  try {
    await redis.connect();
    const pong = await redis.ping();
    console.log("redis_ping", pong);
    assert(pong === "PONG", "expected PONG from Redis");

    const port = (redis.options && redis.options.port) || Number(process.env.REDIS_PORT || DEFAULT_PORT);
    if (port !== 6381 && !process.env.MW_ALLOW_NON_6381) {
      console.error("FAIL: Redis port is " + port + "; MW requires dedicated 6381");
      process.exit(4);
    }

    const results = [];
    for (let i = 1; i <= ROUNDS; i++) {
      results.push(await oneRound(redis, i));
    }

    console.log("=== SUMMARY ===");
    console.log(JSON.stringify({ rounds: results.length, results }, null, 2));
    console.log("PASS: no double-claim across concurrent acquires (max=1, Redis mw:sem:*)");
    process.exit(0);
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("NOAUTH") || msg.includes("connect")) {
      console.error("FAIL: Redis not reachable on dedicated 6381");
      console.error(msg);
      process.exit(2);
    }
    console.error("FAIL:", (err && err.stack) || err);
    process.exit(1);
  } finally {
    try {
      redis.disconnect();
    } catch (e) {
      /* ignore */
    }
  }
}

main();