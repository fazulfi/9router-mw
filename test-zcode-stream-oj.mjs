// Test Plan with stream:true
import { chromium } from 'playwright-core';

const JWT = process.env.ZCODE_JWT;
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
console.log('captcha ok');

const URL = 'https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages';
const SYSPROMPT = 'You write concise Conventional Commit messages for ZCode.';

// Test 1: stream:true + system ARRAY (oj exact shape)
console.log('\n=== Test 1: stream + system array (oj exact) ===');
let r = await page.evaluate(async ({ url, body, token, captchaParam }) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'user-agent': 'ZCode/3.1.0', 'X-Aliyun-Captcha-Verify-Param': captchaParam, 'X-Aliyun-Captcha-Verify-Region': 'sgp' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.text()).slice(0, 1500) };
}, { url: URL, body: { model: 'GLM-5.2', max_tokens: 256, stream: true, system: [{ type: 'text', text: SYSPROMPT }], messages: [{ role: 'user', content: [{ type: 'text', text: 'fix login bug' }] }] }, token: JWT, captchaParam: cap.param });
console.log('status:', r.status, 'body:', r.body);

// Test 2: stream:true + system string
console.log('\n=== Test 2: stream + system string ===');
r = await page.evaluate(async ({ url, body, token, captchaParam }) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'user-agent': 'ZCode/3.1.0', 'X-Aliyun-Captcha-Verify-Param': captchaParam, 'X-Aliyun-Captcha-Verify-Region': 'sgp' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.text()).slice(0, 1500) };
}, { url: URL, body: { model: 'GLM-5.2', max_tokens: 256, stream: true, system: SYSPROMPT, messages: [{ role: 'user', content: [{ type: 'text', text: 'fix login bug' }] }] }, token: JWT, captchaParam: cap.param });
console.log('status:', r.status, 'body:', r.body);

// Test 3: stream:true + content string + system string
console.log('\n=== Test 3: stream + content string + system string ===');
r = await page.evaluate(async ({ url, body, token, captchaParam }) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'user-agent': 'ZCode/3.1.0', 'X-Aliyun-Captcha-Verify-Param': captchaParam, 'X-Aliyun-Captcha-Verify-Region': 'sgp' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.text()).slice(0, 1500) };
}, { url: URL, body: { model: 'GLM-5.2', max_tokens: 256, stream: true, system: SYSPROMPT, messages: [{ role: 'user', content: 'fix login bug' }] }, token: JWT, captchaParam: cap.param });
console.log('status:', r.status, 'body:', r.body);

await browser.close();
