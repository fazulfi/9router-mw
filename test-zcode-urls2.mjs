// Test with different URL paths
import { chromium } from 'playwright-core';

const JWT = process.env.ZCODE_JWT;
const browser = await chromium.launch({ headless: true, executablePath: '/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const ctx = await browser.newContext({ userAgent: 'ZCode/3.1.0', locale: 'en-US', timezoneId: 'Asia/Jakarta' });
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); window.AliyunCaptchaConfig = { region: 'sgp', prefix: 'no8xfe' }; });

async function go(label, url, body) {
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
  const r = await page.evaluate(async ({ url, body, token, captchaParam }) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'user-agent': 'ZCode/3.1.0', 'X-Aliyun-Captcha-Verify-Param': captchaParam, 'X-Aliyun-Captcha-Verify-Region': 'sgp' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.text()).slice(0, 500) };
  }, { url, body, token: JWT, captchaParam: cap.param });
  console.log(`[${label}] ${r.status} ${r.body}`);
  await page.close();
}

const body = {
  model: 'GLM-5.2', max_tokens: 256, stream: true,
  system: [{ type: 'text', text: 'You write concise Conventional Commit messages for ZCode.' }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'fix login bug' }] }],
};

await go('no-anthro-seg', 'https://zcode.z.ai/api/v1/zcode-plan/v1/messages', body);
await go('openai-base', 'https://zcode.z.ai/api/v1/zcode-plan/v1/chat/completions', { model: 'GLM-5.2', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] });
await go('openai-direct', 'https://zcode.z.ai/api/v1/zcode-plan/openai/v1/chat/completions', { model: 'GLM-5.2', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] });
await go('coding-paas', 'https://zcode.z.ai/api/v1/zcode-plan/coding/paas/v4/chat/completions', { model: 'GLM-5.2', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] });
await go('coding-paas-on-api', 'https://api.z.ai/api/coding/paas/v4/chat/completions', { model: 'GLM-5.2', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] });
await go('api-zai-anthro', 'https://api.z.ai/api/anthropic/v1/messages', body);
await go('bigmodel-anthro', 'https://open.bigmodel.cn/api/anthropic/v1/messages', body);
await go('api-zai-cf', 'https://zcode.z.ai/api/v1/coding-plan/v1/messages', body);
await go('api-v2', 'https://zcode.z.ai/api/v2/zcode-plan/anthropic/v1/messages', body);

await browser.close();
