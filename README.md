# TamaCloud

**File upload API** untuk gambar, video, dan audio — **Node.js + Express + Multer + Sharp + dotenv**.
Dilengkapi **web playground (HTML/CSS/JS)** tanpa build step untuk mencoba API langsung dari browser.

```
Upload (multipart)  ->  Validasi (ekstensi + file signature)  ->  Pisahkan per kategori
   image/ : kompresi otomatis (> 7 MB -> <= 5 MB)
   video/ : tanpa kompresi (maks 50 MB)
   audio/ : tanpa kompresi (maks 50 MB)
                     ->  Simpan sebagai <random-id>.<ext>  ->  URL publik + JSON response
```

---

## Fitur

| # | Fitur | Detail |
|---|-------|--------|
| 1 | Upload | `POST /upload`, `multipart/form-data`, field `file`, multi-file via UI |
| 2 | Kategori | Gambar/video/audio dipisahkan: `upload/image`, `upload/video`, `upload/audio` |
| 3 | Format | Gambar: JPG/JPEG/PNG/WEBP/GIF · Video: MP4/M4V/WEBM/MOV/AVI/MKV/OGV/3GP · Audio: MP3/WAV/OGG/OGA/M4A/AAC/FLAC |
| 4 | Limit | Gambar **20 MB**, Video & Audio **50 MB** (batas per kategori) |
| 5 | Penyimpanan | Folder dibuat otomatis, nama asli **tidak pernah** dipakai di disk |
| 6 | Nama file | Random ID aman (48 bit entropy) + ekstensi hasil deteksi, contoh `7jHwuJq.png`, `a8Kx92P.mp4` |
| 7 | Kompresi | **Hanya gambar > 7 MB**, diturunkan bertahap sampai **≤ 5 MB**, format tidak diubah |
| 8 | Response | JSON rapi: `success`, `status`, `message`, `data` (+ `category`) |
| 9 | Static file | `GET /upload/<category>/<filename>` dilayani Express static |
| 10 | Endpoint | `GET /`, `GET /health`, `POST /upload`, `GET|DELETE /upload/:category/:filename` |
| 11 | Error handling | Bentuk JSON konsisten + HTTP status yang benar |
| 12 | Keamanan | Validasi magic bytes, sanitasi nama, anti path traversal, limit, CORS, no info leak |
| 13 | Frontend | Web playground di `GET /app` (HTML/CSS/JS murni, tanpa framework) |

---

## Instalasi

```bash
git clone https://github.com/tama-technology17/TamaCloud.git
cd TamaCloud
npm install
cp .env.example .env      # lalu sesuaikan bila perlu
npm run dev               # mode pengembangan (node --watch)
```

Produksi:

```bash
npm start                 # node src/server.js
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
TamaCloud/
├── public/                      # Frontend (web playground, tanpa build step)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── upload/                      # folder penyimpanan (otomatis dibuat)
│   ├── image/                   # .jpg .jpeg .png .webp .gif
│   ├── video/                   # .mp4 .m4v .webm .mov .avi .mkv .ogv .3gp
│   └── audio/                   # .mp3 .wav .ogg .oga .m4a .aac .flac
├── src/
│   ├── server.js                # bootstrap Express, static, error handler
│   ├── config.js                # env + definisi kategori (tipe, limit, folder)
│   ├── routes/
│   │   └── upload.js            # POST /upload, GET|DELETE /upload/...
│   ├── middleware/
│   │   └── upload.js            # multer, filter, signature, limit per kategori
│   └── utils/
│       ├── fileName.js          # generator nama file, routing kategori, sanitasi
│       ├── compress.js          # kompresi bertahap dengan Sharp
│       └── logger.js            # logging sederhana
├── .env.example
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
MAX_MEDIA_FILE_SIZE_MB=50
LOG_LEVEL=info
```

| Variable | Default | Keterangan |
|----------|---------|------------|
| `PORT` | `3000` | Port server |
| `BASE_URL` | `http://localhost:3000` | Prefix URL yang dikembalikan |
| `MAX_FILE_SIZE_MB` | `20` | Batas ukuran **gambar** |
| `MAX_MEDIA_FILE_SIZE_MB` | `50` | Batas ukuran **video & audio** |
| `UPLOAD_DIR` | `./upload` | Lokasi penyimpanan (opsional) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

Tersedia juga konstanta internal: kompresi bila **> 7 MB**, target hasil **≤ 5 MB** (`src/config.js`).

---

## Endpoint

| Method | URL | Keterangan |
|--------|-----|------------|
| `GET` | `/` | Informasi API |
| `GET` | `/app` | Web playground (frontend HTML) |
| `GET` | `/health` | Health check |
| `POST` | `/upload` | Upload file (field: `file`) |
| `GET` | `/upload/:category/:filename` | Ambil file (`category`: `image` / `video` / `audio`) |
| `DELETE` | `/upload/:category/:filename` | Hapus file |
| `GET` | `/upload/:filename` | Ambil file (URL lama tanpa kategori) |
| `DELETE` | `/upload/:filename` | Hapus file (URL lama tanpa kategori) |

### Health check

