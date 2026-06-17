// Capture captcha response cookies, then send with /v1/messages
import { chromium } from 'playwright-core';

const TOKEN = process.env.ZCODE_JWT;
if (!TOKEN) { console.error('Set ZCODE_JWT env'); process.exit(1); }

const browser = await chromium.launch({ headless: true, executablePath: '/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

console.log('--- loading zcode.z.ai to get session cookies ---');
await page.goto('https://zcode.z.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);

const cookiesBefore = await ctx.cookies('https://zcode.z.ai');
console.log('cookies after page load:', cookiesBefore.map(c => `${c.name}=${c.value.slice(0,30)}`));

// Trigger captcha
console.log('--- triggering captcha ---');
const captchaResult = await page.evaluate(async () => {
  // Try the SDK if loaded
  if (window.AliyunCaptcha) {
    return new Promise((resolve) => {
      try {
        window.AliyunCaptcha.init({
          SceneId: '11xygtvd',
          prefix: 'no8xfe',
          mode: 'popup',
          region: 'sgp',
          success: (data) => resolve({ ok: true, data }),
          fail: (data) => resolve({ ok: false, data }),
        });
        window.AliyunCaptcha.show();
        setTimeout(() => resolve({ ok: false, timeout: true }), 8000);
      } catch (e) { resolve({ ok: false, err: e.message }); }
    });
  }
  return { ok: false, noSdk: true };
});
console.log('captcha result:', JSON.stringify(captchaResult).slice(0, 500));

const cookiesAfter = await ctx.cookies('https://zcode.z.ai');
console.log('cookies after captcha:', cookiesAfter.map(c => `${c.name}=${c.value.slice(0,40)}`));

await browser.close();
