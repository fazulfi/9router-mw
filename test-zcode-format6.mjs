import { chromium } from 'playwright-core';

const URL = 'https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages';
const JWT = process.argv[2];

async function getCaptcha() {
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
  return param;
}

async function test(label, body) {
  const param = await getCaptcha();
  if (!param) { console.log(label, 'CAPTCHA_FAIL'); return; }
  const resp = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
  console.log(label, ':', resp.status, text.slice(0, 300));
}

// Try body format that mimics Anthropic official format with metadata
await test('with metadata user_id:', {model: 'GLM-5.2', max_tokens: 16, messages: [{role: 'user', content: 'hi'}], metadata: {user_id: 'test-user'}});
await test('with system str:', {model: 'GLM-5.2', max_tokens: 16, system: 'You are a helpful assistant.', messages: [{role: 'user', content: 'hi'}]});
await test('with extra headers, user-agent:', {model: 'GLM-5.2', max_tokens: 16, messages: [{role: 'user', content: 'hi'}]});
// Try with the EXACT connectivity probe but using non-Plan provider check (so it uses string content + temperature)
await test('exact oj non-plan:', {model: 'GLM-5.2', max_tokens: 1, temperature: 0.1, messages: [{role: 'user', content: 'hi'}]});
// Try with thinking field
await test('with thinking:', {model: 'GLM-5.2', max_tokens: 16, thinking: {type: 'enabled', budget_tokens: 100}, messages: [{role: 'user', content: 'hi'}]});
// Try tools + thinking
await test('with tools + thinking:', {model: 'GLM-5.2', max_tokens: 16, tools: [], thinking: {type: 'enabled', budget_tokens: 100}, messages: [{role: 'user', content: 'hi'}]});
// Try GLM-4.6 with system as string
await test('GLM-4.6 sys:', {model: 'GLM-4.6', max_tokens: 16, system: 'You are a helpful assistant.', messages: [{role: 'user', content: 'hi'}]});
// Try with multi system + tools
await test('multi sys tools:', {model: 'GLM-4.6', max_tokens: 16, system: [{type: 'text', text: 'You are a helpful assistant.'}, {type: 'text', text: 'Always respond in English.'}], tools: [], messages: [{role: 'user', content: 'hi'}]});
// Try with no anthropic-version
await test('no anthropic-ver:', {model: 'GLM-4.6', max_tokens: 16, messages: [{role: 'user', content: 'hi'}]});
