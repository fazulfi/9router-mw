import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verify }));

const { requireMwDashboardAuth } = await import("@/lib/mw/auth.js");

function requestWithToken(value) {
  return { cookies: { get: vi.fn(() => value === undefined ? undefined : { value }) } };
}

describe("MW JWT-only auth", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockResolvedValue(false); });

  it("rejects a missing cookie with generic 401 JSON", async () => {
    const result = await requireMwDashboardAuth(requestWithToken());
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("rejects an invalid JWT and never bypasses with settings", async () => {
    mocks.verify.mockResolvedValue(false);
    const result = await requireMwDashboardAuth(requestWithToken("bad"));
    expect(result.ok).toBe(false);
    expect(mocks.verify).toHaveBeenCalledWith("bad");
  });

  it("accepts a valid cookie JWT", async () => {
    mocks.verify.mockResolvedValue(true);
    await expect(requireMwDashboardAuth(requestWithToken("good"))).resolves.toEqual({ ok: true });
  });

  it("accepts a token string for unit-testable handlers", async () => {
    mocks.verify.mockResolvedValue(true);
    await expect(requireMwDashboardAuth("good")).resolves.toEqual({ ok: true });
  });
});
