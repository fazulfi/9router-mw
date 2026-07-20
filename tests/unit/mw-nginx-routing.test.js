import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const configPath = resolve(process.cwd(), "../docs/deploy/nginx-edge.example.conf");
const config = readFileSync(configPath, "utf8");

function locationBlock(path) {
  const start = config.indexOf(`location ${path} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = config.indexOf("\n  }", start);
  expect(end).toBeGreaterThan(start);
  return config.slice(start, end);
}

describe("example nginx MW routing", () => {
  it("orders API before SPA and the main catch-all", () => {
    const api = config.indexOf("location /mw/api/ {");
    const spa = config.indexOf("location /mw/ {");
    const catchAll = config.indexOf("location / {");

    expect(api).toBeGreaterThanOrEqual(0);
    expect(api).toBeLessThan(spa);
    expect(spa).toBeLessThan(catchAll);
  });

  it("proxies the API without an SPA fallback", () => {
    const api = locationBlock("/mw/api/");

    expect(api).toMatch(/proxy_pass\s+http:\/\/9router_mw_backend;/);
    expect(api).not.toMatch(/try_files[\s\S]*\/mw\/index\.html/);
    expect(api).toMatch(/proxy_buffering\s+off;/);
    expect(api).toMatch(/proxy_read_timeout\s+3600s;/);
    expect(api).toMatch(/add_header\s+Cache-Control\s+"no-store"\s+always;/);
  });

  it("serves the dashboard SPA with safe example-only caching", () => {
    const spa = locationBlock("/mw/");

    expect(spa).toMatch(/root\s+\/srv\/example-dashboard;/);
    expect(spa).toMatch(/try_files\s+\$uri\s+\$uri\/\s+\/mw\/index\.html;/);

    expect(config).toMatch(/location = \/mw\/index\.html/);
    expect(config).toMatch(
      /location = \/mw\/index\.html \{[\s\S]*?add_header\s+Cache-Control\s+"no-store"\s+always;/,
    );
    expect(config).toMatch(/expires\s+1y;/);
    expect(config).toMatch(/add_header\s+Cache-Control\s+"public, immutable";/);
  });

  it("contains no unapproved production hosts or secrets", () => {
    expect(config).not.toMatch(/(?:password|secret|token|api[_-]?key)\s*[:=]/i);
    expect(config).not.toMatch(/(?:[a-z0-9-]+\.)+(?:internal|local|corp|net)\b/i);
    expect(config).not.toMatch(/set_real_ip_from\s+\d+\.\d+\.\d+\.\d+\/\d+;/);
    expect(config).not.toMatch(/Installed\s+\d{4}-\d{2}-\d{2}/i);
    expect(config).toContain("server_name example.com;");
    expect(config).toContain("root /srv/example-dashboard;");
    expect(config).toContain("ssl_certificate /etc/nginx/ssl/example.com.crt;");
  });

  it("applies restrictive CSP and baseline security headers to SPA and API", () => {
    const api = locationBlock("/mw/api/");
    const spa = locationBlock("/mw/");

    for (const block of [api, spa]) {
      expect(block).toMatch(/add_header\s+Content-Security-Policy\s+"[^"]+"\s+always;/);
      expect(block).toMatch(/add_header\s+X-Content-Type-Options\s+"nosniff"\s+always;/);
      expect(block).toMatch(/add_header\s+Referrer-Policy\s+"strict-origin-when-cross-origin"\s+always;/);
      expect(block).toMatch(/add_header\s+Permissions-Policy\s+"[^"]+"\s+always;/);

      const hasFrameGuard =
        /add_header\s+X-Frame-Options\s+"(?:DENY|SAMEORIGIN)"\s+always;/.test(block) ||
        /frame-ancestors\s+'none'/.test(block);
      expect(hasFrameGuard).toBe(true);
    }

    const cspMatch = config.match(
      /add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;/,
    );
    expect(cspMatch).not.toBeNull();
    const csp = cspMatch[1];

    expect(csp).toMatch(/default-src\s+'self'/);
    expect(csp).toMatch(/script-src\s+'self'/);
    expect(csp).toMatch(/style-src\s+'self'/);
    expect(csp).toMatch(/connect-src\s+'self'/);
    expect(csp).toMatch(/object-src\s+'none'/);
    expect(csp).toMatch(/base-uri\s+'self'/);
    expect(csp).toMatch(/frame-ancestors\s+'none'/);

    // Same-origin Vite assets only; no wildcard sources.
    expect(csp).not.toMatch(/(?:script|style|connect|default|img|font)-src[^;]*\*/);
    expect(csp).not.toMatch(/'unsafe-eval'/);

    // Documented external Google Fonts (dashboard/index.html) only if retained.
    if (csp.includes("fonts.googleapis.com") || csp.includes("fonts.gstatic.com")) {
      expect(csp).toMatch(/style-src[^;]*https:\/\/fonts\.googleapis\.com/);
      expect(csp).toMatch(/font-src[^;]*https:\/\/fonts\.gstatic\.com/);
    }
  });
});
