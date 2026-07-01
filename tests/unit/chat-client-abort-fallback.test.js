// Verifies the client-abort fix in handleSingleModelChat (chat.js):
//  1. Pre-loop abort — signal already aborted on entry → 499, no credential lookup.
//  2. Mid-loop abort — client disconnects during handleChatCore → loop stops after
//     the failing account, does NOT cycle to the next account (the bug).
//  3. clientSignal forwarding — request.signal is passed to handleChatCore so
//     in-flight upstream fetches can be cancelled.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  extractApiKey: vi.fn((req) => {
    const auth = req?.headers?.get?.("Authorization");
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    return req?.headers?.get?.("x-api-key") || null;
  }),
  isValidApiKey: vi.fn(() => true),
  isProviderAllowed: vi.fn(() => true),
  isComboAllowed: vi.fn(() => true),
  isKindAllowed: vi.fn(() => true),
  isTrustedInternalRequest: vi.fn(() => false),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(() => Promise.resolve({ shouldFallback: true })),
  clearAccountError: vi.fn(),
  isModelAllowed: vi.fn(() => true),
  getSettings: vi.fn(() => Promise.resolve({ requireApiKey: true })),
  getModelInfo: vi.fn((model) => Promise.resolve({ provider: "openai", model })),
  getComboModels: vi.fn(() => Promise.resolve(null)),
  handleChatCore: vi.fn(() => Promise.resolve({ success: true, response: new Response("ok") })),
  handleBypassRequest: vi.fn(() => null),
  handleComboChat: vi.fn(() => new Response("combo-ok")),
  handleFusionChat: vi.fn(() => new Response("fusion-ok")),
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn((_p, c) => Promise.resolve(c)),
  getProjectIdForConnection: vi.fn(),
  logRequest: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  cacheClaudeHeaders: vi.fn(),
  detectFormatByEndpoint: vi.fn(() => null),
  isProviderFullyBlocked: vi.fn(() => false),
  getProviderShortestCooldownMs: vi.fn(() => 0),
  recordProviderFailure: vi.fn(),
  clearProviderFailure: vi.fn(),
  isProviderInCooldown: vi.fn(() => false),
  isKimchiQuotaExhausted: vi.fn(() => false),
  detectDailyQuotaExhaustion: vi.fn(() => null),
  getProxyHash: vi.fn(() => "proxy-1"),
  resolveAccountSemaphoreKey: vi.fn(() => null),
  resolveAccountSemaphoreMaxConcurrency: vi.fn(() => null),
  acquireAccountSemaphore: vi.fn(() => () => {}),
  isSemaphoreCapacityError: vi.fn(() => false),
}));

vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
  isProviderAllowed: mocks.isProviderAllowed,
  isComboAllowed: mocks.isComboAllowed,
  isKindAllowed: mocks.isKindAllowed,
  isTrustedInternalRequest: mocks.isTrustedInternalRequest,
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
  isProviderAllowed: mocks.isProviderAllowed,
  isComboAllowed: mocks.isComboAllowed,
  isKindAllowed: mocks.isKindAllowed,
  isTrustedInternalRequest: mocks.isTrustedInternalRequest,
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));

vi.mock("@/sse/services/allowedModels.js", () => ({ isModelAllowed: mocks.isModelAllowed }));
vi.mock("../../src/sse/services/allowedModels.js", () => ({ isModelAllowed: mocks.isModelAllowed }));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: vi.fn(() => []),
  validateApiKey: vi.fn(),
  getProviderNodeById: vi.fn(),
}));
vi.mock("../../src/lib/localDb.js", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: vi.fn(() => []),
  validateApiKey: vi.fn(),
  getProviderNodeById: vi.fn(),
}));

vi.mock("@/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo, getComboModels: mocks.getComboModels }));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo, getComboModels: mocks.getComboModels }));

vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: mocks.handleBypassRequest }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: mocks.handleComboChat,
  handleFusionChat: mocks.handleFusionChat,
  stripComboPrefix: vi.fn((s) => s),
}));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: mocks.cacheClaudeHeaders }));
vi.mock("open-sse/translator/formats.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, detectFormatByEndpoint: mocks.detectFormatByEndpoint };
});
vi.mock("open-sse/services/accountFallback.js", () => ({
  isProviderFullyBlocked: mocks.isProviderFullyBlocked,
  getProviderShortestCooldownMs: mocks.getProviderShortestCooldownMs,
  recordProviderFailure: mocks.recordProviderFailure,
  clearProviderFailure: mocks.clearProviderFailure,
  isProviderInCooldown: mocks.isProviderInCooldown,
  isKimchiQuotaExhausted: mocks.isKimchiQuotaExhausted,
  detectDailyQuotaExhaustion: mocks.detectDailyQuotaExhaustion,
}));
vi.mock("@/lib/network/connectionProxy", () => ({ getProxyHash: mocks.getProxyHash }));
vi.mock("../../src/lib/network/connectionProxy.js", () => ({ getProxyHash: mocks.getProxyHash }));
vi.mock("open-sse/services/accountSemaphore.js", () => ({
  acquire: mocks.acquireAccountSemaphore,
  resolveAccountSemaphoreKey: mocks.resolveAccountSemaphoreKey,
  resolveAccountSemaphoreMaxConcurrency: mocks.resolveAccountSemaphoreMaxConcurrency,
  isSemaphoreCapacityError: mocks.isSemaphoreCapacityError,
}));
vi.mock("open-sse/utils/circuitBreaker.js", () => ({ resetAllCircuitBreakers: vi.fn() }));
vi.mock("open-sse/config/runtimeConfig.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    HTTP_STATUS: {
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      RATE_LIMITED: 429,
      SERVER_ERROR: 500,
      BAD_GATEWAY: 502,
      SERVICE_UNAVAILABLE: 503,
    },
  };
});
vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => new Response(JSON.stringify({ error: { message } }), { status }),
  unavailableResponse: (s, m) => new Response(m, { status: s }),
  withSelectedConnectionHeader: (response) => response,
}));
vi.mock("@/sse/utils/logger.js", () => ({
  request: mocks.logRequest,
  info: mocks.logInfo,
  warn: mocks.logWarn,
  debug: mocks.logDebug,
  maskKey: vi.fn((k) => "***"),
}));
vi.mock("../../src/sse/utils/logger.js", () => ({
  request: mocks.logRequest,
  info: mocks.logInfo,
  warn: mocks.logWarn,
  debug: mocks.logDebug,
  maskKey: vi.fn((k) => "***"),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: mocks.updateProviderCredentials,
  checkAndRefreshToken: mocks.checkAndRefreshToken,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: mocks.updateProviderCredentials,
  checkAndRefreshToken: mocks.checkAndRefreshToken,
}));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: mocks.getProjectIdForConnection }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://localhost:9999" }));
vi.mock("open-sse/utils/cooldownRetry.js", () => ({
  maybeWaitForCooldown: vi.fn(() => Promise.resolve({ shouldRetry: false, reason: "budget_exhausted" })),
  MAX_COOLDOWN_RETRIES: 1,
}));
vi.mock("open-sse/index.js", () => ({}));

