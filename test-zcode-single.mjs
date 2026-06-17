// Single fresh captcha + single request
import { chromium } from 'playwright-core';

const JWT = process.env.ZCODE_JWT;
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
    const t = setTimeout(() => resolve({ ok: false }), 25000);
    window.initAliyunCaptcha({
      SceneId: '11xygtvd', mode: 'popup', region: 'sgp', prefix: 'no8xfe',
      getInstance: (inst) => { inst.startTracelessVerification?.(); },
      success: (p) => { clearTimeout(t); resolve({ ok: true, param: p }); },
      fail: (e) => { clearTimeout(t); resolve({ ok: false, err: JSON.stringify(e) }); },
    });
  });
});
if (!result.ok) { console.error('CAPTCHA FAIL', result); await browser.close(); process.exit(1); }

const r = await page.evaluate(async ({ token, captchaParam }) => {
  const r = await fetch('https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`,
      'anthropic-version': '2023-06-01',
      'user-agent': 'ZCode/3.1.0',
      'X-Aliyun-Captcha-Verify-Param': captchaParam,
      'X-Aliyun-Captcha-Verify-Region': 'sgp',
      'X-Code-App-Version': '3.1.0',
      'X-Platform': 'desktop',
      'X-Client-Language': 'en',
      'X-Client-Timezone': 'Asia/Shanghai',
      'X-Os-Category': 'linux',
      'X-Os-Version': '6.1.0',
      'HTTP-Referer': 'https://zcode.z.ai/',
      'X-Title': 'Z Code',
    },
    body: JSON.stringify({ model: 'GLM-5.2', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }),
  });
  const text = await r.text();
  return { status: r.status, body: text, headers: Object.fromEntries(r.headers.entries()) };
}, { token: JWT, captchaParam: result.param });

console.log('status:', r.status);
console.log('response headers:', JSON.stringify(r.headers, null, 2));
console.log('body:', r.body.slice(0, 2000));
await browser.close();
