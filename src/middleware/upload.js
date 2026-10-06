'use strict';

/**
 * Upload middleware.
 *
 * Flow:
 *   1. multer.diskStorage -> tulis ke folder kategori sebagai file ".tmp-<id>"
 *   2. requireFile        -> tolak request tanpa file
 *   3. verifyImageSignature-> gambar: magic bytes (MIME client tidak dipercaya)
 *   4. enforceCategoryLimit -> batas ukuran per kategori (gambar 20 MB, media 50 MB)
 *   5. mapMulterError     -> ubah error multer menjadi JSON kita
 *
 * Video & audio: TIDAK dikompresi, hanya divalidasi lewat kategori + ekstensi
 * yang diizinkan (+ signature ringan bila formatnya umum).
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const multer = require('multer');

const {
  CATEGORIES,
  MAX_MEDIA_FILE_SIZE_MB,
  TEMP_PREFIX,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  EXTENSION_INDEX,
} = require('../config');
const { generateId, categoryDir, resolveCategory } = require('../utils/fileName');
const logger = require('../utils/logger');

/** Field name expected in the multipart/form-data request. */
const FILE_FIELD = 'file';

/**
 * Signature gambar (magic bytes) - sumber kebenaran, MIME client tidak dipercaya.
 */
const IMAGE_SIGNATURES = [
  {
    mime: 'image/jpeg',
    format: 'jpeg',
    test: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    mime: 'image/png',
    format: 'png',
    test: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    format: 'webp',
    test: (buf) =>
      buf.length >= 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    mime: 'image/gif',
    format: 'gif',
    test: (buf) => buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.toString('ascii', 0, 6)),
  },
];

/**
 * Signature media (container, bukan codec di dalamnya).
 * Dipakai sebagai pemeriksa tambahan: kalau signature terdeteksi tapifamili
 * kategori tidak cocok -> tolak. Kalau tidak ada signature yang cocok, file
 * tetap diterima (bergantung pada daftar ekstensi yang diizinkan).
 */
