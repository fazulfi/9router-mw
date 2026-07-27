/**
 * Redis-backed pending OAuth state — TDD tests.
 *
 * RED phase:  asserts that the current in-memory Map implementation does NOT
 *             persist state to Redis (expected failures before source change).
 * GREEN phase: same assertions pass after Redis-backed pendingState.js replaces
 *             the Map-based sync functions in server.js.
 *
 * Cross-worker harness: a shared fake Redis store simulates what a real
 * shared Redis instance provides across worker processes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ──────────────────────────────────────────────────────────────
// Shared fake Redis store — simulates a cross-worker coordination
// store.  Tests that write with one caller and read with another
// exercise the shared Redis path (not process-local Maps).
// ──────────────────────────────────────────────────────────────
const fakeRedisStore = new Map();
const fakeRedisTtls = new Map();

/**
 * Fake withRedis that routes fn(redis) or fallback() depending on
 * whether the test sets `useRedisFallback`.
 */
let useRedisFallback = false;

const fakeRedis = {
  get: async (key) => fakeRedisStore.get(key) || null,
  set: async (key, value, ...args) => {
    fakeRedisStore.set(key, value);
    const pxIndex = args.indexOf("PX");
    if (pxIndex >= 0) fakeRedisTtls.set(key, args[pxIndex + 1]);
    return "OK";
  },
  del: async (key) => {
    fakeRedisStore.delete(key);
    fakeRedisTtls.delete(key);
    return 1;
  },
};

vi.mock("open-sse/services/redisClient", () => ({
  getRedis: vi.fn(async () => (useRedisFallback ? null : fakeRedis)),
  resetRedisClient: vi.fn(),
  getRedisLastError: vi.fn(() => null),
  getRedisLastPingMs: vi.fn(() => -1),
  getRedisHealthSnapshot: vi.fn(() => ({ connected: true })),
}));

