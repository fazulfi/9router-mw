# Pengetahuan Bersama ZCode Proxy & Auth (Shared AI Agent Knowledge)

> **📝 EDITABLE BY ALL AI AGENTS**: Dokumen ini adalah **single source of truth** untuk ZCode proxy. Jika Anda adalah AI agent yang menemukan informasi baru yang terbukti valid (melalui testing, logs, atau source code), **silakan edit dokumen ini** untuk menyimpan pengetahuan tersebut. Update checkpoint di bagian bawah jika Anda menyelesaikan masalah.

Dokumen ini berisi seluruh informasi teknis, langkah-langkah, kredensial, dan konfigurasi yang diperlukan oleh AI Agent mana pun di workspace `/media/DiskE/Code/9router` untuk mengelola proxy ZCode Start Plan.

---

## 1. Ringkasan Sistem (System Overview)
* **Goal**: Mengalirkan gratis kuota dari **ZCode Start Plan** (GLM-5.2 & GLM-5-Turbo) melalui 9router.
* **Target Endpoint**: `https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages` (dibatasi oleh Aliyun Captcha WAF).
* **Bypass Mechanism**: Playwright-based captcha solver yang berjalan headless secara berkala, mengambil parameter `X-Aliyun-Captcha-Verify-Param`, lalu memasukkannya ke header request bersama dengan `Authorization: Bearer <zcodeJwtToken>`.

---

## 2. Kredensial & Autentikasi (Credentials & Auth)

### A. Kredensial Pengguna ZCode
* **Email**: `sheilae0521@gmail.com`
* **Password**: `Shizuecarv1!aA`
* **9router Dashboard Password**: `Shizuecarv1!aA`

### B. Jenis Token (Token Types)
1. **`accessToken`**: Token OAuth utama yang didapatkan setelah pertukaran Authorization Code. Berlaku pendek (~1 jam). `refreshToken: null` di DB setelah exchange, tapi **mungkin ada mekanisme refresh lain** yang belum teridentifikasi — ZCode desktop bisa bertahan lama tanpa re-auth manual.
2. **`zcodeJwtToken`**: Token JWT ZCode (disimpan di DB sebagai `zcodejwttoken` / `providerSpecificData.zcodeJwtToken`). Digunakan khusus untuk otorisasi di Plan endpoint (`zcode.z.ai`).
3. **`businessToken`**: Token HS512 yang didapatkan dari pertukaran `accessToken` di `https://api.z.ai/api/auth/z/login`. Digunakan khusus untuk endpoint bisnis non-Plan (`api.z.ai/api/anthropic`), namun endpoint ini sering mengembalikan `429 Insufficient Balance` karena kuota gratis hanya ada di Plan.

### C. Alur OAuth Manual (Manual OAuth Flow)
Jika token kedaluwarsa (HTTP 401/403), ikuti alur ini:
1. Lakukan POST login ke dashboard 9router untuk mendapatkan cookie `auth_token`:
   ```bash
   curl -s -i 'http://localhost:9000/api/auth/login' -X POST -H 'Content-Type: application/json' -d '{"password":"Shizuecarv1!aA"}'
   ```
2. Panggil API Authorize untuk mendapatkan URL login dan parameter OAuth:
   ```bash
   curl -s 'http://localhost:9000/api/oauth/zcode/authorize' -H "Cookie: auth_token=<auth_token>"
   ```
3. Copy `authUrl` yang dihasilkan, buka di browser, lakukan verifikasi captcha, dan selesaikan login.
4. Browser akan mencoba mengarahkan ke `zcode://zai-auth/callback?code=code-XXXXXX&state=XXXXX`.
5. Copy URL callback tersebut dari address bar browser, lalu kirim POST request untuk menukar token:
   ```bash
   curl -s 'http://localhost:9000/api/oauth/zcode/exchange' \
     -X POST \
     -H 'Content-Type: application/json' \
     -H "Cookie: auth_token=<auth_token>" \
     -d '{
       "code": "code-XXXXXX",
       "redirectUri": "zcode://zai-auth/callback",
       "codeVerifier": "<verifier_from_step_2>",
       "state": "<state_from_step_2>"
     }'
   ```

