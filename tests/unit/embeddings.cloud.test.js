/**
 * Unit tests for cloud/src/handlers/embeddings.js
 *
 * NOTE: The cloud/ directory (Cloudflare Worker handler) is not present in
 * this project. The actual embeddings handler lives in src/sse/handlers/embeddings.js
 * and has a different interface. This test file is preserved from upstream and
 * skipped when the cloud source is not available.
 */
import fs from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const CLOUD_HANDLER_PATH = new URL("../../cloud/src/handlers/embeddings.js", import.meta.url);
const cloudHandlerExists = fs.existsSync(CLOUD_HANDLER_PATH);

// ─── Module mocks (hoisted before imports) ───────────────────────────────────
// These register mocks at the vitest level. When the cloud source exists, they
// replace the real modules; when it doesn't, the mocks are harmless registrations.

vi.mock("../../open-sse/services/model.js", () => ({
  getModelInfoCore: vi.fn(),
}));

vi.mock("../../open-sse/handlers/embeddingsCore.js", () => ({
  handleEmbeddingsCore: vi.fn(),
}));

vi.mock("../../open-sse/utils/error.js", async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});

vi.mock("../../open-sse/services/accountFallback.js", async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});

// Cloud worker mocks — these are pure stubs that don't resolve the original file
vi.mock("../../cloud/src/utils/logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../cloud/src/utils/apiKey.js", () => ({
  parseApiKey: vi.fn(),
  extractBearerToken: vi.fn(),
}));

vi.mock("../../cloud/src/services/storage.js", () => ({
  getMachineData: vi.fn(),
  saveMachineData: vi.fn(),
}));

// ─── Conditional test execution ─────────────────────────────────────────────

