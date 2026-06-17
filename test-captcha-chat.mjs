import { chromium } from "playwright-core";

const JWT = process.env.JWT;

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
  args: [
    "--no-sandbox", "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,720",
  ],
  ignoreDefaultArgs: ["--enable-automation"],
});

const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.72 Safari/537.36",
  viewport: { width: 1280, height: 720 },
});

await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "plugins", { get: () => [1,2,3,4,5] });
  window.AliyunCaptchaConfig = { region: "sgp", prefix: "no8xfe" };
});

const page = await ctx.newPage();
await page.goto("https://zcode.z.ai/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
await page.mouse.move(100,100); await page.mouse.move(400,200);
await page.waitForTimeout(500);

// Get captcha param
const param = await page.evaluate(async () => {
  await new Promise((res,rej) => {
    const s = document.createElement("script");
    s.src = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
    s.onload=res; s.onerror=rej; document.head.appendChild(s);
  });
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 25000);
    window.initAliyunCaptcha({
      SceneId: "11xygtvd", mode: "popup",
      getInstance: (inst) => { if (inst.startTracelessVerification) inst.startTracelessVerification(); },
      success: (p) => { clearTimeout(t); resolve(p); },
      fail: () => { clearTimeout(t); resolve(null); },
      onError: () => { clearTimeout(t); resolve(null); },
    });
  });
});

if (!param) { console.log("CAPTCHA FAILED"); await browser.close(); process.exit(1); }
console.log("Param:", param);

// Test multiple header combinations to find what works
const variants = [
  {
    label: "Both x-api-key + Authorization + GLM-5-Turbo",
    model: "GLM-5-Turbo",
    headers: { "x-api-key": JWT, "Authorization": `Bearer ${JWT}`, "X-Aliyun-Captcha-Verify-Param": param, "X-Aliyun-Captcha-Verify-Region": "sgp", "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
  },
  {
    label: "Both x-api-key + Authorization + GLM-5.2",
    model: "GLM-5.2",
    headers: { "x-api-key": JWT, "Authorization": `Bearer ${JWT}`, "X-Aliyun-Captcha-Verify-Param": param, "X-Aliyun-Captcha-Verify-Region": "sgp", "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
  },
  {
    label: "Only x-api-key + GLM-5-Turbo",
    model: "GLM-5-Turbo",
    headers: { "x-api-key": JWT, "X-Aliyun-Captcha-Verify-Param": param, "X-Aliyun-Captcha-Verify-Region": "sgp", "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
  },
];

for (const v of variants) {
  const result = await page.evaluate(async ({ jwt, captchaParam, model, headers }) => {
    const res = await fetch("https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, max_tokens: 50, stream: false, messages: [{ role: "user", content: "hi" }] })
    });
    return { status: res.status, body: (await res.text()).slice(0, 500) };
  }, { jwt: JWT, captchaParam: param, model: v.model, headers: v.headers });

  console.log(`\n[${v.label}] → ${result.status}: ${result.body}`);
  if (result.status === 200 || result.body.includes("content")) { console.log("✓ WORKS!"); break; }
}

await browser.close();