const MEDIA_SIGNATURES = [
  // ISO-BMFF: mp4, m4v, mov, m4a, 3gp
  { family: 'iso', test: (buf) => buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' },
  // Matroska / WebM
  { family: 'matroska', test: (buf) => buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3 },
  // RIFF: wav (audio) & avi (video)
  { family: 'riff', test: (buf) => buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' },
  // Ogg ( Vorbis/Opus video)
  { family: 'ogg', test: (buf) => buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS' },
  // FLAC
  { family: 'flac', test: (buf) => buf.length >= 4 && buf.toString('ascii', 0, 4) === 'fLaC' },
  // ADTS AAC frame sync.
  // PENTING: harus dicek SEBELUM mpeg-audio, karena sync byte AAC (0xFF 0xF1/0xF9)
  // juga memenuhi test MPEG (0xFF & 0xE0 === 0xE0).
  { family: 'aac', test: (buf) => buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0 },
  // ID3 tag / MPEG audio frame sync
  {
    family: 'mpeg-audio',
    test: (buf) =>
      buf.length >= 3 &&
      (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)),
  },
];

/**
 * Signature mana yang cocok untuk extension ini (bila ada).
 * Dipakai agar .mp3 tidak bisa dipalsukan jadi .mp4, dll.
 */
const EXTENSION_SIGNATURE = {
  '.mp4': 'iso',
  '.m4v': 'iso',
  '.mov': 'iso',
  '.m4a': 'iso',
  '.3gp': 'iso',
  '.3g2': 'iso',
  '.webm': 'matroska',
  '.mkv': 'matroska',
  '.avi': 'riff',
  '.wav': 'riff',
  '.ogg': 'ogg',
  '.oga': 'ogg',
  '.ogv': 'ogg',
  '.flac': 'flac',
  '.mp3': 'mpeg-audio',
  '.aac': 'aac',
};

/** MIME types yang sering dikirim browser tapi tidak resmi (dipetakan manual). */
const MIME_ALIASES = Object.freeze({
  'video/quicktime': 'video/quicktime',
  'audio/mp3': 'audio/mpeg',
  'audio/mpeg3': 'audio/mpeg',
  'audio/x-mpeg': 'audio/mpeg',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-flac': 'audio/flac',
});

/**
 * Files land in <upload>/<category>/ as ".tmp-<id>" so the original name is never
 * used and partial uploads can never be served (express.static ignores dotfiles).
 */
const storage = multer.diskStorage({
  destination(req, file, cb) {
    // Kategori ditentukan dari MIME/ekstensi yang diklaim client (dicek ulang
    // setelah file selesai ditulis oleh verifyFileSignature / verifyMediaSignature).
    const resolved = resolveCategory(file.mimetype, file.originalname);
    const category = resolved ? resolved.category : 'image';
    try {
      cb(null, categoryDir(category));
    } catch (error) {
      cb(error);
    }
  },
  filename(req, file, cb) {
    cb(null, `${TEMP_PREFIX}${generateId()}`);
  },
});

/**
 * Cheap pre-filter supaya file yang jelas-jelas salah tidak menyentuh disk.
 * (Keputusan sebenarnya ada di verifyFileSignature / verifyMediaSignature.)
 */
function fileFilter(req, file, cb) {
  const clientMime = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
  const alias = MIME_ALIASES[clientMime];
  const effectiveMime = alias || clientMime;
  const ext = path.extname(file.originalname || '').toLowerCase();

  const mimeLooksValid = ALLOWED_MIME_TYPES.includes(effectiveMime);
  const extLooksValid = Boolean(EXTENSION_INDEX[ext]);

  if (!mimeLooksValid && !extLooksValid) {
    const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE', FILE_FIELD);
    error.reason = 'UNSUPPORTED_FILE_TYPE';
    return cb(error);
  }
  return cb(null, true);
}

const uploadSingleFile = multer({
  storage,
  fileFilter,
  limits: {
    // Batas terbalik (50 MB). Batas per kategori ditegakkan di enforceCategoryLimit
    // supaya pesan error spesifik: "Maximum size is 20 MB" untuk gambar.
    fileSize: MAX_MEDIA_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
    fields: 10,
    parts: 12,
  },
}).single(FILE_FIELD);

/** Build a consistent error response body. */
function fail(res, status, message, extra = {}) {
  return res.status(status).json({ success: false, status, message, ...extra });
}

/** Best-effort cleanup of a temp file that must not stay on disk. */
async function discard(file) {
  if (!file || !file.path) return;
  try {
    await fs.unlink(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('Failed to remove temp file', error);
  }
}

/** Baca byte pertama file (16 byte cukup untuk semua signature di atas). */
async function readHead(filePath, length = 16) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** 1. There must be a file at all. */
function requireFile(req, res, next) {
  if (!req.file) {
    logger.warn('Upload rejected: no file received');
    return fail(res, 400, 'No file uploaded', { field: FILE_FIELD });
  }
  return next();
}

/**
 * 2. Verifikasi kategori + signature.
 *    - image: signature WAJIB cocok (MIME client tidak dipercaya)
 *    - video/audio: signature ringan, hanya menolak kalau terdeteksi jelas keluarga lain
 */
async function verifyFileSignature(req, res, next) {
  const { file } = req;

  try {
    const buffer = await readHead(file.path);
    const resolved = resolveCategory(file.mimetype, file.originalname);

    if (!resolved) {
      await discard(file);
      logger.warn('Upload rejected: unsupported file type', {
        filename: file.originalname,
        claimed_mimetype: file.mimetype,
      });
      return fail(res, 400, `Unsupported file format. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
    }

    req.detectedFile = { category: resolved.category, mime: resolved.mime, type: resolved.type };

    /* ------------------------------------------------------------- image -- */
    if (resolved.category === 'image') {
      const signature = IMAGE_SIGNATURES.find((candidate) => candidate.test(buffer));

      if (!signature) {
        await discard(file);
        logger.warn('Upload rejected: unsupported or fake image signature', {
          claimed_mimetype: file.mimetype,
          size_bytes: file.size,
        });
        return fail(res, 400, 'Unsupported image format. Allowed: JPG, PNG, WEBP, GIF');
      }

      const clientMime = String(file.mimetype || '').toLowerCase();
      if (ALLOWED_MIME_TYPES.includes(clientMime) && clientMime !== signature.mime) {
        logger.warn('Client MIME type did not match file content', {
          claimed: clientMime,
          detected: signature.mime,
        });
      }

      // Konten yang menang atas klaim client: tipe ikut terdeteksi.
      const detected = resolveCategory(signature.mime);
      req.detectedFile = {
        category: 'image',
        mime: signature.mime,
        type: detected ? detected.type : resolved.type,
      };
      return next();
    }

    /* ------------------------------------------------------ video / audio -- */
    const extension = path.extname(file.originalname || '').toLowerCase();
    const expectedFamily = EXTENSION_SIGNATURE[extension];
    const detectedFamily = MEDIA_SIGNATURES.find((candidate) => candidate.test(buffer))?.family;

    if (expectedFamily && detectedFamily && expectedFamily !== detectedFamily) {
      await discard(file);
      logger.warn('Upload rejected: media signature does not match extension', {
        extension,
        expected: expectedFamily,
        detected: detectedFamily,
      });
      return fail(res, 400, `File content does not match the "${extension}" extension`);
    }

    // "iso" dipakai bersama mp4/mov/m4a/3gp -> tidak bisa membedakan, diterima.
    if (expectedFamily === 'riff' && detectedFamily === 'riff') {
      const brand = buffer.toString('ascii', 8, 12);
      const wantBrand = extension === '.avi' ? 'AVI ' : 'WAVE';
      if (brand !== wantBrand) {
        await discard(file);
        logger.warn('Upload rejected: RIFF container type mismatch', { extension, brand });
        return fail(res, 400, `File content does not match the "${extension}" extension`);
      }
    }

    if (!detectedFamily) {
      // Signature tidak dikenal (container jarang / tidak standardized) -> cukup
      // andalkan allowlist ekstensi, tetap dicatat di log.
      logger.debug('Media signature not recognised, trusting allowed extension', { extension });
    }

    return next();
  } catch (error) {
    await discard(file);
    logger.error('Failed to inspect uploaded file', error);
    return fail(res, 500, 'Failed to process the uploaded file');
  }
}

/** 3. Batas ukuran per kategori (gambar 20 MB, video/audio 50 MB). */
async function enforceCategoryLimit(req, res, next) {
  const { file } = req;
  const category = CATEGORIES[req.detectedFile.category];

  if (file.size > category.maxSizeBytes) {
    await discard(file);
    logger.warn('Upload rejected: file too large', {
      category: category.name,
      size_mb: Math.round((file.size / 1048576) * 100) / 100,
      limit_mb: category.maxSizeMb,
    });
    return fail(res, 413, `File is too large. Maximum size for ${category.name} is ${category.maxSizeMb} MB`);
  }

  return next();
}

/** 4. Translate multer/stream errors into our JSON contract. */
function mapMulterError(error, req, res, next) {
  if (error instanceof multer.MulterError) {
    if (error.reason === 'UNSUPPORTED_FILE_TYPE') {
      logger.warn('Upload rejected: unsupported file type', { field: error.field });
      return fail(res, 400, `Unsupported file format. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
    }

    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        logger.warn('Upload rejected: file too large', { limit_mb: MAX_MEDIA_FILE_SIZE_MB, field: error.field });
        return fail(res, 413, `File is too large. Maximum size is ${MAX_MEDIA_FILE_SIZE_MB} MB`);
      case 'LIMIT_UNEXPECTED_FILE':
        logger.warn('Upload rejected: unexpected field', { field: error.field });
        return fail(res, 400, `Unexpected file field "${error.field}". Use the "${FILE_FIELD}" field`);
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_PART_COUNT':
      case 'LIMIT_FIELD_COUNT':
        logger.warn('Upload rejected: too many parts', { code: error.code });
        return fail(res, 400, 'Too many upload fields or files');
      default:
        logger.warn('Upload rejected by multer', { code: error.code, message: error.message });
        return fail(res, 400, 'Invalid upload request');
    }
  }
  return next(error);
}

module.exports = {
  FILE_FIELD,
  IMAGE_SIGNATURES,
  MEDIA_SIGNATURES,
  uploadSingleFile,
  requireFile,
  verifyFileSignature,
  enforceCategoryLimit,
  mapMulterError,
  discard,
  fail,
};