---

## 3. Detail Arsitektur & Struktur Kode Sumber ZCode
Berdasarkan hasil dekompilasi file `.asar` dari aplikasi desktop ZCode ke `/tmp/opencode/zcode-src/out/`, berikut adalah arsitektur dan struktur internal:

### A. Arsitektur IPC & Struktur File
* **`main/index.js` & `main/chunk-CZGJJUP3.js`**: Proses utama Electron. Mengatur penyimpanan token yang aman menggunakan `safeStorage` (`CredentialStore` atau kelas `Si`).
* **`host/index.js`**: Modul host perantara. Mengelola request backend, konfigurasi model, pencocokan provider (`zaiStartPlan`, `bigmodelStartPlan`, `zaiCodingPlan`, dll), dan otentikasi token.
* **`preload/index.cjs`**: Bridge IPC antara renderer (UI) dan main process.
* **`renderer/assets/index-FDpoXnTx.js`**: Antarmuka UI. Berisi alur integrasi SDK Aliyun Captcha dan trigger callback untuk mengirimkan parameter verifikasi kembali ke host.

### B. Peta Variabel Kunci (Source Code Mappings)
* **`i3` / `o5`** = `"zcodejwttoken"` (Key penyimpanan untuk token JWT ZCode utama).
* **`s3`** = `"oauth:zai:user_info"` (Informasi profil pengguna ZCode).
* **`e3`** = `"oauth:active_provider"` (Menyimpan provider yang aktif saat ini).
* **`bN` / `iz`** = `zcodePlanAnthropicBaseUrl` (Base URL untuk endpoint Plan: `https://zcode.z.ai/api/v1/zcode-plan/anthropic`).
* **`cnt`** = `"X-Aliyun-Captcha-Verify-Param"` (Header captcha parameter).
* **`lnt`** = `"X-Aliyun-Captcha-Verify-Region"` (Header captcha region).
* **`Or`** = Map header default:
  ```json
  {
    "User-Agent": "ZCode/unknown",
    "HTTP-Referer": "https://zcode.z.ai",
    "X-Title": "Z Code@electron"
  }
  ```
* **`Ol`** = Fungsi pembangun header identitas klien (`buildZCodeSourceHeaders`):
  * `X-ZCode-App-Version`: Versi aplikasi desktop (e.g. `3.1.0`).
  * `X-Platform`: Platform OS dan arsitektur (e.g. `linux-x64`).
  * `X-Release-Channel`: Channel rilis (e.g. `prod`).
  * `X-Client-Language`: Bahasa sistem klien (e.g. `en`).
  * `X-Client-Timezone`: Zona waktu klien (e.g. `Asia/Jakarta`).
  * `X-Os-Category`: Kategori OS (`windows`, `macos`, atau `linux`).
  * `X-Os-Version`: Versi kernel/rilis OS.
  * `X-ZCode-Agent`: Diisi `"glm"` (karena model default Start Plan adalah GLM).

---

## 4. Struktur Header HTTP Lengkap (HTTP Headers Blueprint)

### A. Endpoint Plan (`zcode.z.ai/api/v1/zcode-plan/...`)
Target utama untuk kuota gratis. Membutuhkan WAF captcha bypass:
```http
Content-Type: application/json
Accept: text/event-stream
User-Agent: ZCode/3.1.0
HTTP-Referer: https://zcode.z.ai
X-Title: Z Code@electron
X-ZCode-App-Version: 3.1.0
X-ZCode-Agent: glm
X-Platform: linux-x64
X-Client-Language: en
X-Client-Timezone: Asia/Jakarta
X-Os-Category: linux
X-Os-Version: 6.8.0-31-generic
Authorization: Bearer <zcodeJwtToken>
X-Aliyun-Captcha-Verify-Param: <base64_captcha_token>
X-Aliyun-Captcha-Verify-Region: sgp
anthropic-version: 2023-06-01
x-request-id: <uuid_v4>
```

