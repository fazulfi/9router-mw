import { chromium } from 'playwright-core';

const URL = 'https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages';
const JWT = process.argv[2];

async function test(label, body) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.72 Safari/537.36',
    viewport: { width: 1280, height: 720 }, locale: 'en-US', timezoneId: 'Asia/Jakarta',
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.AliyunCaptchaConfig = { region: 'sgp', prefix: 'no8xfe' };
  });
  const page = await ctx.newPage();
  await page.goto('https://zcode.z.ai/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.mouse.move(100, 100); await page.mouse.move(300, 200);
  const param = await page.evaluate(async () => {
    if (!window.initAliyunCaptcha) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 25000);
      window.initAliyunCaptcha({
        SceneId: '11xygtvd', mode: 'popup',
        getInstance: (inst) => { inst.startTracelessVerification(); },
        success: (p) => { clearTimeout(t); resolve(p); },
        fail: () => { clearTimeout(t); resolve(null); },
        onError: () => { clearTimeout(t); resolve(null); },
      });
    });
  });
  await browser.close();
  if (!param) { console.log(label, 'CAPTCHA_FAIL'); return; }
  const resp = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'ZCode/3.1.0',
      'HTTP-Referer': 'https://zcode.z.ai',
      'X-Title': 'Z Code@electron',
      'X-ZCode-App-Version': '3.1.0',
      'X-ZCode-Agent': 'glm',
      'X-Platform': 'linux-x64',
      'X-Client-Language': 'en',
      'X-Client-Timezone': 'Asia/Jakarta',
      'X-Os-Category': 'linux',
      'X-Os-Version': '6.8.0',
      'Authorization': 'Bearer ' + JWT,
      'X-Aliyun-Captcha-Verify-Param': param,
      'X-Aliyun-Captcha-Verify-Region': 'sgp',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  console.log(label, 'STATUS:', resp.status, 'BODY:', text.slice(0, 250));
}

// 1: system as string
await test('sys-str:', {model: 'GLM-5.2', max_tokens: 16, system: 'You are a helpful assistant.', messages: [{role: 'user', content: 'hi'}]});
// 2: system as string with temperature
await test('sys-str-temp:', {model: 'GLM-5.2', max_tokens: 16, temperature: 0.1, system: 'You are a helpful assistant.', messages: [{role: 'user', content: 'hi'}]});
// 3: thinking field
await test('thinking:', {model: 'GLM-5.2', max_tokens: 16, thinking: {type: 'enabled', budget_tokens: 100}, messages: [{role: 'user', content: 'hi'}]});
// 4: metadata field
await test('metadata:', {model: 'GLM-5.2', max_tokens: 16, metadata: {user_id: 'test'}, messages: [{role: 'user', content: 'hi'}]});
// 5: try "user" lowercase vs "human" 
await test('human-role:', {model: 'GLM-5.2', max_tokens: 16, messages: [{role: 'human', content: 'hi'}]});
// 6: try multiple messages
await test('multi-msg:', {model: 'GLM-5.2', max_tokens: 16, messages: [{role: 'user', content: 'hi'}, {role: 'assistant', content: 'hello'}, {role: 'user', content: 'how are you?'}]});