```json
{ "status": "ok", "timestamp": "2026-10-04T10:04:36.617Z" }
```

---

## Contoh request (cURL)

**Upload gambar kecil** (≤ 7 MB, tanpa kompresi):

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
    "category": "image",
    "original_filename": "foto-saya.png",
    "url": "http://localhost:3000/upload/image/7jHwuJq.png",
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

**Upload gambar besar** (> 7 MB, dikompresi sampai ≤ 5 MB):

```bash
curl -X POST -F "file=@foto-besar.jpg" http://localhost:3000/upload
```

```json
{
  "success": true,
  "status": 200,
  "message": "Image uploaded successfully",
  "data": {
    "filename": "a8Kx92P.jpg",
    "category": "image",
    "original_filename": "foto-besar.jpg",
    "url": "http://localhost:3000/upload/image/a8Kx92P.jpg",
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

**Upload video** (mp4, tanpa kompresi, maks 50 MB):

```bash
curl -X POST -F "file=@klip.mp4;type=video/mp4" http://localhost:3000/upload
```

```json
{
  "success": true,
  "status": 200,
  "message": "video uploaded successfully",
  "data": {
    "filename": "VkRYJ7Se.mp4",
    "category": "video",
    "original_filename": "klip.mp4",
    "url": "http://localhost:3000/upload/video/VkRYJ7Se.mp4",
    "file_type": "video/mp4",
    "extension": ".mp4",
    "original_size": 199996,
    "original_size_mb": 0.2,
    "final_size": 199996,
    "final_size_mb": 0.2,
    "compressed": false,
    "upload_time": "2026-10-04T10:04:36.617Z"
  }
}
```

**Upload audio** (mp3):

```bash
curl -X POST -F "file=@lagu.mp3;type=audio/mpeg" http://localhost:3000/upload
# -> data.category = "audio", url = http://localhost:3000/upload/audio/<id>.mp3
```

> Kalau browser mengirim MIME generik (`application/octet-stream`) atau kosong,
> kategori ditentukan dari ekstensi file (`.mp3`, `.mp4`, `.jpg`, ...).

**Ambil file:**

```bash
curl -O http://localhost:3000/upload/image/7jHwuJq.png
curl -O http://localhost:3000/upload/video/VkRYJ7Se.mp4
curl -O http://localhost:3000/upload/audio/SrNK6R7y.mp3

# URL lama (tanpa kategori) juga tetap bekerja:
curl -O http://localhost:3000/upload/VkRYJ7Se.mp4
```

**Hapus file:**

```bash
curl -X DELETE http://localhost:3000/upload/video/VkRYJ7Se.mp4
```

```json
{
  "success": true,
  "status": 200,
  "message": "File deleted successfully",
  "data": { "filename": "VkRYJ7Se.mp4", "deleted": true }
}
```

**Health check:**

```bash
curl http://localhost:3000/health
```

Contoh lengkap dengan header:

```bash
curl -X POST http://localhost:3000/upload \
  -H "Accept: application/json" \
  -F "file=@./klip.mp4;type=video/mp4"