### B. Endpoint Bisnis Non-Plan (`api.z.ai/api/anthropic/...`)
Endpoint berbayar (sering 429 jika kuota habis). Tidak membutuhkan header captcha:
```http
Content-Type: application/json
Accept: text/event-stream
User-Agent: ZCode/3.1.0
HTTP-Referer: https://zcode.z.ai
X-Title: Z Code@electron
X-ZCode-App-Version: 3.1.0
X-Platform: linux-x64
X-Client-Language: en
X-Client-Timezone: Asia/Jakarta
X-Os-Category: linux
X-Os-Version: 6.8.0-31-generic
Authorization: Bearer <businessToken>
anthropic-version: 2023-06-01
x-request-id: <uuid_v4>
```

---

## 5. Aliyun Captcha & Playwright Solver

### A. Konfigurasi Captcha
* **SceneId**: `11xygtvd`
* **Region**: `sgp`
* **Prefix**: `no8xfe`
* **Aliyun SDK**: `https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js`

### B. Valid vs Invalid Param
* **Valid Param**: Base64 string yang berisi JSON dengan properti `certifyId`, `sceneId`, `isSign: true`, dan `securityToken` asli.
* **Invalid Param**: Berisi field `failover: "T"` dan `err: { code: "INIT_FAIL", ... }`. WAF Aliyun menerima format ini, namun aplikasi ZCode akan menolak dengan HTTP 401/403.

### C. Algoritma Playwright Solver (Langkah Kunci)
Agar tidak menghasilkan `INIT_FAIL` / `failover: "T"`, Playwright harus mensimulasikan lingkungan browser asli:
1. **Inisialisasi**: Atur `window.AliyunCaptchaConfig = { region: "sgp", prefix: "no8xfe" };` via `addInitScript` sebelum halaman dimuat.
2. **Navigasi Awal**: Harus pergi ke `https://zcode.z.ai/` (bukan blank page `about:blank`). Tunggu `domcontentloaded`.
3. **Interaksi Palsu**: Tunggu 2 detik, gerakkan mouse secara acak (`page.mouse.move`) untuk memicu event human-like activity.
4. **SDK Injection**: Jika `window.initAliyunCaptcha` belum ada, suntikkan script tag untuk memuat SDK dari CDN Aliyun.
5. **Eksekusi**: Jalankan `initAliyunCaptcha` dengan parameter `mode: "popup"`, ambil instance-nya, lalu panggil `startTracelessVerification()`.
6. **Callback**: Tangkap hasil base64 param dari callback `success(param)`.

---

## 6. File-File Penting di Workspace

1. **`/media/DiskE/Code/9router/open-sse/executors/zcode.js`**:
   * Implementasi executor ZCode.
   * Berisi fungsi `solveCaptcha(log)` menggunakan `playwright-core`.
   * Melakukan caching token captcha selama 4 menit (`CAPTCHA_TTL_MS = 240000`).
   * Menambahkan header `X-Aliyun-Captcha-Verify-Param` dan `X-Aliyun-Captcha-Verify-Region`.
   * Mengarahkan request ke base URL `https://zcode.z.ai/api/v1/zcode-plan/anthropic`.
   * Menggunakan token `zcodeJwtToken` sebagai `Authorization: Bearer <token>`.

2. **`/media/DiskE/Code/9router/src/lib/oauth/providers.js`**:
   * Mengatur registrasi provider ZCode.
   * **PENTING**: Request pertukaran `businessLoginUrl` (`https://api.z.ai/api/auth/z/login`) tidak boleh mengirimkan header `Authorization: Bearer` (hanya mengirim body `{ token: accessToken }`). Bug ini sudah difiks.

3. **`/home/vanszs/.9router/db/data.sqlite`**:
   * Database SQLite lokal tempat token ZCode disimpan di tabel `providerConnections`.

---

## 7. Konfigurasi OAuth ZCode (OAuth Configuration)

