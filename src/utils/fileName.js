'use strict';

/**
 * Filename helpers.
 *
 * Storage filenames are NEVER the original name. They are a short, URL-safe,
 * cryptographically random id (e.g. "7jHwuJq") plus the real extension we
 * detected ourselves (from the file signature for images, from the allowed
 * extension list for video/audio).
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { CATEGORIES, CATEGORY_NAMES, TYPE_INDEX, EXTENSION_INDEX, UPLOAD_ROOT } = require('../config');

/** Length of the generated id. 8 chars from a 64-char alphabet = 48 bits entropy. */
const ID_LENGTH = 8;

/** Characters allowed in a generated id (base64url alphabet). */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Generate a cryptographically random id.
 * @param {number} [length=ID_LENGTH]
 * @returns {string}
 */
function generateId(length = ID_LENGTH) {
  // base64url => [A-Za-z0-9_-] only, no padding, no '+' or '/'.
  // ceil(length * 3 / 4) random bytes always yield >= length characters.
  const bytes = crypto.randomBytes(Math.ceil((length * 3) / 4));
  return bytes.toString('base64url').slice(0, length);
}

/** Absolute directory of a category ("image" | "video" | "audio"). */
function categoryDir(category) {
  const entry = CATEGORIES[category];
  if (!entry) throw new Error(`Unknown category: ${category}`);
  return path.join(UPLOAD_ROOT, entry.folder);
}

/**
 * Decide which category a file belongs to.
 *
 * Priority:
 *  1. MIME type yang diklaim client (kalau dikenal)
 *  2. Ekstensi file (kalau MIME tidak dikenal / octet-stream)
 *
 * @param {string} mime client MIME type
 * @param {string} [originalName]
 * @returns {{ category: string, mime: string, type: object } | null} null kalau tidak didukung
 */
function resolveCategory(mime, originalName) {
  const normalizedMime = String(mime || '').toLowerCase().split(';')[0].trim();
  const extension = path.extname(originalName || '').toLowerCase();

  const byMime = TYPE_INDEX[normalizedMime];
  const byExtension = EXTENSION_INDEX[extension];

  if (byMime && (!byExtension || byExtension.some((e) => e.mime === byMime.mime))) {
    return { category: byMime.category, mime: byMime.mime, type: byMime };
  }
  if (byExtension && byExtension.length) {
    // Client mengirim MIME generik (mis. application/octet-stream) -> pakai ekstensi.
    const [first] = byExtension;
    return { category: first.category, mime: first.mime, type: TYPE_INDEX[first.mime] };
  }
  return null;
}

/**
 * Pick the extension to store with.
 * @param {string} detectedMime
 * @param {string} [originalName]
 * @returns {string} e.g. ".png"
 */
function pickExtension(detectedMime, originalName) {
  const type = TYPE_INDEX[detectedMime];
  if (!type) return '.bin';

  const fromName = path.extname(originalName || '').toLowerCase();
  if (fromName && type.extensions.includes(fromName)) {
    return fromName === '.jpeg' ? '.jpg' : fromName;
  }
  return type.canonicalExtension;
}

/**
 * Atomically reserve a unique, non-existing path inside `dir`.
 * Uses fs.open(..., 'wx') so two concurrent uploads can never win the same name.
 *
 * @param {string} dir absolute directory
 * @param {string} extension including the dot, e.g. ".png"
 * @param {{ maxAttempts?: number }} [options]
 * @returns {Promise<{ path: string, filename: string, id: string }>}
 */
async function reserveUniquePath(dir, extension, options = {}) {
  const maxAttempts = options.maxAttempts ?? 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const id = generateId();
    const filename = `${id}${extension}`;
    const candidate = path.join(dir, filename);

    try {
      // 'wx' => fail if the path already exists (atomic create-if-not-exists).
      const handle = await fs.open(candidate, 'wx');
      await handle.close();
      return { path: candidate, filename, id };
    } catch (error) {
      if (error.code === 'EEXIST') continue; // insanely unlikely, just try again
      throw error;
    }
  }

  throw new Error('Failed to generate a unique filename');
}

/**
 * Sanitize a client supplied filename.
 * Used for logging / echoing only - never for building a storage path.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeOriginalFilename(name) {
  if (typeof name !== 'string' || name.length === 0) return 'unknown';

  // Strip directories + traversal sequences, keep the basename only.
  const base = path.basename(name.replace(/\\/g, '/'));
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);

  return cleaned || 'unknown';
}

/**
 * Whitelist check for a filename coming from a URL (GET/DELETE /upload/...).
 * Only ids produced by this app pass: <id><allowed-ext>, no slashes, no dots.
 *
 * @param {string} filename
 * @returns {boolean}
 */
function isSafeFilename(filename) {
  if (typeof filename !== 'string' || filename.length === 0) return false;
  if (filename.includes('/') || filename.includes('\\') || filename.includes('\0')) return false;
  if (filename.includes('..')) return false;

  const extension = path.extname(filename).toLowerCase();
  const id = filename.slice(0, filename.length - extension.length);

  return Boolean(EXTENSION_INDEX[extension]) && SAFE_ID.test(id) && id.length <= 64;
}

/**
 * Find the category a stored filename belongs to (dipakai untuk URL lama
 * tanpa kategori, mis. GET /upload/abc123.mp4).
 *
 * @param {string} filename
 * @returns {string | null} nama kategori
 */
function categoryForFilename(filename) {
  if (!isSafeFilename(filename)) return null;
  const extension = path.extname(filename).toLowerCase();
  const candidates = EXTENSION_INDEX[extension];
  if (!candidates || !candidates.length) return null;
  // .wav/.ogg bisa belong ke satu kategori saja di tabel kita -> unik.
  return candidates[0].category;
}

/** Semua kategori yang perlu dicek saat mencari file tanpa kategori di URL. */
function allCategoryDirs() {
  return CATEGORY_NAMES.map((name) => ({ name, dir: categoryDir(name) }));
}

module.exports = {
  ID_LENGTH,
  generateId,
  categoryDir,
  resolveCategory,
  pickExtension,
  reserveUniquePath,
  sanitizeOriginalFilename,
  isSafeFilename,
  categoryForFilename,
  allCategoryDirs,
};