if (!cloudHandlerExists) {
  describe("handleEmbeddings — cloud worker handler", () => {
    it("skipped: cloud/src/handlers/embeddings.js not found in this project", () => {
      expect(true).toBe(true);
    });
  });
} else {
  // Dynamic imports that only resolve when the source exists
  const cloudModule = await import("../../cloud/src/handlers/embeddings.js");
  const { handleEmbeddings } = cloudModule;
  const { getModelInfoCore } = await import("../../open-sse/services/model.js");
  const { handleEmbeddingsCore } = await import("../../open-sse/handlers/embeddingsCore.js");
  const { parseApiKey, extractBearerToken } = await import("../../cloud/src/utils/apiKey.js");
  const { getMachineData, saveMachineData } = await import("../../cloud/src/services/storage.js");

  // ─── Fixtures ─────────────────────────────────────────────────────────────────

  const MACHINE_ID = "mach01";
  const VALID_API_KEY = "sk-mach01-key01-ab12cd34";
  const VALID_EMBEDDING_RESPONSE_BODY = {
    object: "list",
    data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
    model: "text-embedding-ada-002",
    usage: { prompt_tokens: 3, total_tokens: 3 },
  };

  function makeEnv() {
    return { DB: {}, KV: {} };
  }

  function makeMachineData(overrides = {}) {
    return {
      machineId: MACHINE_ID,
      apiKeys: [{ key: VALID_API_KEY, label: "test" }],
      providers: {
        "conn-001": {
          provider: "openai",
          apiKey: "sk-openai-provider-key",
          isActive: true,
          priority: 1,
          status: "active",
          rateLimitedUntil: null,
          lastError: null,
        },
      },
      modelAliases: {},
      ...overrides,
    };
  }

  function makeRequest(method = "POST", body = null, authHeader = `Bearer ${VALID_API_KEY}`) {
    const headers = { "Content-Type": "application/json" };
    if (authHeader) headers["Authorization"] = authHeader;
    return new Request("https://9cli.hxd.app/v1/embeddings", {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // ─── Tests ────────────────────────────────────────────────────────────────────

  describe("handleEmbeddings — cloud worker handler", () => {

    describe("CORS OPTIONS", () => {
      it("OPTIONS request → 200 with Access-Control-Allow-Origin: *", async () => {
        const req = makeRequest("OPTIONS", null, null);
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(200);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
        expect(res.headers.get("Access-Control-Allow-Methods")).toMatch(/POST/);
      });

      it("OPTIONS request → body is empty/null", async () => {
        const req = makeRequest("OPTIONS", null, null);
        const res = await handleEmbeddings(req, makeEnv(), {});
        const text = await res.text();
        expect(text).toBe("");
      });
    });

    describe("authentication", () => {
      beforeEach(() => {
        vi.mocked(extractBearerToken).mockReturnValue(null);
        vi.mocked(parseApiKey).mockResolvedValue(null);
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
        vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
      });

      afterEach(() => { vi.clearAllMocks(); });

      it("missing Authorization header → 401", async () => {
        vi.mocked(extractBearerToken).mockReturnValue(null);
        const req = makeRequest("POST", { model: "ag/gemini-embedding-001", input: "hello" }, null);
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error.message).toMatch(/missing api key/i);
      });

      it("Authorization header without Bearer scheme → 401", async () => {
        vi.mocked(extractBearerToken).mockReturnValue(null);
        const req = makeRequest("POST", { model: "ag/gemini-embedding-001", input: "hello" }, "Token abc123");
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(401);
      });

      it("Bearer key that fails parseApiKey → 401", async () => {
        vi.mocked(extractBearerToken).mockReturnValue("sk-invalidkey");
        vi.mocked(parseApiKey).mockResolvedValue(null);
        const req = makeRequest("POST", { model: "ag/gemini-embedding-001", input: "hello" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error.message).toMatch(/invalid api key format/i);
      });

      it("old-format key (no machineId) → 400 asking to use machineId endpoint", async () => {
        vi.mocked(extractBearerToken).mockReturnValue("sk-oldfmt8");
        vi.mocked(parseApiKey).mockResolvedValue({ machineId: null, keyId: "oldfmt8", isNewFormat: false });
        const req = makeRequest("POST", { model: "ag/gemini-embedding-001", input: "hello" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toMatch(/machineId/i);
      });

      it("valid key format but key value not in machine apiKeys → 401", async () => {
        vi.mocked(extractBearerToken).mockReturnValue("sk-mach01-key01-ab12cd34");
        vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData({ apiKeys: [{ key: "sk-different-key" }] }));
        const req = makeRequest("POST", { model: "ag/gemini-embedding-001", input: "hello" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error.message).toMatch(/invalid api key/i);
      });

      it("valid key → passes auth (proceeds to body parsing)", async () => {
        vi.mocked(extractBearerToken).mockReturnValue(VALID_API_KEY);
        vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
        vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
        vi.mocked(handleEmbeddingsCore).mockResolvedValue({
          success: true,
          response: new Response(JSON.stringify(VALID_EMBEDDING_RESPONSE_BODY), {
            status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          }),
        });
        const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "hello" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });
    });

    describe("body validation", () => {
      beforeEach(() => {
        vi.mocked(extractBearerToken).mockReturnValue(VALID_API_KEY);
        vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
      });

      afterEach(() => { vi.clearAllMocks(); });

      it("invalid JSON body → 400", async () => {
        const req = new Request("https://9cli.hxd.app/v1/embeddings", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${VALID_API_KEY}` },
          body: "{ bad json",
        });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toMatch(/invalid json/i);
      });

      it("missing model field → 400", async () => {
        const req = makeRequest("POST", { input: "hello world" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toMatch(/missing model/i);
      });

      it("missing input field → 400", async () => {
        const req = makeRequest("POST", { model: "ag/gemini-embedding-001" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toMatch(/missing required field: input/i);
      });

      it("model with no provider mapping → 400", async () => {
        vi.mocked(getModelInfoCore).mockResolvedValue({ provider: null, model: null });
        const req = makeRequest("POST", { model: "nonexistent/model", input: "hello" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toMatch(/invalid model format/i);
      });
    });

    describe("valid request (happy path)", () => {
      beforeEach(() => {
        vi.mocked(extractBearerToken).mockReturnValue(VALID_API_KEY);
        vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
        vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
        vi.mocked(handleEmbeddingsCore).mockResolvedValue({
          success: true,
          response: new Response(JSON.stringify(VALID_EMBEDDING_RESPONSE_BODY), {
            status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          }),
        });
        vi.mocked(saveMachineData).mockResolvedValue(undefined);
      });

      afterEach(() => { vi.clearAllMocks(); });

      it("single string input → 200 with embeddings data", async () => {
        const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "Hello world test embedding" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.object).toBe("list");
        expect(Array.isArray(body.data)).toBe(true);
      });

      it("array input → 200 with embeddings data", async () => {
        const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: ["Hello", "World"] });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.object).toBe("list");
      });

      it("delegates to handleEmbeddingsCore with correct args", async () => {
        const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "Test" });
        await handleEmbeddings(req, makeEnv(), {});
        expect(handleEmbeddingsCore).toHaveBeenCalledOnce();
        const callArgs = vi.mocked(handleEmbeddingsCore).mock.calls[0][0];
        expect(callArgs.body.input).toBe("Test");
        expect(callArgs.modelInfo.provider).toBe("openai");
        expect(callArgs.modelInfo.model).toBe("text-embedding-ada-002");
        expect(callArgs.credentials).toBeDefined();
      });

      it("response has CORS header from addCorsHeaders wrapper", async () => {
        const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "Hello" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      });

      it("machineId-override path works", async () => {
        const req = new Request(`https://9cli.hxd.app/${MACHINE_ID}/v1/embeddings`, {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${VALID_API_KEY}` },
          body: JSON.stringify({ model: "openai/text-embedding-ada-002", input: "Hello" }),
        });
        const res = await handleEmbeddings(req, makeEnv(), {}, MACHINE_ID);
        expect(res.status).toBe(200);
      });
    });

    describe("rate limit fallback", () => {
      beforeEach(() => {
        vi.mocked(extractBearerToken).mockReturnValue(VALID_API_KEY);
        vi.mocked(parseApiKey).mockResolvedValue({ machineId: MACHINE_ID, keyId: "key01", isNewFormat: true });
        vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
        vi.mocked(saveMachineData).mockResolvedValue(undefined);
      });

      afterEach(() => { vi.clearAllMocks(); });

      it("all provider accounts rate-limited → 429 with Retry-After header", async () => {
        const rateLimitedUntil = new Date(Date.now() + 60000).toISOString();
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData({
          providers: { "conn-001": { provider: "openai", apiKey: "sk-key", isActive: true, priority: 1, status: "unavailable", rateLimitedUntil, lastError: "Rate limit exceeded", errorCode: 429, backoffLevel: 1 } },
        }));
        const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "hello" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBeDefined();
      });

      it("provider account not found → 400 No credentials", async () => {
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData({ providers: {} }));
        const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "hello" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toMatch(/no credentials/i);
      });

      it("core returns non-fallback error → propagates error response directly", async () => {
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
        vi.mocked(handleEmbeddingsCore).mockResolvedValue({
          success: false, status: 400, error: "input must be a string or array",
          response: new Response(JSON.stringify({ error: { message: "input must be a string or array" } }), { status: 400, headers: { "Content-Type": "application/json" } }),
        });
        const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "hello" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect(res.status).toBe(400);
      });

      it("core returns 429 → marks account unavailable, then no more accounts → 429/503", async () => {
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
        vi.mocked(handleEmbeddingsCore).mockResolvedValue({
          success: false, status: 429, error: "Rate limit exceeded",
          response: new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), { status: 429, headers: { "Content-Type": "application/json" } }),
        });
        const req = makeRequest("POST", { model: "openai/text-embedding-ada-002", input: "hello" });
        const res = await handleEmbeddings(req, makeEnv(), {});
        expect([429, 503]).toContain(res.status);
      });
    });

    describe("machineId override path", () => {
      beforeEach(() => {
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData());
        vi.mocked(getModelInfoCore).mockResolvedValue({ provider: "openai", model: "text-embedding-ada-002" });
        vi.mocked(handleEmbeddingsCore).mockResolvedValue({
          success: true,
          response: new Response(JSON.stringify(VALID_EMBEDDING_RESPONSE_BODY), {
            status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          }),
        });
        vi.mocked(saveMachineData).mockResolvedValue(undefined);
      });

      afterEach(() => { vi.clearAllMocks(); });

      it("with machineIdOverride, still validates API key via Authorization header", async () => {
        const req = new Request(`https://9cli.hxd.app/${MACHINE_ID}/v1/embeddings`, {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${VALID_API_KEY}` },
          body: JSON.stringify({ model: "openai/text-embedding-ada-002", input: "test" }),
        });
        const res = await handleEmbeddings(req, makeEnv(), {}, MACHINE_ID);
        expect(res.status).toBe(200);
      });

      it("with machineIdOverride, wrong API key → 401", async () => {
        vi.mocked(getMachineData).mockResolvedValue(makeMachineData({ apiKeys: [{ key: "sk-correct-key" }] }));
        const req = new Request(`https://9cli.hxd.app/${MACHINE_ID}/v1/embeddings`, {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-wrong-key" },
          body: JSON.stringify({ model: "openai/text-embedding-ada-002", input: "test" }),
        });
        const res = await handleEmbeddings(req, makeEnv(), {}, MACHINE_ID);
        expect(res.status).toBe(401);
      });
    });
  });
}