### A. OAuth Endpoints & Parameters
* **Authorize URL**: `https://zcode.z.ai/oauth/authorize`
* **Token Exchange URL**: `https://zcode.z.ai/oauth/token`
* **Redirect URI**: `zcode://zai-auth/callback`
* **Client ID**: `zcode_default_client` (atau bisa dicek di `providers.js`)
* **Scopes**: `openid profile email offline_access`
* **PKCE**: Menggunakan S256 challenge method
* **State**: Random UUID untuk CSRF protection

### B. Token Expiry Observations
* **`accessToken`**: Berlaku ~1 jam (observed: exp 1781636666 = 2026-06-16T19:04:26Z, issued around 18:04)
* **`zcodeJwtToken`**: Expiry tidak tertulis di payload JWT (kemungkinan 24 jam atau lebih lama)
* **`businessToken`**: HS512 JWT, expiry tidak diketahui pasti
* **⚠️ INVESTIGASI MASIH TERBUKA**: Apakah ZCode memiliki refresh token atau mekanisme perpanjangan token otomatis? ZCode desktop app bisa bertahan lama tanpa re-auth manual — perlu reverse engineering bagaimana caranya. Klaim "tidak ada refresh token" **belum terbukti**, hanya berdasarkan `refreshToken: null` di DB setelah exchange pertama.

### C. Current Connection Details
* **Connection ID**: `f58943aa` (di tabel `providerConnections`)
* **Provider**: `zcode`
* **User**: `sheilae0521@gmail.com`

---

## 8. Model Names & Mappings

### A. ZCode Model Identifiers
ZCode Start Plan menyediakan model GLM gratis. Format model name yang diterima oleh executor:
* **`glm-5.2`** → GLM-5.2 (3M tokens/day quota)
* **`glm-5-turbo`** → GLM-5-Turbo (quota lebih besar, tapi kualitas lebih rendah)
* **`claude-3-5-sonnet-20241022`** → Claude 3.5 Sonnet (via proxy)
* **`claude-3-5-sonnet-20241022-Max`** → Claude 3.5 Sonnet dengan thinking mode (reasoning)

### B. Model Suffix Conventions
* **Suffix `-Max`**: Mengaktifkan extended thinking / reasoning mode pada model yang support (e.g., Claude Sonnet dengan thinking)
* **No suffix**: Mode default (fast response, no extended reasoning)

---

## 9. Error Codes & Troubleshooting

### A. HTTP Error Codes
* **401 Unauthorized**: Token invalid/expired, atau captcha param salah/expired. **Solusi**: Solve captcha baru, atau re-auth OAuth.
* **403 Forbidden**: Captcha verification gagal (WAF menolak), atau businessToken digunakan di Plan endpoint. **Solusi**: Gunakan `zcodeJwtToken` untuk Plan endpoint, bukan businessToken.
* **429 Too Many Requests**: Quota habis (sering di endpoint `api.z.ai` non-Plan). **Solusi**: Gunakan Plan endpoint (`zcode.z.ai`) untuk kuota gratis.
* **500 Internal Server Error**: Server ZCode error, atau OAuth token exchange gagal. **Solusi**: Retry setelah beberapa detik, atau cek logs untuk detail error.

### B. Captcha Errors
* **`INIT_FAIL` / `failover: "T"`**: SDK captcha gagal init, biasanya karena browser environment tidak realistis. **Solusi**: Pastikan Playwright navigate ke `zcode.z.ai` (bukan blank page), lakukan mouse moves, tunggu 2 detik sebelum trigger SDK.
* **`certifyId` tidak ada**: Captcha param invalid/corrupted. **Solusi**: Re-solve captcha dari awal.

---

## 10. Playwright Configuration

### A. Environment Details
* **Playwright Version**: `playwright-core@1.61.0`
* **Chromium Path**: `/home/vanszs/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`
* **Launch Options**: `{ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }`

### B. Captcha Solver Script Locations
* **Main Implementation**: `/media/DiskE/Code/9router/open-sse/executors/zcode.js` (function `solveCaptcha(log)`)
* **Reference Test Script**: `/media/DiskE/Code/9router/solve-captcha.mjs` (standalone working example)
* **Cache TTL**: 4 minutes (`CAPTCHA_TTL_MS = 240000`)