describe("Redis-backed pending OAuth state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeRedisStore.clear();
    fakeRedisTtls.clear();
    useRedisFallback = false;
    delete process.env.OAUTH_PENDING_TTL_MS;
    process.env.MW_RUNTIME_NAMESPACE = "test";
  });

  // ── register + get ────────────────────────────────────────

  describe("register + get", () => {
    it("stores a pending session and retrieves it by state", async () => {
      const { registerPendingSession, getPendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );

      const ok = await registerPendingSession("codex", {
        state: "s1",
        codeVerifier: "v1",
        redirectUri: "http://localhost:8080/callback",
      });
      expect(ok).toBe(true);

      // Must be visible via Redis shared store
      const raw = fakeRedisStore.get("mw:test:oauth:pending:codex:s1");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw);
      expect(parsed.status).toBe("pending");
      expect(parsed.codeVerifier).toBe("v1");
      expect(parsed.createdAt).toBeGreaterThan(0);

      // getPendingSession returns a fresh copy
      const session = await getPendingSession("codex", "s1");
      expect(session).not.toBeNull();
      expect(session.status).toBe("pending");
      expect(session.codeVerifier).toBe("v1");
      expect(session.redirectUri).toBe("http://localhost:8080/callback");
    });

    it("returns null for non-existent state", async () => {
      const { getPendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );
      const session = await getPendingSession("codex", "nonexistent");
      expect(session).toBeNull();
    });

    it("returns false when required fields are missing", async () => {
      const { registerPendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );
      // Simulate how current code would call it
      const ret = await registerPendingSession("codex", {
        state: "only-state",
        // missing codeVerifier and redirectUri
      });
      // Expected: The implementation checks these and returns false
      expect(ret).toBe(false);
    });
  });

  // ── update to done / error ────────────────────────────────

  describe("update (persist-back pattern, no in-place mutation)", () => {
    it("updates a session to 'done' status and persists full state to Redis", async () => {
      const { registerPendingSession, getPendingSession, updatePendingSession } =
        await import("../../src/lib/oauth/utils/pendingState.js");

      await registerPendingSession("codex", {
        state: "s2",
        codeVerifier: "v2",
        redirectUri: "http://localhost:8080/callback",
      });

      // Update: persist the full updated object back to Redis
      const updated = await updatePendingSession("codex", "s2", {
        status: "done",
        connectionId: "conn-1",
        email: "test@test.com",
      });

      expect(updated).not.toBeNull();
      expect(updated.status).toBe("done");
      expect(updated.connectionId).toBe("conn-1");
      expect(updated.email).toBe("test@test.com");
      // Original fields preserved
      expect(updated.codeVerifier).toBe("v2");

      // Verify Redis contains the updated state (not the original)
      const raw = fakeRedisStore.get("mw:test:oauth:pending:codex:s2");
      const stored = JSON.parse(raw);
      expect(stored.status).toBe("done");

      // getPendingSession must return the updated state (fresh copy)
      const retrieved = await getPendingSession("codex", "s2");
      expect(retrieved.status).toBe("done");
      expect(retrieved.connectionId).toBe("conn-1");

      // Mutating the returned object must NOT affect Redis
      retrieved.status = "mutated";
      const rawAfterMutate = fakeRedisStore.get("mw:test:oauth:pending:codex:s2");
      expect(JSON.parse(rawAfterMutate).status).toBe("done");
    });

    it("updates a session to 'error' status with error message", async () => {
      const { registerPendingSession, updatePendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );

      await registerPendingSession("xai", {
        state: "s3",
        codeVerifier: "v3",
        redirectUri: "http://localhost:56121/callback",
      });

      const updated = await updatePendingSession("xai", "s3", {
        status: "error",
        error: "Authorization denied",
      });

      expect(updated.status).toBe("error");
      expect(updated.error).toBe("Authorization denied");

      // Redis confirms persisted error state
      const raw = fakeRedisStore.get("mw:test:oauth:pending:xai:s3");
      expect(JSON.parse(raw).status).toBe("error");
    });

    it("returns null when updating a non-existent session", async () => {
      const { updatePendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );
      const result = await updatePendingSession("codex", "ghost", {
        status: "done",
      });
      expect(result).toBeNull();
    });
  });

  // ── delete ────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes a session after polling is complete", async () => {
      const { registerPendingSession, getPendingSession, deletePendingSession } =
        await import("../../src/lib/oauth/utils/pendingState.js");

      await registerPendingSession("codex", {
        state: "s4",
        codeVerifier: "v4",
        redirectUri: "http://localhost:8080/callback",
      });
      expect(fakeRedisStore.has("mw:test:oauth:pending:codex:s4")).toBe(true);

      await deletePendingSession("codex", "s4");
      expect(fakeRedisStore.has("mw:test:oauth:pending:codex:s4")).toBe(false);
      expect(await getPendingSession("codex", "s4")).toBeNull();
    });

    it("is safe to delete a non-existent session", async () => {
      const { deletePendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );
      // Must not throw
      await expect(
        deletePendingSession("codex", "does-not-exist")
      ).resolves.toBeUndefined();
    });
  });

  // ── cross-worker / shared Redis ───────────────────────────

  describe("cross-worker behavior (shared Redis)", () => {
    it("session written by one caller is visible to another", async () => {
      const { registerPendingSession, getPendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );

      // "Worker 1" registers
      await registerPendingSession("codex", {
        state: "cross-s1",
        codeVerifier: "cross-v1",
        redirectUri: "http://localhost:8080/callback",
      });

      // "Worker 2" reads via shared Redis store
      const session = await getPendingSession("codex", "cross-s1");
      expect(session).not.toBeNull();
      expect(session.codeVerifier).toBe("cross-v1");
    });

    it("update by one caller is visible to another", async () => {
      const { registerPendingSession, updatePendingSession, getPendingSession } =
        await import("../../src/lib/oauth/utils/pendingState.js");

      // Register
      await registerPendingSession("codex", {
        state: "cross-s2",
        codeVerifier: "cross-v2",
        redirectUri: "http://localhost:8080/callback",
      });

      // "Worker A" updates to done
      await updatePendingSession("codex", "cross-s2", {
        status: "done",
        connectionId: "conn-99",
      });

      // "Worker B" reads the updated state
      const session = await getPendingSession("codex", "cross-s2");
      expect(session.status).toBe("done");
      expect(session.connectionId).toBe("conn-99");
    });
  });

  // ── provider namespace separation ─────────────────────────

  describe("provider namespace separation", () => {
    it("codex and xai states with same state value do not collide", async () => {
      const { registerPendingSession, getPendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );

      await registerPendingSession("codex", {
        state: "same-state",
        codeVerifier: "codex-verifier",
        redirectUri: "http://localhost:8080/callback",
      });
      await registerPendingSession("xai", {
        state: "same-state",
        codeVerifier: "xai-verifier",
        redirectUri: "http://localhost:56121/callback",
      });

      const codexSession = await getPendingSession("codex", "same-state");
      expect(codexSession.codeVerifier).toBe("codex-verifier");

      const xaiSession = await getPendingSession("xai", "same-state");
      expect(xaiSession.codeVerifier).toBe("xai-verifier");
    });

    it("uses distinct Redis key prefixes per provider", async () => {
      // This test shows that the keys themselves are namespaced
      await (
        await import("../../src/lib/oauth/utils/pendingState.js")
      ).registerPendingSession("codex", {
        state: "ns-1",
        codeVerifier: "cv",
        redirectUri: "http://localhost:8080/callback",
      });
      await (
        await import("../../src/lib/oauth/utils/pendingState.js")
      ).registerPendingSession("xai", {
        state: "ns-1",
        codeVerifier: "cv",
        redirectUri: "http://localhost:56121/callback",
      });

      const keys = [...fakeRedisStore.keys()].sort();
      expect(keys).toEqual([
        "mw:test:oauth:pending:codex:ns-1",
        "mw:test:oauth:pending:xai:ns-1",
      ]);
    });
  });

  // ── TTL ───────────────────────────────────────────────────

  describe("TTL (configurable, default 300 s)", () => {
    it("sets PX TTL on Redis key when registering", async () => {
      const { registerPendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );

      await registerPendingSession("codex", {
        state: "ttl-1",
        codeVerifier: "ttl-v",
        redirectUri: "http://localhost:8080/callback",
      });

      expect(fakeRedisTtls.get("mw:test:oauth:pending:codex:ttl-1")).toBe(300_000);
    });

    it("respects OAUTH_PENDING_TTL_MS environment variable", async () => {
      process.env.OAUTH_PENDING_TTL_MS = "5000"; // 5 seconds

      const { registerPendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );

      await registerPendingSession("codex", {
        state: "ttl-env",
        codeVerifier: "ttl-ev",
        redirectUri: "http://localhost:8080/callback",
      });

      expect(fakeRedisTtls.get("mw:test:oauth:pending:codex:ttl-env")).toBe(5_000);
    });
  });

  describe("Redis-unavailable behavior", () => {
    it("fails registration instead of recreating process-local OAuth state", async () => {
      useRedisFallback = true;
      const { registerPendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );

      await expect(
        registerPendingSession("codex", {
          state: "redis-down",
          codeVerifier: "verifier",
          redirectUri: "http://localhost:8080/callback",
        })
      ).rejects.toThrow("OAuth session store unavailable");
    });

    it("fails reads and updates when the shared store is unavailable", async () => {
      useRedisFallback = true;
      const { getPendingSession, updatePendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );

      await expect(getPendingSession("codex", "state")).rejects.toThrow(
        "OAuth session store unavailable"
      );
      await expect(
        updatePendingSession("codex", "state", { status: "done" })
      ).rejects.toThrow("OAuth session store unavailable");
    });
  });

  // ── server.js integration tests ──────────────────────────

  describe("server.js integration (async session API)", () => {
    it("registerCodexSession is async and persists to shared store", async () => {
      const { registerCodexSession, getCodexSessionStatus, clearCodexSession } =
        await import("../../src/lib/oauth/utils/server.js");

      // RED phase: registerCodexSession is sync and uses Map, not Redis
      // GREEN phase: registerCodexSession is async and uses Redis
      const ok = await registerCodexSession({
        state: "integ-s1",
        codeVerifier: "integ-v1",
        redirectUri: "http://localhost:8080/callback",
      });
      expect(ok).toBe(true);

      // Must be in Redis shared store (not just local Map)
      const raw = fakeRedisStore.get("mw:test:oauth:pending:codex:integ-s1");
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw).codeVerifier).toBe("integ-v1");

      // getCodexSessionStatus returns the session (async)
      const session = await getCodexSessionStatus("integ-s1");
      expect(session).not.toBeNull();
      expect(session.status).toBe("pending");

      // After clear, session is gone
      await clearCodexSession("integ-s1");
      expect(await getCodexSessionStatus("integ-s1")).toBeNull();
    });

    it("registerXaiSession is async with xai namespace", async () => {
      const { registerXaiSession, getXaiSessionStatus, clearXaiSession } =
        await import("../../src/lib/oauth/utils/server.js");

      await registerXaiSession({
        state: "integ-x1",
        codeVerifier: "integ-xv1",
        redirectUri: "http://localhost:56121/callback",
      });

      const raw = fakeRedisStore.get("mw:test:oauth:pending:xai:integ-x1");
      expect(raw).toBeTruthy();

      const session = await getXaiSessionStatus("integ-x1");
      expect(session.status).toBe("pending");

      await clearXaiSession("integ-x1");
      expect(await getXaiSessionStatus("integ-x1")).toBeNull();
    });

    it("proxy callback persists done/error back to Redis (no in-place mutation)", async () => {
      // Simulate what the proxy handler does:
      // Instead of session.status = "done", it calls updatePendingSession
      const {
        registerCodexSession,
        getCodexSessionStatus,
        clearCodexSession,
      } = await import("../../src/lib/oauth/utils/server.js");
      const { updatePendingSession } = await import(
        "../../src/lib/oauth/utils/pendingState.js"
      );

      await registerCodexSession({
        state: "proxy-integ",
        codeVerifier: "pv",
        redirectUri: "http://localhost:8080/callback",
      });

      // Simulate proxy completing the exchange (instead of session.status = "done")
      const updated = await updatePendingSession("codex", "proxy-integ", {
        status: "done",
        connectionId: "proxy-conn-1",
        email: "proxy@test.com",
      });
      expect(updated.status).toBe("done");

      // Verify Redis has the full updated state
      const raw = fakeRedisStore.get("mw:test:oauth:pending:codex:proxy-integ");
      const stored = JSON.parse(raw);
      expect(stored.status).toBe("done");
      expect(stored.connectionId).toBe("proxy-conn-1");

      // getCodexSessionStatus returns done state
      const session = await getCodexSessionStatus("proxy-integ");
      expect(session.status).toBe("done");
    });
  });
});
