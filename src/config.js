'use strict';

/**
 * Central configuration.
 * Loads .env once and exposes typed/normalized values to the rest of the app.
 *
 * Upload dibagi 3 kategori (folder terpisah):
 *   upload/image  -> gambar  (kompresi otomatis, maks 20 MB)
 *   upload/video  -> video   (tanpa kompresi, maks 50 MB)
 *   upload/audio  -> audio   (tanpa kompresi, maks 50 MB)
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const MB = 1024 * 1024;

const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = toPositiveInt(process.env.PORT, 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const MAX_FILE_SIZE_MB = toPositiveInt(process.env.MAX_FILE_SIZE_MB, 20);
const MAX_MEDIA_FILE_SIZE_MB = toPositiveInt(process.env.MAX_MEDIA_FILE_SIZE_MB, 50);

/** Root folder penyimpanan semua upload (otomatis dibuat + subfoldernya). */
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT_DIR, 'upload'));

/** Public mount point of the upload folder: http://host:port/upload/<category>/<file> */
const UPLOAD_ROUTE = '/upload';

/** Temporary file prefix used while a file is being validated. */
const TEMP_PREFIX = '.tmp-';

/** Only compress images bigger than 7 MB. */
const COMPRESS_THRESHOLD_BYTES = 7 * MB;

/** After compression an image must be <= 5 MB. */
const TARGET_SIZE_BYTES = 5 * MB;

/**
 * Semua tipe file yang diizinkan, dikelompokkan per kategori.
 * `format` = nama format sharp (khusus kategori image, untuk re-encode).
 */
const CATEGORIES = Object.freeze({
  image: Object.freeze({
    name: 'image',
    folder: 'image',
    compress: true,
    maxSizeMb: MAX_FILE_SIZE_MB,
    maxSizeBytes: MAX_FILE_SIZE_MB * MB,
    types: Object.freeze({
      'image/jpeg': { format: 'jpeg', extensions: ['.jpg', '.jpeg'], canonicalExtension: '.jpg' },
      'image/png': { format: 'png', extensions: ['.png'], canonicalExtension: '.png' },
      'image/webp': { format: 'webp', extensions: ['.webp'], canonicalExtension: '.webp' },
      'image/gif': { format: 'gif', extensions: ['.gif'], canonicalExtension: '.gif' },
    }),
  }),
  video: Object.freeze({
    name: 'video',
    folder: 'video',
    compress: false,
    maxSizeMb: MAX_MEDIA_FILE_SIZE_MB,
    maxSizeBytes: MAX_MEDIA_FILE_SIZE_MB * MB,
    types: Object.freeze({
      'video/mp4': { format: 'mp4', extensions: ['.mp4', '.m4v'], canonicalExtension: '.mp4' },
      'video/webm': { format: 'webm', extensions: ['.webm'], canonicalExtension: '.webm' },
      'video/quicktime': { format: 'mov', extensions: ['.mov'], canonicalExtension: '.mov' },
      'video/x-msvideo': { format: 'avi', extensions: ['.avi'], canonicalExtension: '.avi' },
      'video/x-matroska': { format: 'mkv', extensions: ['.mkv'], canonicalExtension: '.mkv' },
      'video/ogg': { format: 'ogv', extensions: ['.ogv'], canonicalExtension: '.ogv' },
      'video/3gpp': { format: '3gp', extensions: ['.3gp', '.3g2'], canonicalExtension: '.3gp' },
    }),
  }),
  audio: Object.freeze({
    name: 'audio',
    folder: 'audio',
    compress: false,
    maxSizeMb: MAX_MEDIA_FILE_SIZE_MB,
    maxSizeBytes: MAX_MEDIA_FILE_SIZE_MB * MB,
    types: Object.freeze({
      'audio/mpeg': { format: 'mp3', extensions: ['.mp3'], canonicalExtension: '.mp3' },
      'audio/wav': { format: 'wav', extensions: ['.wav'], canonicalExtension: '.wav' },
      'audio/x-wav': { format: 'wav', extensions: ['.wav'], canonicalExtension: '.wav' },
      'audio/wave': { format: 'wav', extensions: ['.wav'], canonicalExtension: '.wav' },
      'audio/ogg': { format: 'ogg', extensions: ['.ogg', '.oga'], canonicalExtension: '.ogg' },
      'audio/mp4': { format: 'm4a', extensions: ['.m4a'], canonicalExtension: '.m4a' },
      'audio/x-m4a': { format: 'm4a', extensions: ['.m4a'], canonicalExtension: '.m4a' },
      'audio/aac': { format: 'aac', extensions: ['.aac'], canonicalExtension: '.aac' },
      'audio/flac': { format: 'flac', extensions: ['.flac'], canonicalExtension: '.flac' },
    }),
  }),
});

