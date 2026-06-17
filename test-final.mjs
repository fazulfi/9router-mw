import { chromium } from "playwright-core";

async function solveCaptcha() {
  const browser = await chromium.launch({
    headless: true, executablePath: "/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
    args: ["--no-sandbox","--disable-dev-shm-usage","--disable-blink-features=AutomationControlled","--disable-features=IsolateOrigins,site-per-process","--window-size=1280,720"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.72 Safari/537.36",
    viewport: { width: 1280, height: 720 }, locale: "en-US", timezoneId: "Asia/Jakarta",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    window.AliyunCaptchaConfig = { region: "sgp", prefix: "no8xfe" };
  });
  const page = await ctx.newPage();
  await page.goto("https://zcode.z.ai/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.mouse.move(100, 100); await page.mouse.move(300, 200); await page.mouse.move(500, 300);
  await page.waitForTimeout(500);
  const result = await page.evaluate(async () => {
    if (!window.initAliyunCaptcha) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, err: "timeout" }), 25000);
      window.initAliyunCaptcha({
        SceneId: "11xygtvd", mode: "popup",
        getInstance: (inst) => { if (typeof inst.startTracelessVerification === "function") inst.startTracelessVerification(); },
        success: (p) => { clearTimeout(t); resolve({ ok: true, param: p }); },
        fail: (e) => { clearTimeout(t); resolve({ ok: false, err: "fail:" + JSON.stringify(e) }); },
        onError: (e) => { clearTimeout(t); resolve({ ok: false, err: "error:" + JSON.stringify(e) }); },
      });
    });
  });
  await browser.close();
  return result.param;
}

const ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRfaWQiOiJjbGllbnRfUDhYNUNNV21sYVJPOWd5Ty1KU3F0ZyIsImV4cCI6MTc4MTYzNjY2NiwiaWF0IjoxNzgxNjMzMDY2LCJpc3MiOiJ1c2VyLXNlcnZpY2UiLCJqdGkiOiI1VkhHR2hUcGR3TElIcnFVMDJuanBBIiwic2NvcGVzIjpbIm9wZW5pZCIsInByb2ZpbGUiLCJlbWFpbCJdLCJzdWIiOiIyMjFhZWI3Mi1jMDcwLTQ5NjctYmVmZi05NjJkNDE1ZjczYTMiLCJ0b2tlbl90eXBlIjoiYWNjZXNzX3Rva2VuIn0.dzFUCn7eI_zB8Dy6EIHpAuXL-prxrOcjIbMFnGIzokw";
const ZCODE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMjIxYWViNzItYzA3MC00OTY3LWJlZmYtOTYyZDQxNWY3M2EzIiwic3ViIjoiMjIxYWViNzItYzA3MC00OTY3LWJlZmYtOTYyZDQxNWY3M2EzIiwiaWF0IjoxNzgxNjMzMDY2fQ.s_-bksgjm85Yp6u9QSRRqXfNZ8i0WhW48aa02K1I2sM";

console.log("Solving captcha...");
const param = await solveCaptcha();
if (!param) { console.error("Captcha failed"); process.exit(1); }
const decoded = JSON.parse(Buffer.from(param, "base64").toString());
console.log("Captcha OK, securityToken:", decoded.securityToken?.slice(0, 40) + "...");

const headers = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "User-Agent": "ZCode/3.1.0 Electron/34.0.0 Chrome/134.0.0.0",
  "x-aliyun-captcha-verify-param": param,
  "x-request-id": crypto.randomUUID(),
  "anthropic-version": "2023-06-01",
  "x-api-key": ACCESS_TOKEN,
  "Authorization": `Bearer ${ACCESS_TOKEN}`,
};

const body = JSON.stringify({
  model: "GLM-5.2", max_tokens: 30,
  messages: [{ role: "user", content: "Say hello in one word." }],
  stream: false,
});

console.log("\nTesting chat with fresh captcha + ACCESS in both headers...");
const res = await fetch("https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages", { method: "POST", headers, body });
const text = await res.text();
console.log("Status:", res.status);
console.log("Response (first 1000):", text.slice(0, 1000));
