import { randomUUID } from "node:crypto";
import { getRedis } from "../../../open-sse/services/redisClient.js";

const RUNTIME_NAMESPACE = process.env.MW_RUNTIME_NAMESPACE?.trim() || process.env.PORT?.trim() || "default";
const WRITE_QUEUE_KEY = `mw:${RUNTIME_NAMESPACE}:write:queue`;
const RESPONSE_QUEUE_KEY = `mw:${RUNTIME_NAMESPACE}:write:responses:${process.env.MW_WORKER_ID || process.pid}`;
const RPC_TIMEOUT_MS = Math.max(1000, Number(process.env.MW_WRITER_RPC_TIMEOUT_MS) || 30000);

const pending = new Map();
let responseClient = null;
let responseLoopStarted = false;

export function shouldUseWriterRpc() {
  return Boolean(process.env.MW_WORKER_ID) && process.env.MW_WRITER_MODE !== "0" && process.env.MW_WRITER_PROCESS !== "1";
}

async function startResponseLoop(redis) {
  if (responseLoopStarted) return;
  responseLoopStarted = true;
  responseClient = redis.duplicate();
  await responseClient.connect();

  void (async () => {
    while (responseLoopStarted) {
      try {
        const response = await responseClient.blpop(RESPONSE_QUEUE_KEY, 1);
        if (!response) continue;
        const message = JSON.parse(response[1]);
        const waiter = pending.get(message.correlationId);
        if (!waiter) continue;
        pending.delete(message.correlationId);
        clearTimeout(waiter.timer);
        if (message.ok) waiter.resolve(message.result);
        else waiter.reject(new Error(message.error || "writer command failed"));
      } catch (error) {
        if (responseLoopStarted) {
          for (const waiter of pending.values()) {
            clearTimeout(waiter.timer);
            waiter.reject(error);
          }
          pending.clear();
        }
      }
    }
  })();
}

export async function executeWriterCommand(command, args = []) {
  if (!shouldUseWriterRpc()) {
    throw new Error("writer RPC is only available in cluster workers");
  }

  const redis = await getRedis();
  if (!redis) throw new Error("writer RPC Redis unavailable");
  await startResponseLoop(redis);

  const correlationId = randomUUID();
  const request = {
    correlationId,
    namespace: RUNTIME_NAMESPACE,
    command,
    args,
    workerId: process.env.MW_WORKER_ID,
    responseKey: RESPONSE_QUEUE_KEY,
    issuedAt: Date.now(),
  };

  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(correlationId);
      reject(new Error(`writer RPC timeout: ${command}`));
    }, RPC_TIMEOUT_MS);
    timer.unref?.();
    pending.set(correlationId, { resolve, reject, timer });
  });

  try {
    await redis.rpush(WRITE_QUEUE_KEY, JSON.stringify(request));
  } catch (error) {
    const waiter = pending.get(correlationId);
    if (waiter) clearTimeout(waiter.timer);
    pending.delete(correlationId);
    throw error;
  }
  return result;
}

export async function drainWriterCommands(batchSize = 50) {
  const redis = await getRedis();
  if (!redis) return [];
  const requests = [];
  for (let index = 0; index < batchSize; index += 1) {
    const raw = await redis.lpop(WRITE_QUEUE_KEY);
    if (raw == null) break;
    try {
      const request = JSON.parse(raw);
      if (request.namespace === RUNTIME_NAMESPACE && request.correlationId && request.command && request.responseKey) {
        requests.push(request);
      }
    } catch {}
  }
  return requests;
}

export async function sendWriterResponse(request, response) {
  const redis = await getRedis();
  if (!redis) throw new Error("writer response Redis unavailable");
  await redis.rpush(request.responseKey, JSON.stringify({ correlationId: request.correlationId, ...response }));
  await redis.expire(request.responseKey, 60);
}

export function getWriterRuntimeNamespace() {
  return RUNTIME_NAMESPACE;
}

export { WRITE_QUEUE_KEY, RESPONSE_QUEUE_KEY };