```

---

## Response error

Semua error memakai bentuk yang sama:

```json
{ "success": false, "status": 400, "message": "No file uploaded" }
```

| Status | Message | Penyebab |
|--------|---------|----------|
| `400` | `No file uploaded` | Tidak ada file pada request |
| `400` | `Unsupported image format. Allowed: JPG, PNG, WEBP, GIF` | File gambar bukan gambar asli (signature tidak cocok) |
| `400` | `Unsupported file format. Allowed: ...` | Ekstensi/MIME tidak ada di daftar format yang diizinkan |
| `400` | `File content does not match the ".wav" extension` | Signature media tidak cocok dengan ekstensi (mis. RIFF AVInamed `.wav`) |
| `400` | `Unexpected file field "image". Use the "file" field` | Nama field multipart salah |
| `400` | `Invalid filename` | Nama file pada URL tidak valid |
| `413` | `File is too large. Maximum size for image is 20 MB` | Gambar melebihi batas |
| `413` | `File is too large. Maximum size for video is 50 MB` | Video/audio melebihi batas |
| `404` | `File not found` | File tidak ada / sudah dihapus |
| `404` | `Endpoint not found: GET /tidak-ada` | Route tidak terdaftar |
| `500` | `Failed to compress image` | Sharp gagal memproses gambar |
| `500` | `Failed to store file` | Gagal menulis ke storage |
| `500` | `Internal server error` | Error tak terduga (detail tidak pernah dibocorkan) |

---

## Frontend (web playground)

Buka **http://localhost:3000/app** — HTML/CSS/JS murni, tanpa framework dan tanpa build step
(`public/index.html`, `public/style.css`, `public/app.js`).

Fitur UI:

- **Drag & drop**, **klik untuk memilih** (multi-file), dan **paste dari clipboard** (`Ctrl+V`).
- Menerima **gambar, video, dan audio** sekaligus; validasi ukuran memakai batas per kategori.
- **Progress bar** per file memakai `XMLHttpRequest.upload` (upload progress nyata).
- **Filter kategori** di galeri: Semua / Gambar / Video / Audio.
- **Pemutar video** (`<video controls>`) dan **pemutar audio** (`<audio controls>`) untuk file media,
  **lightbox** untuk gambar ukuran penuh (`Esc` untuk menutup).
- Badge kategori (IMAGE/VIDEO/AUDIO) + badge `COMPRESSED −xx%` bila gambar dikompresi.
- Aksi per kartu: **Buka**, **Salin URL**, **Hapus** (`DELETE /upload/:category/:filename`), plus **Hapus semua**.
- **Health badge** dan info kategori (folder tujuan, batas ukuran, status kompresi) diambil dari `GET /`.
- Menampilkan **JSON response terakhir** apa adanya, lengkap dengan tombol salin.
- Toast notifikasi untuk sukses/gagal.

Kalau frontend di-host terpisah, arahkan API lewat query string:

```
http://localhost:3000/app?api=https://api.domain.com
```

> `GET /` tetap mengembalikan JSON informasi API (sesuai spesifikasi). Untuk pengguna browser,
> buka `/app`.

---

## Cara kerja kompresi (khusus gambar)

1. Kategori **bukan image** (video/audio) → file **disimpan apa adanya**, tanpa re-encode.
2. Gambar ≤ **7 MB** → disimpan apa adanya (kualitas 100% terjaga).
3. Gambar > **7 MB** → `sharp` berjalan bertahap:
   - JPEG: kualitas 88 → 82 → 76 → 70 → 64 → 58 → 50 → 42
   - WEBP: kualitas 88 → 82 → 76 → 70 → 64 → 58 → 50 → 42
   - PNG: deflate lossless maksimum → kuantisasi `palette` (92 → 85 → 78 → 70 → 60 → 50)
   - GIF: re-encode `effort: 10` (animasi tetap dipertahankan)
4. Langkah pertama yang menghasilkan **≤ 5 MB** langsung dipakai → **tidak ada kompresi berulang yang tidak perlu**.
5. Bila kualitas terendah masih > 5 MB, gambar diperkecil bertahap (90% → 30%) sampai target tercapai.
6. **Format tidak pernah diubah** (JPG tetap JPG, GIF tetap GIF, animasi tetap animasi).
7. Bila hasil kompresi justru lebih besar dari file asli, file asli dipakai kembali.

---

## Keamanan

- **MIME type dari client tidak dipercaya**:
  - Gambar ditentukan dari *magic bytes* (`FF D8 FF`, `89 50 4E 47…`, `RIFF….WEBP`, `GIF8[79]a`).
  - Media diperiksa lewat *signature container* (`ftyp` untuk MP4/MOV/M4A, EBML untuk MKV/WEBM,
    `RIFF`+`WAVE`/`AVI `, `OggS`, `fLaC`, `ID3`/frame sync MPEG, ADTS AAC).
- File yang lolos filter tetapi gagal validasi signature langsung **dihapus** dari disk.
- Nama file penyimpanan = **random ID + ekstensi hasil deteksi** (`fs.open(..., 'wx')` → anti bentrok
  even under concurrent uploads).
- **Sanitasi nama file** asli (dipakai hanya untuk log/display, bukan path).
- **Anti path traversal**: hanya pola `<id>.<ekstensi-valid>` yang diterima, tanpa `/`, `\`, atau `..`,
  plus cek `path.resolve` tetap berada di dalam `upload/`.
- Batas ukuran **per kategori** (gambar 20 MB, media 50 MB), jumlah file/field dibatasi.
- **CORS** diaktifkan, `X-Content-Type-Options: nosniff`.
- Pesan error tidak pernah memuat stack trace, path absolut, atau pesan internal.
- File dilayani dengan header nama unik → `Cache-Control: immutable`.
- Temp file (`.tmp-*`) tidak bisa diakses (`express.static` mengabaikan dotfile) dan file temp
  yatim dibersihkan otomatis saat server start.

---

## Log

```text
2026-10-05T11:19:58.344Z [INFO] Upload API running at http://localhost:3000
2026-10-05T11:19:58.355Z [INFO] Web playground     http://localhost:3000/app
2026-10-05T11:19:58.356Z [INFO] Storage folders ready: image/, video/, audio/ (in /.../upload)
2026-10-05T11:19:58.357Z [INFO] Limits: image 20 MB (compress > 7 MB -> <= 5 MB) | video & audio 50 MB (no compression)
2026-10-05T11:23:25.401Z [INFO] Upload success {"category":"audio","filename":"SrNK6R7y.mp3","size_mb":0.1,"compressed":false,"duration_ms":38}
2026-10-05T11:23:31.882Z [INFO] File deleted {"filename":"SrNK6R7y.mp3"}
```

---

## Catatan

- Tanpa database — file langsung disimpan di `upload/<kategori>/`.
- Nama file asli **tidak pernah** dipakai di disk, jadi tidak ada masalah karakter aneh maupun tabrakan nama.
- Ingin ganti lokasi file: set `UPLOAD_DIR=/var/www/gambar` di `.env`.
- Behind reverse proxy (Nginx/PM2)? `trust proxy` sudah aktif dan `BASE_URL` bisa diarahkan ke domain publik.