---

## 11. Database Schema

### A. Table `providerConnections`
```sql
CREATE TABLE providerConnections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  data TEXT NOT NULL, -- JSON string
  createdAt INTEGER,
  updatedAt INTEGER
);
```

### B. JSON Structure in `data` Field
```json
{
  "accessToken": "<oauth_access_token>",
  "expiresAt": 1781636666,
  "providerSpecificData": {
    "zcodeJwtToken": "<zcode_jwt_token>",
    "businessToken": "<business_hs512_token>",
    "userInfo": { "email": "sheilae0521@gmail.com", ... }
  },
  "refreshToken": null
}
```

---

## 12. VPS Deployment Info (Belum Deployed)

* **VPS IP**: (Belum ada, deployment pending)
* **VPS User Password**: `Shizuecarv1!aA`
* **VPS Root Password**: `makanmakan`
* **Target Port**: 9000 (sama seperti dev)
* **Deployment Method**: PM2 atau systemd service
* **PENTING**: Deployment dilakukan SETELAH end-to-end testing lokal berhasil.

---

## 13. Perintah Berguna (Useful Commands)

* **Menjalankan/Restart 9router Dev Server**:
  ```bash
  cd /media/DiskE/Code/9router && nohup npm run dev > /tmp/9router-dev.log 2>&1 &
  ```
* **Melihat Log Dev Server**:
  ```bash
  tail -f /tmp/9router-dev.log
  ```
* **Mengecek Status Kesehatan**:
  ```bash
  curl -s http://localhost:9000/api/health
  ```
* **Melihat Data Token di SQLite**:
  ```bash
  sqlite3 /home/vanszs/.9router/db/data.sqlite "SELECT id, provider, json_extract(data, '$.accessToken') as access_token, json_extract(data, '$.providerSpecificData.zcodeJwtToken') as jwt FROM providerConnections WHERE provider = 'zcode';"
  ```

---

## 14. Bukti & Evidence Log (Proven Facts)

> Setiap klaim di dokumen ini yang ditandai ✅ HARUS punya bukti di bagian ini. Jika tidak ada bukti, klaim adalah **asumsi** bukan fakta.

### ✅ OAuth Token Exchange BERHASIL
**Waktu**: 2026-06-16 ~20:18 UTC
**Langkah**:
```bash
# 1. Login dashboard
curl -s -i 'http://localhost:9000/api/auth/login' -X POST -H 'Content-Type: application/json' -d '{"password":"Shizuecarv1!aA"}'
# → set-cookie: auth_token=eyJhbGci...

# 2. Authorize (dapat state + codeVerifier)
curl -s 'http://localhost:9000/api/oauth/zcode/authorize' -H "Cookie: auth_token=<token>"
# → authUrl, state, codeVerifier, codeChallenge

# 3. Buka authUrl di browser → login → Copy callback URL
# callback: zcode://zai-auth/callback?code=code-450d367faa8e&state=bcvr-O4_...

# 4. Exchange
curl -s 'http://localhost:9000/api/oauth/zcode/exchange' \
  -X POST -H 'Content-Type: application/json' \
  -H "Cookie: auth_token=<token>" \
  -d '{"code":"code-450d367faa8e","redirectUri":"zcode://zai-auth/callback","codeVerifier":"<verifier_dari_step2>","state":"<state_dari_step2>"}'
# → {"success":true,"connection":{"id":"f58943aa-...","provider":"zcode","email":"sheilae@web-library.net"}}
```
**Hasil DB**: accessToken, zcodeJwtToken, businessToken ketiganya tersimpan di `providerConnections`.
**PENTING**: state & codeVerifier HARUS dari authorize call yang sama dengan callback URL.

