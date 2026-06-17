// Login to zcode.z.ai web with our auth_token, then send a chat message
import { chromium } from 'playwright-core';

const AUTH_TOKEN = process.env.AUTH_TOKEN;
const ZCODE_JWT = process.env.ZCODE_JWT;
if (!AUTH_TOKEN) { console.error('Set AUTH_TOKEN'); process.exit(1); }

const browser = await chromium.launch({ headless: true, executablePath: '/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36' });

// Set the auth cookie
await ctx.addCookies([{
  name: 'auth_token',
  value: AUTH_TOKEN,
  domain: 'zcode.z.ai',
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'None',
}]);

const page = await ctx.newPage();

// Capture all network requests
const requests = [];
page.on('request', req => {
  if (req.url().includes('zcode.z.ai') && !req.url().includes('_next/static') && !req.url().includes('.css') && !req.url().includes('.woff')) {
    requests.push({
      method: req.method(),
      url: req.url(),
      headers: req.headers(),
      postData: req.postData()?.slice(0, 1000),
    });
  }
});

console.log('--- 1. go to zcode.z.ai ---');
await page.goto('https://zcode.z.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

console.log('--- 2. check if logged in ---');
const userInfo = await page.evaluate(() => {
  const u = window.localStorage.getItem('zcode-user');
  return u ? JSON.parse(u) : null;
});
console.log('userInfo:', userInfo);

console.log('--- 3. find chat input ---');
// ZCode web has a chat input somewhere
const chatInput = await page.$('textarea, [contenteditable="true"], input[type="text"]');
if (chatInput) {
  console.log('found chat input, typing...');
  await chatInput.fill('hi');
  await page.waitForTimeout(1000);
  // Try to find send button
  const sendBtn = await page.$('button[type="submit"], [aria-label*="send" i]');
  if (sendBtn) {
    await sendBtn.click();
    await page.waitForTimeout(8000);
  } else {
    await chatInput.press('Enter');
    await page.waitForTimeout(8000);
  }
} else {
  console.log('NO chat input found');
}

console.log('--- 4. captured requests ---');
for (const r of requests) {
  console.log(`\n${r.method} ${r.url}`);
  if (r.postData) console.log('  body:', r.postData);
}

await browser.close();