const { POST } = await import("../../src/app/api/v1/chat/completions/route.js");

function makeAccount(id, name) {
  return {
    connectionId: id,
    connectionName: name,
    providerSpecificData: { apiKey: "k" },
  };
}

function makeRequest(signal) {
  return new Request("http://localhost/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
    },
    body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    signal,
  });
}

describe("handleSingleModelChat client-abort fallback loop", () => {
  beforeEach(() => {
    // resetAllMocks would wipe default impls; instead reset only the mock-heavy
    // fns to clear any leaked mockResolvedValueOnce queues from prior tests,
    // then re-establish their defaults.
    vi.clearAllMocks();
    mocks.getProviderCredentials.mockReset();
    mocks.handleChatCore.mockReset();
    mocks.getProviderCredentials.mockResolvedValue(undefined);
    mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("ok") });

    mocks.isValidApiKey.mockReturnValue(true);
    mocks.isProviderAllowed.mockReturnValue(true);
    mocks.isModelAllowed.mockReturnValue(true);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.isProviderFullyBlocked.mockReturnValue(false);
    mocks.isProviderInCooldown.mockReturnValue(false);
    mocks.isKimchiQuotaExhausted.mockReturnValue(false);
    mocks.detectDailyQuotaExhaustion.mockReturnValue(null);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
    mocks.resolveAccountSemaphoreKey.mockReturnValue(null);
  });

  it("returns 499 and skips credential lookup when signal is already aborted before the loop", async () => {
    const controller = new AbortController();
    controller.abort();

    const response = await POST(makeRequest(controller.signal));

    expect(response.status).toBe(499);
    // The circuit-breaker gate passed (isProviderFullyBlocked=false), so the only
    // thing that prevented a credential lookup is the in-loop abort check.
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("stops the fallback loop after a failing account when the client disconnects mid-request", async () => {
    const controller = new AbortController();

    // Two accounts available; the second must NEVER be tried if the abort works.
    mocks.getProviderCredentials
      .mockResolvedValueOnce(makeAccount("conn-1", "account-1"))
      .mockResolvedValueOnce(makeAccount("conn-2", "account-2"));

    // handleChatCore simulates a client disconnect mid-flight: abort the signal,
    // then return a failure so markAccountUnavailable → shouldFallback → continue.
    mocks.handleChatCore.mockImplementationOnce(async () => {
      controller.abort();
      return { success: false, status: 502, error: "upstream 502", errorCode: null };
    });

    const response = await POST(makeRequest(controller.signal));

    expect(response.status).toBe(499);
    // Exactly one credential lookup (account-1). account-2 must NOT be tried.
    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(1);
    // handleChatCore called once (account-1), never for account-2.
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
  });

  it("forwards request.signal as clientSignal to handleChatCore (abort propagates)", async () => {
    const controller = new AbortController();
    let capturedSignal = null;
    mocks.getProviderCredentials.mockResolvedValueOnce(makeAccount("conn-1", "account-1"));

    // Capture the clientSignal forwarded into handleChatCore.
    mocks.handleChatCore.mockImplementationOnce(async (opts) => {
      capturedSignal = opts?.clientSignal ?? null;
      return { success: true, response: new Response("ok") };
    });

    await POST(makeRequest(controller.signal));

    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    // The forwarded signal must be an AbortSignal linked to the client's
    // controller — aborting the controller must mark the captured signal too.
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal.aborted).toBe(false);
    controller.abort();
    expect(capturedSignal.aborted).toBe(true);
  });

  it("keeps cycling accounts (no abort) when the client stays connected", async () => {
    // Regression guard: the abort check must NOT short-circuit a live connection.
    mocks.getProviderCredentials
      .mockResolvedValueOnce(makeAccount("conn-1", "account-1"))
      .mockResolvedValueOnce(makeAccount("conn-2", "account-2"))
      .mockResolvedValueOnce(null); // exhausted → loop exits via no-credentials path

    mocks.handleChatCore
      .mockResolvedValueOnce({ success: false, status: 502, error: "boom", errorCode: null })
      .mockResolvedValueOnce({ success: false, status: 502, error: "boom", errorCode: null });

    await POST(makeRequest(new AbortController().signal));

    // Both accounts attempted because the client never aborted; 3rd lookup
    // returns null → loop exits without a 3rd handleChatCore call.
    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(3);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
  });
});
