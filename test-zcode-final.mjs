#!/usr/bin/env bash
JWT="$(sqlite3 /home/vanszs/.9router/db/data.sqlite "SELECT json_extract(data, '\$.providerSpecificData.zcodeJwtToken') FROM providerConnections WHERE provider = 'zcode';")"
URL="https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages"

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
echo "=== FULL response with full body ==="
curl -s -D - "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -H "X-ZCode-App-Version: 3.1.0" \
  -H "X-Platform: linux-x64" \
  -H "X-Client-Language: en-US" \
  -H "X-Client-Timezone: Asia/Jakarta" \
  -H "X-Os-Category: linux" \
  -H "X-Os-Version: $(uname -r)" \
  -d '{"model":"GLM-5.2","max_tokens":256,"system":"You are ZCode connectivity probe.","messages":[{"role":"user","content":"hi"}]}'
echo
echo
echo "=== Try with GLM-5-Turbo model ==="
P=$(get_captcha)
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5-Turbo","max_tokens":256,"system":"You are ZCode connectivity probe.","messages":[{"role":"user","content":"hi"}]}'
echo
echo
echo "=== Try with no body, just model ==="
P=$(get_captcha)
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2"}'
echo
echo
echo "=== Try with very large max_tokens ==="
P=$(get_captcha)
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":8192,"system":"You are ZCode connectivity probe.","messages":[{"role":"user","content":"hi"}]}'
echo
echo
echo "=== Try GLM-5.2-Max ==="
P=$(get_captcha)
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2-Max","max_tokens":256,"system":"You are ZCode connectivity probe.","messages":[{"role":"user","content":"hi"}]}'
echo
