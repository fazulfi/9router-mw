#!/usr/bin/env bash
set -e
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

# Test A: baseline (no extra headers) - what we know
P=$(get_captcha)
echo "=== A. BASELINE: Bearer + ZCode headers (no X-Api-Key, no claude UA) ==="
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai/" \
  -H "X-Title: ZCode" \
  -H "X-ZCode-App-Version: 3.1.0" \
  -H "X-Platform: desktop" \
  -H "X-Client-Language: en-US" \
  -H "X-Client-Timezone: Asia/Jakarta" \
  -H "X-Os-Category: Linux" \
  -H "X-Os-Version: $(uname -r)" \
  -H "X-ZCode-Agent: ZCode/3.1.0 (desktop; Linux)" \
  -d '{"model":"GLM-5.2","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' | head -c 500
echo

# Test B: add anthropic-version
P=$(get_captcha)
echo "=== B. + anthropic-version ==="
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai/" \
  -H "X-Title: ZCode" \
  -H "X-ZCode-App-Version: 3.1.0" \
  -H "X-Platform: desktop" \
  -H "X-Client-Language: en-US" \
  -H "X-Client-Timezone: Asia/Jakarta" \
  -H "X-Os-Category: Linux" \
  -H "X-Os-Version: $(uname -r)" \
  -H "X-ZCode-Agent: ZCode/3.1.0 (desktop; Linux)" \
  -d '{"model":"GLM-5.2","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' | head -c 500
echo

# Test C: add claude-cli UA
P=$(get_captcha)
echo "=== C. + claude-cli UA ==="
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: claude-cli/1.0.115 (external, cli)" \
  -H "HTTP-Referer: https://zcode.z.ai/" \
  -H "X-Title: ZCode" \
  -H "X-ZCode-App-Version: 3.1.0" \
  -H "X-Platform: desktop" \
  -H "X-Client-Language: en-US" \
  -H "X-Client-Timezone: Asia/Jakarta" \
  -H "X-Os-Category: Linux" \
  -H "X-Os-Version: $(uname -r)" \
  -H "X-ZCode-Agent: ZCode/3.1.0 (desktop; Linux)" \
  -d '{"model":"GLM-5.2","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' | head -c 500
echo

# Test D: add X-Api-Key (matching rj function)
P=$(get_captcha)
echo "=== D. + X-Api-Key ==="
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "X-Api-Key: $JWT" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: ZCode/3.1.0" \
  -H "HTTP-Referer: https://zcode.z.ai/" \
  -H "X-Title: ZCode" \
  -H "X-ZCode-App-Version: 3.1.0" \
  -H "X-Platform: desktop" \
  -H "X-Client-Language: en-US" \
  -H "X-Client-Timezone: Asia/Jakarta" \
  -H "X-Os-Category: Linux" \
  -H "X-Os-Version: $(uname -r)" \
  -H "X-ZCode-Agent: ZCode/3.1.0 (desktop; Linux)" \
  -d '{"model":"GLM-5.2","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' | head -c 500
echo

# Test E: full rj() headers
P=$(get_captcha)
echo "=== E. FULL rj() headers (Bearer + X-Api-Key + claude UA + ADBA + DashScope) ==="
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "X-Api-Key: $JWT" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -H "anthropic-dangerous-direct-browser-access: true" \
  -H "X-DashScope-Client: cli-1.0.115" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: claude-cli/1.0.115 (external, cli)" \
  -H "HTTP-Referer: https://zcode.z.ai/" \
  -H "X-Title: ZCode" \
  -H "X-ZCode-App-Version: 3.1.0" \
  -H "X-Platform: desktop" \
  -H "X-Client-Language: en-US" \
  -H "X-Client-Timezone: Asia/Jakarta" \
  -H "X-Os-Category: Linux" \
  -H "X-Os-Version: $(uname -r)" \
  -H "X-ZCode-Agent: ZCode/3.1.0 (desktop; Linux)" \
  -d '{"model":"GLM-5.2","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' | head -c 500
echo

# Test F: full rj() headers + array content
P=$(get_captcha)
echo "=== F. FULL rj() headers + ARRAY content ==="
curl -s "$URL" -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "X-Api-Key: $JWT" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -H "anthropic-dangerous-direct-browser-access: true" \
  -H "X-DashScope-Client: cli-1.0.115" \
  -H "X-Aliyun-Captcha-Verify-Param: $P" \
  -H "X-Aliyun-Captcha-Verify-Region: sgp" \
  -H "User-Agent: claude-cli/1.0.115 (external, cli)" \
  -H "HTTP-Referer: https://zcode.z.ai/" \
  -H "X-Title: ZCode" \
  -H "X-ZCode-App-Version: 3.1.0" \
  -H "X-Platform: desktop" \
  -H "X-Client-Language: en-US" \
  -H "X-Client-Timezone: Asia/Jakarta" \
  -H "X-Os-Category: Linux" \
  -H "X-Os-Version: $(uname -r)" \
  -H "X-ZCode-Agent: ZCode/3.1.0 (desktop; Linux)" \
  -d '{"model":"GLM-5.2","max_tokens":16,"stream":true,"system":[{"type":"text","text":"You are ZCode connectivity probe."}],"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}' | head -c 500
echo
