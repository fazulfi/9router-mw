// Try EXACT shape from oj() — content array, system array, stream:true
import { chromium } from 'playwright-core';

const JWT = process.env.ZCODE_JWT;
const browser = await chromium.launch({ headless: true, executablePath: '/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const ctx = await browser.newContext({ userAgent: 'ZCode/3.1.0', locale: 'en-US', timezoneId: 'Asia/Jakarta' });
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); window.AliyunCaptchaConfig = { region: 'sgp', prefix: 'no8xfe' }; });

async function getCaptchaAndSend(label, url, body, headers = {}) {
  const page = await ctx.newPage();
  await page.goto('https://zcode.z.ai/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.mouse.move(100, 100); await page.mouse.move(300, 200);
  const cap = await page.evaluate(async () => {
    await new Promise((res, rej) => {
      if (window.initAliyunCaptcha) return res();
      const s = document.createElement('script');
      s.src = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false }), 25000);
      window.initAliyunCaptcha({
        SceneId: '11xygtvd', mode: 'popup', region: 'sgp', prefix: 'no8xfe',
        getInstance: (inst) => { inst.startTracelessVerification?.(); },
        success: (p) => { clearTimeout(t); resolve({ ok: true, param: p }); },
      });
    });
  });
  if (!cap.ok) { console.log(`[${label}] captcha fail`); await page.close(); return; }
  const r = await page.evaluate(async ({ url, body, token, captchaParam, extra }) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'user-agent': 'ZCode/3.1.0', 'X-Aliyun-Captcha-Verify-Param': captchaParam, 'X-Aliyun-Captcha-Verify-Region': 'sgp', ...extra },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.text()).slice(0, 800) };
  }, { url, body, token: JWT, captchaParam: cap.param, extra: headers });
  console.log(`[${label}] ${r.status} ${r.body}`);
  await page.close();
}

const URL = 'https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages';
const SYSPROMPT = 'You write concise Conventional Commit messages for ZCode.';

// EXACT oj() shape
await getCaptchaAndSend('exact-oj', URL, {
  model: 'GLM-5.2', max_tokens: 256, stream: true,
  system: [{ type: 'text', text: SYSPROMPT }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'fix login bug' }] }],
});

// Without stream
await getCaptchaAndSend('no-stream', URL, {
  model: 'GLM-5.2', max_tokens: 256,
  system: [{ type: 'text', text: SYSPROMPT }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'fix login bug' }] }],
});

// Generic content array without system
await getCaptchaAndSend('content-array-no-sys', URL, {
  model: 'GLM-5.2', max_tokens: 16,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
});

// GLM-5-Turbo
await getCaptchaAndSend('turbo', URL, {
  model: 'GLM-5-Turbo', max_tokens: 256, stream: true,
  system: [{ type: 'text', text: SYSPROMPT }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
});

await browser.close();