/** Alias lama: khusus gambar. */
const ALLOWED_IMAGE_TYPES = CATEGORIES.image.types;

/** Semua MIME yang diizinkan (semua kategori). */
const ALLOWED_MIME_TYPES = Object.freeze(
  Object.values(CATEGORIES).flatMap((category) => Object.keys(category.types)),
);

/** Semua ekstensi yang diizinkan (semua kategori). */
const ALLOWED_EXTENSIONS = Object.freeze(
  [...new Set(Object.values(CATEGORIES).flatMap((c) => Object.values(c.types).flatMap((t) => t.extensions)))].sort(),
);

/** index MIME -> { category, ...typeInfo } */
const TYPE_INDEX = Object.freeze(
  Object.fromEntries(
    Object.entries(CATEGORIES).flatMap(([categoryName, category]) =>
      Object.entries(category.types).map(([mime, info]) => [
        mime,
        Object.freeze({ mime, category: categoryName, compress: category.compress, ...info }),
      ]),
    ),
  ),
);

/** index ekstensi -> { category, mime, canonicalExtension }[] (bisa >1 untuk .wav/.ogg) */
const EXTENSION_INDEX = Object.freeze(
  ALLOWED_EXTENSIONS.reduce((acc, extension) => {
    acc[extension] = Object.entries(TYPE_INDEX)
      .filter(([, info]) => info.extensions.includes(extension))
      .map(([mime, info]) =>
        Object.freeze({ extension, mime, category: info.category, canonicalExtension: info.canonicalExtension }),
      );
    return acc;
  }, {}),
);

const CATEGORY_NAMES = Object.freeze(Object.keys(CATEGORIES));

/** Create the upload folder and every category subfolder. */
function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  for (const category of Object.values(CATEGORIES)) {
    fs.mkdirSync(path.join(UPLOAD_ROOT, category.folder), { recursive: true });
  }
  return UPLOAD_ROOT;
}

/**
 * Remove leftover ".tmp-*" files from a previous run (process killed mid-upload).
 * They are never served, so it is safe to delete anything older than 1 hour.
 */
function cleanupStaleTempFiles(maxAgeMs = 60 * 60 * 1000) {
  const dirs = [UPLOAD_ROOT, ...Object.values(CATEGORIES).map((c) => path.join(UPLOAD_ROOT, c.folder))];
  const removed = [];
  const threshold = Date.now() - maxAgeMs;

  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(TEMP_PREFIX)) continue;
      try {
        const stats = fs.statSync(path.join(dir, entry.name));
        if (stats.mtimeMs < threshold) {
          fs.unlinkSync(path.join(dir, entry.name));
          removed.push(entry.name);
        }
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  MB,
  ROOT_DIR,
  PORT,
  BASE_URL,
  UPLOAD_ROOT,
  UPLOAD_DIR: UPLOAD_ROOT, // alias
  UPLOAD_ROUTE,
  MAX_FILE_SIZE_MB,
  MAX_MEDIA_FILE_SIZE_MB,
  COMPRESS_THRESHOLD_BYTES,
  TARGET_SIZE_BYTES,
  TEMP_PREFIX,
  CATEGORIES,
  CATEGORY_NAMES,
  TYPE_INDEX,
  EXTENSION_INDEX,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  ensureUploadDir,
  cleanupStaleTempFiles,
};
