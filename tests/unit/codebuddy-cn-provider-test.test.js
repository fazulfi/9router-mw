import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(),
}));

describe("CodeBuddy CN provider test", () => {
  it("falls through to generic default for unsupported providers", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0,
      data: { Response: { Data: { Accounts: [] } } },
    }), { status: 200 }));
    const { __test__ } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

    // codebuddy-cn is not handled in testApiKeyConnection — falls to default
    const result = await __test__.testApiKeyConnection({
      provider: "codebuddy-cn",
      apiKey: "ck_test",
      authType: "apikey",
    });

    expect(result).toEqual({ valid: false, error: "Provider test not supported" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
