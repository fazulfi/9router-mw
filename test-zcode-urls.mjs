#!/usr/bin/env bash
JWT="$(sqlite3 /home/vanszs/.9router/db/data.sqlite "SELECT json_extract(data, '\$.providerSpecificData.zcodeJwtToken') FROM providerConnections WHERE provider = 'zcode';")"

get_captcha() {
  timeout 30 node -e "
import('playwright-core').then(async (pw) => {
const browser = await pw.chromium.launch({
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
console.log(param);
})"
}

P=$(get_captcha)
echo "=== 1. api.z.ai non-Plan endpoint ==="
curl -s -D - "https://api.z.ai/api/anthropic/v1/messages" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}' | head -c 1500
echo
echo
P=$(get_captcha)
echo "=== 2. /api/anthropic/v1/messages (no /zcode-plan/) ==="
curl -s "https://zcode.z.ai/api/anthropic/v1/messages" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}' | head -c 1000
echo
echo
P=$(get_captcha)
echo "=== 3. Plan openai chat completions path ==="
curl -s "https://zcode.z.ai/api/v1/zcode-plan/openai/v1/chat/completions" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}' | head -c 1000
echo
echo
P=$(get_captcha)
echo "=== 4. /api/v1/zcode-plan/v1/messages (no anthropic) ==="
curl -s "https://zcode.z.ai/api/v1/zcode-plan/v1/messages" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}' | head -c 1000
echo
echo
P=$(get_captcha)
echo "=== 5. /api/v1/zcode-plan/messages ==="
curl -s "https://zcode.z.ai/api/v1/zcode-plan/messages" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}' | head -c 1000
echo
echo
P=$(get_captcha)
echo "=== 6. try x-www-form-urlencoded ==="
curl -s "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  --data-urlencode 'model=GLM-5.2' \
  --data-urlencode 'max_tokens=256' \
  --data-urlencode 'messages=[{"role":"user","content":"hi"}]' | head -c 1000
echo
echo
P=$(get_captcha)
echo "=== 7. try /v2/ ==="
curl -s "https://zcode.z.ai/api/v2/zcode-plan/anthropic/v1/messages" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}' | head -c 1000
echo
echo
P=$(get_captcha)
echo "=== 8. /api/v1/zcode-plan/anthropic/v1/messages (no /v1/ at start of plan) ==="
curl -s "https://zcode.z.ai/api/zcode-plan/anthropic/v1/messages" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}' | head -c 1000
echo
