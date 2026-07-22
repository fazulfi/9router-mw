import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("custom server runtime bootstrap", () => {
  it("requests initialization after the HTTP server starts listening", () => {
    const source = fs.readFileSync(new URL("../../custom-server.js", import.meta.url), "utf8");
    let onListening;
    const server = {
      address: vi.fn(() => ({ port: 20128 })),
      once: vi.fn((event, handler) => {
        if (event === "listening") onListening = handler;
      }),
    };
    const request = { on: vi.fn() };
    const http = {
      createServer: vi.fn(() => server),
      get: vi.fn(() => request),
    };
    const context = vm.createContext({
      console,
      module: { exports: {} },
      exports: {},
      process: {
        argv: ["node", "custom-server.js"],
        env: { PORT: "20128" },
      },
      require(id) {
        if (id === "http" || id === "node:http") return http;
        return {};
      },
    });

    vm.runInContext(source, context);
    http.createServer(vi.fn());

    expect(server.once).toHaveBeenCalledWith("listening", expect.any(Function));
    onListening();
    expect(http.get).toHaveBeenCalledWith("http://127.0.0.1:20128/api/init", expect.any(Function));
    expect(request.on).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
