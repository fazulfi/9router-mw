import { chromium } from "playwright-core";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
});

// Intercept aliyun captcha verify requests
ctx.on("requestfinished", async (req) => {
  const url = req.url();
  if (url.includes("captcha") || url.includes("alicdn") || url.includes("aliyun")) {
    try {
      const resp = await req.response();
      const body = await resp.text().catch(() => "");
      console.log("[NET]", req.method(), url.slice(0, 200));
      if (body.length < 2000) console.log("[RES]", body.slice(0, 500));
    } catch {}
  }
});

const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("captcha") || t.includes("Captcha") || t.includes("param")) {
    console.log("[B]", m.type(), t.slice(0, 300));
  }
});

await page.goto("https://zcode.z.ai/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);

const result = await page.evaluate(async () => {
  await new Promise((res, rej) => {
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
      success: (p) => { clearTimeout(t); resolve({ ok: true, param: p }); },
      fail: (e) => { clearTimeout(t); resolve({ ok: false, err: "fail:" + JSON.stringify(e) }); },
      onError: (e) => { clearTimeout(t); resolve({ ok: false, err: "error:" + JSON.stringify(e) }); },
    });
  });
});

console.log("RESULT:", JSON.stringify(result));
if (result.param) {
  const d = JSON.parse(Buffer.from(result.param, "base64").toString());
  console.log("DECODED:", JSON.stringify(d));
}

await browser.close();
