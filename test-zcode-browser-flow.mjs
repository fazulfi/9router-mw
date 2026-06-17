// Full flow: load page → get cookies → solve captcha in same context → use captcha + cookies for /v1/messages
import { chromium } from 'playwright-core';

const TOKEN = process.env.ZCODE_JWT;
if (!TOKEN) { console.error('Set ZCODE_JWT env'); process.exit(1); }

const browser = await chromium.launch({ headless: true, executablePath: '/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.72 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'Asia/Jakarta',
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.AliyunCaptchaConfig = { region: 'sgp', prefix: 'no8xfe' };
});

const page = await ctx.newPage();

console.log('--- 1. load zcode.z.ai ---');
await page.goto('https://zcode.z.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);

// Mouse moves
await page.mouse.move(100, 100);
await page.mouse.move(300, 200);
await page.mouse.move(500, 300);
await page.waitForTimeout(500);

console.log('--- 2. solve captcha ---');
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
      SceneId: '11xygtvd',
      mode: 'popup',
      region: 'sgp',
      prefix: 'no8xfe',
      getInstance: (inst) => {
        if (typeof inst.startTracelessVerification === 'function') {
          inst.startTracelessVerification();
        }
      },
      success: (p) => { clearTimeout(t); resolve({ ok: true, param: p }); },
      fail: (e) => { clearTimeout(t); resolve({ ok: false, err: 'fail:' + JSON.stringify(e) }); },
      onError: (e) => { clearTimeout(t); resolve({ ok: false, err: 'error:' + JSON.stringify(e) }); },
    });
  });
});

console.log('captcha result:', JSON.stringify(result).slice(0, 400));
if (!result.ok) { await browser.close(); process.exit(1); }

const captchaParam = result.param;
const cookies = await ctx.cookies('https://zcode.z.ai');
console.log('cookies:', cookies.map(c => c.name).join(','));
console.log('acw_tc:', cookies.find(c => c.name === 'acw_tc')?.value?.slice(0, 30));

console.log('--- 3. POST /v1/messages with cookies + captcha ---');
const resp = await page.evaluate(async ({ token, captchaParam }) => {
  const r = await fetch('https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`,
      'anthropic-version': '2023-06-01',
      'user-agent': 'ZCode/3.1.0',
      'X-Aliyun-Captcha-Verify-Param': captchaParam,
      'X-Aliyun-Captcha-Verify-Region': 'sgp',
      'x-code-app-version': '3.1.0',
      'x-platform': 'desktop',
      'x-client-language': 'en',
      'x-client-timezone': 'Asia/Shanghai',
      'x-os-category': 'linux',
      'x-os-version': '6.1.0',
      'http-referer': 'https://zcode.z.ai/',
      'x-title': 'Z Code',
    },
    body: JSON.stringify({
      model: 'GLM-5.2',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
  const text = await r.text();
  return { status: r.status, body: text };
}, { token: TOKEN, captchaParam });

console.log('status:', resp.status);
console.log('body:', resp.body.slice(0, 1500));

await browser.close();
