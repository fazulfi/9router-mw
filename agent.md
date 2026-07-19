# Panduan Menjalankan Workspace 9router (Production)

File ini berisi panduan benar untuk mem-build dan menjalankan aplikasi Next.js `9router` ini dalam lingkungan production menggunakan PM2.

## 1. Konfigurasi Environment
Pastikan file `.env` sudah diatur dengan benar dan pastikan `PORT` telah disesuaikan (contoh `PORT=3003`) agar sesuai dengan proxy (seperti Nginx atau Cloudflare).

## 2. Build Aplikasi
Aplikasi ini menggunakan output mode `standalone` dari Next.js untuk optimasi ukuran deployment.
Gunakan perintah berikut untuk melakukan build:
```bash
pnpm run build
```

## 3. Menyalin Static Assets (Penting!)
Dalam mode `standalone`, Next.js tidak secara otomatis memindahkan aset statis untuk mode produksi, yang dapat mengakibatkan gambar (icons) atau file CSS hilang dari antarmuka web.
Setelah proses build selesai, jalankan perintah ini dari root folder proyek:
```bash
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
```

## 4. Menjalankan dengan PM2
Jalankan file `server.js` menggunakan PM2. File ini adalah wrapper yang default ke port `20128` jika `PORT` tidak di-set, dan sangat disarankan untuk tetap mendefinisikan port di environment saat menjalankan PM2 (pastikan port sesuai dengan upstream proxy Nginx Anda, contoh port 3003):

```bash
# Menjalankan instance baru (ganti 3003 sesuai konfigurasi upstream Nginx)
PORT=3003 pm2 start server.js --name 9router

# Jika aplikasi sudah pernah berjalan sebelumnya, pastikan restart selalu membawa argumen --update-env
PORT=3003 pm2 restart 9router --update-env
```

## 5. Simpan Status PM2
Agar aplikasi akan secara otomatis kembali berjalan sewaktu server direstart, simpan state PM2 saat ini:
```bash
pm2 save
```

## Troubleshooting 

- **502 Bad Gateway:** 
  Masalah 502 dari Cloudflare/Nginx biasanya dikarenakan `9router` berjalan di port default Next.js (3000) sedangkan Nginx mengarah ke port 3003. Selalu periksa `PORT` environment pada PM2 (`pm2 env 9router | grep PORT`).
  
- **Ikon Ai atau StyleSheet tidak termuat di Dashboard:**
  Berarti Anda melewati **Langkah 3** di atas. Pastikan folder `public` dan `.next/static` telah disalin kedalam `.next/standalone/` setelah build baru sebelum me-restart pm2.

---

## 6. Custom Fitur VansRouter Wajib Dijaga Saat Sync Upstream

Daftar ini **harus diverifikasi** setiap kali melakukan cherry-pick atau merge dari `decolua/9router`. Gunakan:

```bash
git diff <v0.9.0-commit> dev --stat  # pastikan tidak ada file custom hilang
```

| # | Fitur | Lokasi |
|---|---|---|
| 1 | Combo per-target timeout (`targetTimeoutMs`) | `src/sse/handlers/chat.js` |
| 2 | Ponytail handler param (`ponytailEnabled`, `ponytailLevel`) | `src/sse/handlers/chat.js` |
| 3 | Caveman handler param (`cavemanEnabled`, `cavemanLevel`) | `src/sse/handlers/chat.js` |
| 4 | ACL kind filter (`isKindAllowed`) | `src/sse/services/auth.js` |
| 5 | ACL provider filter (`isProviderAllowed`) | `src/sse/services/auth.js` |
| 6 | ACL combo filter (`isComboAllowed`) | `src/sse/services/auth.js` |
| 7 | Trusted internal call (`isTrustedInternalRequest`) | `src/sse/services/auth.js` |
| 8 | Remote bypass guard (`allowRemoteNoApiKey`) | `src/dashboardGuard.js` |
| 9 | DB folder constant (`APP_NAME = "9router"`) | `src/lib/dataDir.js` |
| 10 | Local ZCode provider | `open-sse/providers/registry/zcode.js` |
| 11 | ZCode executor | `open-sse/executors/zcode.js` |
| 12 | 429 classification (`classify429`) | `open-sse/services/accountFallback.js` |
| 13 | YAGNI ponytail mode | `open-sse/rtk/ponytail.js` |
| 14 | Terse caveman mode | `open-sse/rtk/caveman.js` |
| 15 | Proxy pool selection (`pickProxyPoolId`) | `src/sse/services/auth.js` |
| 16 | Connection proxy layer (`connectionProxy`) | `src/lib/network/connectionProxy.js` |
| 17 | Sidebar VansRouter brand | `src/shared/components/Sidebar.js` |
| 18 | Provider detail connections pagination (10/page) | `src/app/(dashboard)/dashboard/providers/[id]/connectionsPagination.js` |
| 19 | ACL filter di `GET /v1/models` (validate key + filter providers) | `src/app/api/v1/models/route.js` |

