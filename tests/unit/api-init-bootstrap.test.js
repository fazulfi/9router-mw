import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ loads: 0 }));

vi.mock("@/shared/services/bootstrap", () => {
  state.loads += 1;
  return {};
});

describe("runtime bootstrap route", () => {
  beforeEach(() => {
    state.loads = 0;
    vi.resetModules();
  });

  it("loads background services before serving the init probe", async () => {
    const { GET } = await import("../../src/app/api/init/route.js");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(state.loads).toBe(1);
  });
});
