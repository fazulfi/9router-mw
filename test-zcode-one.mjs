// Single test per run. Args: URL_BODY_LABEL
import { chromium } from 'playwright-core';

const JWT = process.env.ZCODE_JWT;
const body = JSON.parse(process.env.BODY);

const browser = await chromium.launch({ headless: true, executablePath: '/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const ctx = await browser.newContext({ userAgent: 'ZCode/3.1.0', locale: 'en-US', timezoneId: 'Asia/Jakarta' });
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); window.AliyunCaptchaConfig = { region: 'sgp', prefix: 'no8xfe' }; });

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
if (!cap.ok) { console.error('CAPTCHA FAIL'); await browser.close(); process.exit(1); }

const r = await page.evaluate(async ({ url, body, token, captchaParam }) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'user-agent': 'ZCode/3.1.0', 'X-Aliyun-Captcha-Verify-Param': captchaParam, 'X-Aliyun-Captcha-Verify-Region': 'sgp' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text.slice(0, 3000), headers: Object.fromEntries(r.headers.entries()) };
}, { url: process.env.URL, body, token: JWT, captchaParam: cap.param });
console.log('status:', r.status);
console.log('content-type:', r.headers['content-type']);
console.log('x-request-id:', r.headers['x-request-id']);
console.log('body:', r.body);
await browser.close();