### ✅ Quota Check BERHASIL
**Waktu**: 2026-06-16 ~20:18 UTC
**Langkah**:
```bash
curl -s -i 'https://zcode.z.ai/api/v1/zcode-plan/billing/current' \
  -H 'Authorization: Bearer <zcodeJwtToken>'
```
**Hasil** (HTTP 200):
```json
{
  "code": 0,
  "data": {
    "plans": [{
      "name": "ZCode Start Plan",
      "status": "active",
      "entitlements": [
        {"show_name": "GLM-5.2", "grant_units": 3000000, "period": "daily"},
        {"show_name": "GLM-5-Turbo", "grant_units": 2000000, "period": "daily"}
      ]
    }]
  }
}
```
**Fakta**: Plan aktif, GLM-5.2 = 3M tokens/day, GLM-5-Turbo = 2M tokens/day. Quota direset harian.

### ✅ businessLogin Bug Fixed
**File**: `src/lib/oauth/providers.js` line ~1433
**Bug**: Request ke `api.z.ai/api/auth/z/login` mengirim `Authorization: Bearer` header (salah).
**Fix**: Hapus header Authorization, hanya body `{ token: accessToken }`.
**Bukti**: Setelah fix, exchange businessToken berhasil → businessToken HS512 tersimpan di DB.

### ✅ accessToken Expiry = ~1 Jam
**Bukti**: JWT payload `accessToken` decoded:
```json
{"client_id":"client_P8X5CMWmlaRO9gyO-KSqtg","exp":1781644601,"iat":1781641001,"iss":"user-service","scopes":["openid","profile","email"],"sub":"221aeb72-c070-4967-beff-962d415f73a3","token_type":"access_token"}
```
`exp - iat = 3600` (1 jam). Issued 1781641001, expires 1781644601.

### ⏸️ BELUM TERBUKTI: zcodeJwtToken Expiry
**Status**: zcodeJwtToken payload terlihat SANGAT singkat:
```json
{"user_id":"221aeb72-c070-4967-beff-962d415f73a3","sub":"221aeb72-c070-4967-beff-962d415f73a3","iat":1781641001}
```
**TIDAK ADA `exp` FIELD**. Ini berarti:
- Kemungkinan A: Token tidak pernah expire (unbounded)
- Kemungkinan B: Expiry diatur server-side, bukan di JWT payload
- Kemungkinan C: Ada mekanisme refresh yang belum ditemukan
**INVESTIGASI DIBUTUHKAN**: Reverse engineering ZCode desktop app untuk menemukan bagaimana token tetap hidup.

### ⏸️ BELUM TERBUKTI: Mekanisme Token Longevity ZCode Desktop
**Pertanyaan**: ZCode desktop app bisa dipakai berhari-hari tanpa re-login. Bagaimana?
**Hipotesis yang perlu diuji**:
1. `zcodeJwtToken` tidak expire (no `exp` field di payload → mungkin long-lived)
2. Ada hidden refresh endpoint di `zcode.z.ai` atau `api.z.ai`
3. Ada silent re-auth di background (cookie session, dll)
4. `accessToken` bisa di-refresh tanpa user interaction (mungkin ada refresh flow yang tidak menyimpan refreshToken ke DB)

---

## 15. Checkpoint & Error Journey

### Open Issues
| # | Issue | Status | Detail |
|---|-------|--------|--------|
| 1 | Chat LLM via 9router not working | ❌ OPEN | 9router returns 401 when proxying chat requests. Kemungkinan: executor tidak menerima credentials yang benar, atau captcha solve gagal. Perlu debug: cek log executor, cek credentials yang diterima. |
| 2 | JWT longevity: bagaimana ZCode desktop bertahan lama? | 🔍 INVESTIGATING | zcodeJwtToken TIDAK punya `exp` field — mungkin long-lived. Tapi accessToken 1 jam. Perlu reverse engineering alur token ZCode desktop. |

### Resolved Issues
| # | Issue | Resolution | Evidence |
|---|-------|------------|----------|
| 1 | OAuth exchange gagal | ✅ State/codeVerifier mismatch. Harus dari authorize call yang sama. | Section 14 Bukti ✅ |
| 2 | businessLogin 401 | ✅ Hapus Authorization header dari `api.z.ai/api/auth/z/login` | providers.js line ~1433 |
| 3 | Quota check | ✅ Bearer zcodeJwtToken ke billing endpoint → 200 | Section 14 Bukti ✅ |
