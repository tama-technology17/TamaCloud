# Image Upload API

Backend upload gambar sederhana, cepat, dan siap dijalankan — **Node.js + Express + Multer + Sharp + dotenv**.
Sudah dilengkapi **web playground (HTML/CSS/JS)** untuk mencoba API langsung dari browser.

```
Upload (multipart)  ->  Validasi (ekstensi + file signature)  ->  Kompresi otomatis (> 7 MB)
                    ->  Simpan sebagai <random-id>.<ext>  ->  URL publik + JSON response
```

---

## Fitur

| # | Fitur | Detail |
|---|-------|--------|
| 1 | Upload | `POST /upload`, `multipart/form-data`, field `file`, JPG/JPEG/PNG/WEBP/GIF, maks **20 MB** |
| 2 | Penyimpanan | Semua file masuk ke folder `upload/` (dibuat otomatis), nama asli **tidak pernah** dipakai |
| 3 | Nama file | Random ID aman (48 bit entropy) + ekstensi asli, contoh `7jHwuJq.png`, `a8Kx92P.webp` |
| 4 | Kompresi | Otomatis jika **> 7 MB**, diturunkan bertahap sampai **≤ 5 MB**, format tidak diubah |
| 5 | Response | JSON rapi: `success`, `status`, `message`, `data` |
| 6 | Static file | `GET /upload/<filename>` dilayani Express static |
| 7 | Error handling | Bentuk JSON konsisten + HTTP status yang benar |
| 8 | Keamanan | Validasi magic bytes, sanitasi nama, anti path traversal, limit ukuran, CORS, no info leak |
| 9 | Endpoint | `GET /`, `POST /upload`, `GET /upload/:filename`, `DELETE /upload/:filename` |
| 10 | Health check | `GET /health` |
| 11 | Frontend | Web playground di `GET /app` (HTML, tanpa build step) |

---

## Instalasi

```bash
cd image-upload-api
npm install
npm run dev          # mode pengembangan (node --watch)
```

Produksi:

```bash
npm start            # node src/server.js
```

Buka di browser:

| URL | Isi |
|-----|-----|
| http://localhost:3000/app | **Web playground (frontend HTML)** |
| http://localhost:3000/ | Informasi API (JSON) |
| http://localhost:3000/health | Health check |

---

## Struktur project

```
image-upload-api/
├── public/                  # Frontend (web playground)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── upload/                  # folder penyimpanan gambar (otomatis dibuat)
├── src/
│   ├── server.js            # bootstrap Express, route, error handler
│   ├── config.js            # env + konfigurasi terpusat
│   ├── routes/
│   │   └── upload.js        # POST/GET/DELETE /upload
│   ├── middleware/
│   │   └── upload.js        # multer, filter, validasi file signature
│   └── utils/
│       ├── fileName.js      # generator nama file + sanitasi
│       ├── compress.js      # kompresi bertahap dengan Sharp
│       └── logger.js        # logging sederhana
├── .env
├── .gitignore
├── package.json
└── README.md
```

> `config.js` dan `utils/logger.js` ditambahkan agar konfigurasi env dan logging tidak
> diduplikasi di setiap file.

---

## Environment variable

```env
PORT=3000
BASE_URL=http://localhost:3000
MAX_FILE_SIZE_MB=20
```

| Variable | Default | Keterangan |
|----------|---------|------------|
| `PORT` | `3000` | Port server |
| `BASE_URL` | `http://localhost:3000` | Prefix URL yang dikembalikan |
| `MAX_FILE_SIZE_MB` | `20` | Batas ukuran upload |
| `UPLOAD_DIR` | `./upload` | Lokasi penyimpanan (opsional) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

Tersedia juga konstanta internal: kompresi bila **> 7 MB**, target hasil **≤ 5 MB** (`src/config.js`).

---

## Endpoint

| Method | URL | Keterangan |
|--------|-----|------------|
| `GET` | `/` | Informasi API |
| `GET` | `/app` | Web playground (frontend) |
| `GET` | `/health` | Health check |
| `POST` | `/upload` | Upload gambar (field: `file`) |
| `GET` | `/upload/:filename` | Ambil gambar |
| `DELETE` | `/upload/:filename` | Hapus gambar |

### Health check

```json
{ "status": "ok", "timestamp": "2026-10-04T10:04:36.617Z" }
```

---

## Contoh request (cURL)

