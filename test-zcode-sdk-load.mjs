import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true, executablePath: '/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const scripts = [];
page.on('request', req => { if (req.resourceType() === 'script') scripts.push(req.url()); });
page.on('console', m => console.log('PAGE:', m.type(), m.text()));

await page.goto('https://zcode.z.ai/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

console.log('--- all scripts:');
scripts.forEach(s => console.log(' ', s));
console.log('--- all window keys with load/captcha/init/verify (first 30):');
const keys = await page.evaluate(() => Object.keys(window).filter(k => /load.*captcha|captcha.*load|loadAliyun|initCaptcha|captchaConfig/i.test(k)));
console.log(keys);

// Try to inject SDK manually
console.log('--- injecting aliyun captcha SDK ---');
await page.evaluate(() => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';
  s.onload = () => resolve('ok');
  s.onerror = (e) => reject(new Error('load failed'));
  document.head.appendChild(s);
})).catch(e => console.log('inject err:', e.message));

await page.waitForTimeout(2000);

const sdkCheck2 = await page.evaluate(() => ({ has: !!window.AliyunCaptcha, keys: window.AliyunCaptcha ? Object.keys(window.AliyunCaptcha).slice(0, 20) : [] }));
console.log('SDK after inject:', sdkCheck2);

await browser.close();
