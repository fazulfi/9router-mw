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

# Try with stream: true (required for Plan?)
P=$(get_captcha)
echo "=== 1. stream=true with system string ==="
curl -s -D - "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"stream":true,"system":"You are ZCode connectivity probe.","messages":[{"role":"user","content":"hi"}]}' | head -c 2000
echo
echo
# Try with stream: true + body has more text
P=$(get_captcha)
echo "=== 2. stream=true with realistic prompt ==="
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"stream":true,"system":"You are a helpful assistant.","messages":[{"role":"user","content":"Say hello in one word."}]}'
echo
echo
# Try with anthropic-version 2024-01-01
P=$(get_captcha)
echo "=== 3. anthropic-version 2024-01-01 ==="
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2024-01-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"stream":true,"system":"You are a helpful assistant.","messages":[{"role":"user","content":"hi"}]}'
echo
echo
# Try without anthropic-version
P=$(get_captcha)
echo "=== 4. no anthropic-version ==="
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","max_tokens":256,"stream":true,"system":"You are a helpful assistant.","messages":[{"role":"user","content":"hi"}]}'
echo
echo
# Try minimal body with stream
P=$(get_captcha)
echo "=== 5. minimal with stream ==="
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai" \
  -H "X-Title: Z Code@electron" \
  -d '{"model":"GLM-5.2","stream":true,"messages":[{"role":"user","content":"hi"}]}'
echo
echo
# Try with all the headers ZCode uses including X-Release-Channel
P=$(get_captcha)
echo "=== 6. With all ZCode headers including X-Release-Channel ==="
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
  -H "X-Release-Channel: stable" \
  -H "X-Platform: linux-x64" \
  -H "X-Client-Language: en-US" \
  -H "X-Client-Timezone: Asia/Jakarta" \
  -H "X-Os-Category: linux" \
  -H "X-Os-Version: $(uname -r)" \
  -H "anthropic-dangerous-direct-browser-access: true" \
  -H "X-DashScope-Client: cli-1.0.115" \
  -d '{"model":"GLM-5.2","max_tokens":256,"stream":true,"system":"You are a helpful assistant.","messages":[{"role":"user","content":"hi"}]}' | head -c 2000
echo
