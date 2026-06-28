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
