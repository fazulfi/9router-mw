// Test with accessToken, businessToken, or both
import { chromium } from 'playwright-core';

const JWT = process.env.ZCODE_JWT;
const ACCESS = process.env.ACCESS_TOKEN;
const BIZ = process.env.BIZ_TOKEN;
if (!JWT) { console.error('Set ZCODE_JWT, ACCESS_TOKEN, BIZ_TOKEN'); process.exit(1); }

const browser = await chromium.launch({ headless: true, executablePath: '/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const ctx = await browser.newContext({ userAgent: 'ZCode/3.1.0', locale: 'en-US', timezoneId: 'Asia/Jakarta' });
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); window.AliyunCaptchaConfig = { region: 'sgp', prefix: 'no8xfe' }; });
const page = await ctx.newPage();

await page.goto('https://zcode.z.ai/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.mouse.move(100, 100);
await page.mouse.move(300, 200);

const result = await page.evaluate(async () => {
  await new Promise((res, rej) => {
    if (window.initAliyunCaptcha) return res();
    const s = document.createElement('script');
    s.src = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, err: 'timeout' }), 25000);
    window.initAliyunCaptcha({
      SceneId: '11xygtvd', mode: 'popup', region: 'sgp', prefix: 'no8xfe',
      getInstance: (inst) => { inst.startTracelessVerification?.(); },
      success: (p) => { clearTimeout(t); resolve({ ok: true, param: p }); },
      fail: (e) => { clearTimeout(t); resolve({ ok: false, err: JSON.stringify(e) }); },
    });
  });
});
if (!result.ok) { console.error('CAPTCHA FAIL', result); await browser.close(); process.exit(1); }
const captchaParam = result.param;
console.log('captcha ok');

async function send(label, headers) {
  const r = await page.evaluate(async ({ headers }) => {
    const r = await fetch('https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json', 'anthropic-version': '2023-06-01', 'user-agent': 'ZCode/3.1.0', 'X-Aliyun-Captcha-Verify-Param': headers.captchaParam, 'X-Aliyun-Captcha-Verify-Region': 'sgp', 'X-Code-App-Version': '3.1.0', 'X-Platform': 'desktop', 'X-Client-Language': 'en', 'X-Client-Timezone': 'Asia/Shanghai', 'X-Os-Category': 'linux', 'X-Os-Version': '6.1.0', 'HTTP-Referer': 'https://zcode.z.ai/', 'X-Title': 'Z Code', ...headers.extra },
      body: JSON.stringify({ model: 'GLM-5.2', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 600) };
  }, { headers: { ...headers, captchaParam } });
  console.log(`[${label}] status=${r.status} body=${r.body}`);
}

// Test 1: just zcodeJwtToken (already failed before)
await send('jwt-only', { authorization: `Bearer ${JWT}` });
// Test 2: accessToken
await send('access-only', { authorization: `Bearer ${ACCESS}` });
// Test 3: businessToken
if (BIZ) await send('biz-only', { authorization: `Bearer ${BIZ}` });
// Test 4: x-api-key with zcodeJwtToken
await send('jwt-x-api-key', { 'x-api-key': JWT, authorization: undefined });
// Test 5: dual auth headers
await send('dual', { authorization: `Bearer ${JWT}`, 'x-api-key': ACCESS });
// Test 6: different anthropic-version
await send('v2024-01-01', { authorization: `Bearer ${JWT}`, 'anthropic-version': '2024-01-01' });
// Test 7: no anthropic-version
await send('no-anthropic-ver', { authorization: `Bearer ${JWT}`, 'anthropic-version': undefined });
// Test 8: empty body
const r8 = await page.evaluate(async ({ captchaParam, token }) => {
  const r = await fetch('https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'X-Aliyun-Captcha-Verify-Param': captchaParam, 'X-Aliyun-Captcha-Verify-Region': 'sgp' },
    body: '{}',
  });
  return { status: r.status, body: (await r.text()).slice(0, 400) };
}, { captchaParam, token: JWT });
console.log(`[empty-body] status=${r8.status} body=${r8.body}`);

await browser.close();