**Upload** — file kecil (≤ 7 MB, tidak dikompresi):

```bash
curl -X POST -F "file=@foto-saya.png" http://localhost:3000/upload
```

```json
{
  "success": true,
  "status": 200,
  "message": "Image uploaded successfully",
  "data": {
    "filename": "7jHwuJq.png",
    "original_filename": "foto-saya.png",
    "url": "http://localhost:3000/upload/7jHwuJq.png",
    "file_type": "image/png",
    "extension": ".png",
    "original_size": 7340032,
    "original_size_mb": 7,
    "final_size": 7340032,
    "final_size_mb": 7,
    "compressed": false,
    "upload_time": "2026-10-04T10:04:36.617Z"
  }
}
```

**Upload** — file besar (> 7 MB, dikompresi sampai ≤ 5 MB):

```bash
curl -X POST -F "file=@foto-besar.jpg" http://localhost:3000/upload
```

```json
{
  "success": true,
  "status": 200,
  "message": "Image uploaded successfully",
  "data": {
    "filename": "a8Kx92P.webp",
    "original_filename": "foto-besar.jpg",
    "url": "http://localhost:3000/upload/a8Kx92P.webp",
    "file_type": "image/jpeg",
    "extension": ".jpg",
    "original_size": 20178572,
    "original_size_mb": 19.24,
    "final_size": 4833621,
    "final_size_mb": 4.61,
    "compressed": true,
    "upload_time": "2026-10-04T10:04:36.617Z"
  }
}
```

**Ambil gambar:**

```bash
curl -O http://localhost:3000/upload/7jHwuJq.png
# atau buka di browser:
# http://localhost:3000/upload/7jHwuJq.png
```

**Hapus gambar:**

```bash
curl -X DELETE http://localhost:3000/upload/7jHwuJq.png
```

```json
{
  "success": true,
  "status": 200,
  "message": "Image deleted successfully",
  "data": { "filename": "7jHwuJq.png", "deleted": true }
}
```

**Health check:**

```bash
curl http://localhost:3000/health
```

Contoh request lengkap dengan header:

```bash
curl -X POST http://localhost:3000/upload \
  -H "Accept: application/json" \
  -F "file=@./foto-saya.png;type=image/png"
```

---

## Response error

Semua error memakai bentuk yang sama:

```json
{ "success": false, "status": 400, "message": "No image file uploaded" }
```

| Status | Message | Penyebab |
|--------|---------|----------|
| `400` | `No image file uploaded` | Tidak ada file pada request |
| `400` | `Unsupported image format. Allowed: JPG, PNG, WEBP, GIF` | Format tidak didukung / file bukan gambar asli |
| `400` | `Unexpected file field "image". Use the "file" field` | Nama field multipart salah |
| `400` | `Invalid filename` | Nama file pada URL tidak valid |
| `413` | `File is too large. Maximum size is 20 MB` | Ukuran melebihi batas |
| `404` | `Image not found` | File tidak ada / sudah dihapus |
| `404` | `Endpoint not found: GET /tidak-ada` | Route tidak terdaftar |
| `500` | `Failed to compress image` | Sharp gagal memproses gambar |
| `500` | `Failed to store image` | Gagal menulis ke storage |
| `500` | `Internal server error` | Error tak terduga (detail tidak pernah dibocorkan) |

---

## Frontend (web playground)

Buka **http://localhost:3000/app** — HTML/CSS/JS murni, tanpa framework dan tanpa build step
(`public/index.html`, `public/style.css`, `public/app.js`).

Fitur UI:

- **Drag & drop**, **klik untuk memilih** (multi-file), dan **paste dari clipboard** (`Ctrl+V`).
- **Progress bar** per file memakai `XMLHttpRequest.upload` (upload progress nyata).
- **Pratinjau** file sebelum/sesudah upload.
- **Galeri hasil upload**: thumbnail dari URL server, badge `COMPRESSED −xx%`, ukuran sebelum/sesudah.
- Aksi per kartu: **Buka** URL, **Salin URL**, **Hapus** (`DELETE /upload/:filename`), plus **Hapus semua**.
- **Lightbox** untuk melihat gambar ukuran penuh (`Esc` untuk menutup).
- **Health badge** + pengambilan limit dari `GET /` (max size & ambang kompresi).
- Menampilkan **JSON response terakhir** apa adanya, lengkap dengan tombol salin.
- Toast notifikasi untuk sukses/gagal.