### ⚠️ Pelajaran: ACL Block di `GET /v1/models` Pernah Hilang

Saat cherry-pick dari `decolua/9router` v0.5.31–v0.5.35 (commit `5f35d7d42`), upstream **dropped seluruh blok ACL** di handler `GET` `src/app/api/v1/models/route.js`:
- `extractApiKey(request)` validation
- `isValidApiKey(apiKey)` check
- `isProviderAllowed(apiKeyInfo, providerAlias)` filter
- `isComboAllowed(apiKeyInfo, comboName)` filter
- `data.filter((_, i) => allowedChecks[i])`

**Unit test sebelumnya tidak mendeteksi** karena hanya cek `src.toContain("isProviderAllowed")` — string tersebut tetap ada di `import` meskipun handler-nya sudah tidak memanggilnya.

### Cara Cek ACL Aktif (BUKAN Cuma Di-Import)

```bash
# Test ini akan mendeteksi regression ACL di masa depan
npx vitest run tests/unit/post-merge-verification.test.js
```

Test yang relevan di `tests/unit/post-merge-verification.test.js`:

```javascript
it("GET handler validates API key before returning models", () => {
  const getHandler = src.slice(src.indexOf("export async function GET(request)"));
  expect(getHandler).toContain("isValidApiKey(apiKey)");
});

it("GET handler filters models by isProviderAllowed and isComboAllowed", () => {
  const getHandler = src.slice(src.indexOf("export async function GET(request)"));
  expect(getHandler).toContain("isProviderAllowed(apiKeyInfo");
  expect(getHandler).toContain("isComboAllowed(apiKeyInfo");
  expect(getHandler).toContain("data.filter(");
});
```

**Aturan**: setiap cek custom feature harus `indexOf("export async function GET")` atau `indexOf("export async function POST")` dulu, baru `toContain` di substring hasil slice. **Jangan** cek `toContain` di file level — import statement tidak membuktikan fitur aktif.

### Known-Lost Features (Belum Di-restore)

Fitur-fitur ini pernah dihapus oleh merge upstream atau force-reset. Status: **hilang dari `dev` saat ini**. Catat agar tidak dilupakan di sync berikutnya:

| Fitur | Komit asal (pernah restore) | Status di dev saat ini |
|---|---|---|
| NVIDIA/OpenCode "Fetch & Test" button | `3d66ced79` (Juni 2026, 1754 baris diff) | Hilang — page.js tidak punya handler `handleAutoFetchAndTest` |
| usage filter di usage dashboard | `9b71cf5b9` | Hilang — UsageTable.js tidak punya filter UI |

Cara restore yang aman: cherry-pick ke branch terisolasi (`feat/restore-nvidia-fetch-test`), resolve konflik, jalankan `pnpm run build` + `npx vitest run tests/unit/post-merge-verification.test.js`, baru merge ke `dev`.

### Fitur YAGNI yang TIDAK BOLEAH Di-restore (Custom Provider Multi-Account)

**Decision (user-confirmed, Juli 2026)**: Custom provider (OpenAI/Anthropic-compatible, Custom Embedding) **HARUS memperbolehkan banyak koneksi per node** untuk round-robin/sticky routing multi-key load balancing.

Komit `44d8de288` (Juni 2026) yang menambahkan one-connection guard untuk compatible/embedding nodes **tidak boleh diadopsi ulang**. Jika upstream pernah mengembalikan guard ini, **SKIP/HYBRID**:

```javascript
// src/app/api/providers/route.js baris 159-160 — KUNCI ini:
if (isOpenAICompatibleProvider(provider)) {
  // Compatible/embedding nodes: allow multiple connections per node for
  // round-robin/sticky routing across accounts (multi-key load balancing).
}
```

**Test pengunci** ada di `tests/unit/post-merge-verification.test.js` di bawah ini. Kalau upstream merge menambahkan guard ini lagi, test akan FAIL → revert bagian itu.

```javascript
it("POST /api/providers allows multiple connections per node for compatible providers", () => {
  const src = read("src/app/api/providers/route.js");
  // Komentar "allow multiple connections per node" harus ada
  expect(src).toMatch(/allow multiple connections per node/);
  // Tidak boleh ada code yang throw 400 kalau connection kedua untuk node yang sama
  expect(src).not.toMatch(/existingConnection.*400/);
});
```
