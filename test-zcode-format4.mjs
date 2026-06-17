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

async function test(label, body, headers = {}, useCaptcha = true) {
  let param = useCaptcha ? await getCaptcha() : null;
  const baseHeaders = {
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
    'anthropic-version': '2023-06-01',
  };
  if (param) {
    baseHeaders['X-Aliyun-Captcha-Verify-Param'] = param;
    baseHeaders['X-Aliyun-Captcha-Verify-Region'] = 'sgp';
  }
  const resp = await fetch(URL, {
    method: 'POST',
    headers: {...baseHeaders, ...headers},
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  console.log(label, 'STATUS:', resp.status, 'BODY:', text.slice(0, 250));
}

// WITHOUT captcha - to see what error 3001 means
await test('no-captcha:', {model: 'GLM-5.2', max_tokens: 16, messages: [{role: 'user', content: 'hi'}]}, {}, false);
// Try with model GLM-5-Turbo only
await test('GLM-5-Turbo:', {model: 'GLM-5-Turbo', max_tokens: 16, messages: [{role: 'user', content: 'hi'}]});
// Try with tool field
await test('tools:', {model: 'GLM-5.2', max_tokens: 16, tools: [], messages: [{role: 'user', content: 'hi'}]});
// Try with stop_sequences
await test('stop:', {model: 'GLM-5.2', max_tokens: 16, stop_sequences: ['\n'], messages: [{role: 'user', content: 'hi'}]});
// Try with top_p
await test('top_p:', {model: 'GLM-5.2', max_tokens: 16, top_p: 0.9, messages: [{role: 'user', content: 'hi'}]});
// Try with stream: true + content string
await test('stream+str:', {model: 'GLM-5.2', max_tokens: 16, stream: true, messages: [{role: 'user', content: 'hi'}]});
