// Test: does 3001 happen because we don't carry forward cookies after the page goto?
// Hypothesis: the cookies set during goto MUST be sent with the /v1/messages request
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
const captchaParam = cap.param;

// Use page.context().request which auto-carries cookies
const r = await ctx.request.post('https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages', {
  headers: {
    'authorization': `Bearer ${JWT}`,
    'anthropic-version': '2023-06-01',
    'user-agent': 'ZCode/3.1.0',
    'X-Aliyun-Captcha-Verify-Param': captchaParam,
    'X-Aliyun-Captcha-Verify-Region': 'sgp',
    'X-Code-App-Version': '3.1.0',
    'X-Platform': 'linux-x64',
    'X-Client-Language': 'en-US',
    'X-Client-Timezone': 'Asia/Jakarta',
    'X-Os-Category': 'linux',
    'X-Os-Version': '6.1.0',
    'X-Title': 'Z Code@electron',
    'HTTP-Referer': 'https://zcode.z.ai',
  },
  data: {
    model: 'GLM-5.2',
    max_tokens: 256,
    stream: true,
    system: [{ type: 'text', text: 'You write concise Conventional Commit messages for ZCode.' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'fix login bug' }] }],
  },
});
console.log('status:', r.status());
console.log('headers:', JSON.stringify(r.headers(), null, 2));
console.log('body:', (await r.text()).slice(0, 2000));

await browser.close();
