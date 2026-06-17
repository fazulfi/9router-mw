import { chromium } from "playwright-core";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--window-size=1280,720",
  ],
  ignoreDefaultArgs: ["--enable-automation"],
});

const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.72 Safari/537.36",
  viewport: { width: 1280, height: 720 },
  locale: "en-US",
  timezoneId: "Asia/Jakarta",
  permissions: [],
  // Fake hardware concurrency & device memory
  extraHTTPHeaders: {
    "Accept-Language": "en-US,en;q=0.9",
  },
});

// Patch webdriver detection
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  window.AliyunCaptchaConfig = { region: "sgp", prefix: "no8xfe" };
});

const page = await ctx.newPage();

ctx.on("requestfinished", async (req) => {
  const url = req.url();
  if (url.includes("captcha-open") || url.includes("cloudauth-device")) {
    try {
      const resp = await req.response();
      const body = await resp.text().catch(() => "");
      console.log("[NET]", url.slice(0, 100));
      if (body) console.log("[RES]", body.slice(0, 400));
    } catch {}
  }
});

await page.goto("https://zcode.z.ai/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

// Simulate mouse movement (help pass bot detection)
await page.mouse.move(100, 100);
await page.mouse.move(300, 200);
await page.mouse.move(500, 300);
await page.waitForTimeout(500);

const result = await page.evaluate(async () => {
  await new Promise((res, rej) => {
    if (window.initAliyunCaptcha) return res();
    const s = document.createElement("script");
    s.src = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, err: "timeout" }), 25000);
    window.initAliyunCaptcha({
      SceneId: "11xygtvd",
      mode: "popup",
      getInstance: (inst) => {
        console.log("getInstance, hasTraceless:", typeof inst.startTracelessVerification === "function");
        if (typeof inst.startTracelessVerification === "function") {
          inst.startTracelessVerification();
        }
      },
      success: (p) => { clearTimeout(t); resolve({ ok: true, param: p }); },
      fail: (e) => { clearTimeout(t); resolve({ ok: false, err: "fail:" + JSON.stringify(e) }); },
      onError: (e) => { clearTimeout(t); resolve({ ok: false, err: "error:" + JSON.stringify(e) }); },
    });
  });
});

console.log("RESULT:", JSON.stringify(result));
if (result.param) {
  const d = JSON.parse(Buffer.from(result.param, "base64").toString());
  console.log("DECODED:", JSON.stringify(d, null, 2));
}

await browser.close();