Kalau frontend di-host terpisah, arahkan API lewat query string:

```
http://localhost:3000/app?api=https://api.domain.com
```

> `GET /` tetap mengembalikan JSON informasi API (sesuai spesifikasi). Untuk pengguna browser,
> buka `/app`.

---

## Cara kerja kompresi

1. Ukuran ≤ **7 MB** → file **disimpan apa adanya** (tanpa re-encode, kualitas 100% terjaga).
2. Ukuran > **7 MB** → `sharp` berjalan dalam beberapa langkah:
   - JPEG: kualitas 88 → 82 → 76 → 70 → 64 → 58 → 50 → 42
   - WEBP: kualitas 88 → 82 → 76 → 70 → 64 → 58 → 50 → 42
   - PNG: deflate lossless maksimum → kuantisasi `palette` (92 → 85 → 78 → 70 → 60 → 50)
   - GIF: re-encode `effort: 10` (animasi tetap dipertahankan)
3. Langkah pertama yang menghasilkan **≤ 5 MB** langsung dipakai → **kompresi tidak berulang yang tidak perlu**.
4. Bila kualitas terendah masih > 5 MB, gambar diperkecil bertahap (90% → 30%) sampai target tercapai.
5. **Format tidak pernah diubah** (JPG tetap JPG, GIF tetap GIF, animasi tetap animasi).
6. Bila hasil kompresi justru lebih besar dari file asli, file asli dipakai kembali.

---

## Keamanan

- **MIME type dari client tidak dipercaya** — tipe gambar ditentukan dari *magic bytes* (`FF D8 FF`, `89 50 4E 47…`, `RIFF….WEBP`, `GIF8[79]a`).
- File hasil filter tetapi gagal validasi signature langsung **dihapus** dari disk.
- Nama file penyimpanan = **random ID + ekstensi hasil deteksi** (`fs.open(..., 'wx')` → anti bentrok Even under concurrency).
- **Sanitasi nama file** asli (dipakai hanya untuk log/display, bukan path).
- **Anti path traversal**: hanya pola `<id>.<jpg|jpeg|png|webp|gif>` yang diterima, tanpa `/`, `\`, atau `..`, plus cek `path.resolve` tetap di dalam `upload/`.
- File diterima **maks 20 MB**, jumlah file/field dibatasi.
- **CORS** diaktifkan, `X-Content-Type-Options: nosniff`.
- Pesan error tidak pernah memuat stack trace, path absolut, atau pesan internal.
- File unduhan disimpan dengan nama unik → header `Cache-Control: immutable`.
- Temp file (`.tmp-*`) tidak bisa diakses (`express.static` mengabaikan dotfile) dan file temp yatim dibersihkan saat server start.
- Sharp `failOn: 'none'` + output berbasis buffer: file rusak tidak akan membuat proses crash atau menyisakan file setengah jadi di disk.

---

## Log

```text
2026-10-04T10:04:16.611Z [INFO] Image Upload API running at http://localhost:3000
2026-10-04T10:04:16.618Z [INFO] Web playground       http://localhost:3000/app
2026-10-04T10:04:16.619Z [INFO] Upload folder ready: /root/TamaCloud/image-upload-api/upload
2026-10-04T10:04:16.631Z [INFO] Limits: max 20 MB | compress above 7 MB -> target 5 MB
2026-10-04T10:04:20.101Z [INFO] Upload success {"filename":"OUyL-J71.jpg","original_mb":19.24,"final_mb":4.61,"compressed":true,"duration_ms":3120}
2026-10-04T10:04:20.140Z [INFO] Image compressed {"filename":"OUyL-J71.jpg","to_mb":4.61,"target_reached":true,"attempts":5,"duration_ms":3084}
2026-10-04T10:04:31.902Z [INFO] Image deleted {"filename":"P6fdLmYx.jpg"}
```

---

## Catatan

- Tanpa database — file langsung disimpan di `upload/`.
- Nama file asli **tidak pernah** dipakai di disk, jadi tidak ada masalah karakter aneh maupun tabrakan nama.
- Ingin ganti lokasi file: set `UPLOAD_DIR=/var/www/gambar` di `.env`.
- Behind reverse proxy (Nginx/PM2)? `trust proxy` sudah aktif dan `BASE_URL` bisa diarahkan ke domain publik.