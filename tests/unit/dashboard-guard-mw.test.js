import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, validateApiKey: mocks.validateApiKey }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyDashboardAuthToken }));

const { proxy } = await import("../../src/dashboardGuard.js");

function request(pathname, token) {
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers({ host: "router.example.com" }),
    cookies: { get: vi.fn(() => token ? { value: token } : undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("dashboard guard MW API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it.each(["/mw/api/v1/overview", "/mw/api/v1/stream"])("rejects %s without cookie", async (pathname) => {
    const response = await proxy(request(pathname));
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });

  it("allows MW API with a valid JWT", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const response = await proxy(request("/mw/api/v1/overview", "valid-jwt"));
    expect(response).toBe(mocks.nextResponse);
    expect(mocks.verifyDashboardAuthToken).toHaveBeenCalledWith("valid-jwt");
  });

  it("does not let requireLogin=false bypass MW API JWT protection", async () => {
    const response = await proxy(request("/mw/api/v1/overview"));
    expect(response.status).toBe(401);
  });

  it.each(["/mw", "/mw/"])("allows public MW SPA shell %s without cookie", async (pathname) => {
    const response = await proxy(request(pathname));
    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects an invalid JWT", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    const response = await proxy(request("/mw/api/v1/overview", "invalid-jwt"));
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });
});
