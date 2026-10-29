'use strict';

/**
 * Upload routes (mounted at /upload):
 *   POST   /upload                     -> upload satu file (gambar / video / audio)
 *   GET    /upload/:category/:filename -> ambil file
 *   DELETE /upload/:category/:filename -> hapus file
 *   GET    /upload/:filename           -> ambil file (URL lama, cari semua kategori)
 *   DELETE /upload/:filename           -> hapus file (URL lama, cari semua kategori)
 *
 * Penyimpanan:
 *   upload/image/<id>.jpg   -> dikompresi otomatis bila > 7 MB
 *   upload/video/<id>.mp4   -> tanpa kompresi, maks 50 MB
 *   upload/audio/<id>.mp3   -> tanpa kompresi, maks 50 MB
 */

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const express = require('express');

const {
  UPLOAD_ROOT,
  UPLOAD_ROUTE,
  BASE_URL,
  CATEGORIES,
  EXTENSION_INDEX,
} = require('../config');
const {
  uploadSingleFile,
  requireFile,
  verifyFileSignature,
  enforceCategoryLimit,
  discard,
  fail,
} = require('../middleware/upload');
const {
  categoryDir,
  reserveUniquePath,
  pickExtension,
  sanitizeOriginalFilename,
  isSafeFilename,
  categoryForFilename,
  allCategoryDirs,
} = require('../utils/fileName');
const { shouldCompress, bytesToMb, compressImage } = require('../utils/compress');
const { getStorageStats, formatBytes } = require('../utils/storage');
const logger = require('../utils/logger');

const router = express.Router();

/** MIME untuk header Content-Type saat serve file. */
const EXTENSION_TO_MIME = new Map(
  Object.entries(EXTENSION_INDEX).map(([extension, entries]) => [extension, entries[0].mime]),
);

/**
 * Resolve (category, filename) dari parameter URL menjadi path absolut yang
 * dijamin berada di dalam folder upload. Return null kalau tidak valid.
 *
 * @param {string} category
 * @param {string} filename
 * @returns {{ filePath: string, category: string, filename: string } | null}
 */
function resolveStoredPath(category, filename) {
  if (!CATEGORIES[category] || !isSafeFilename(filename)) return null;

  const root = path.resolve(UPLOAD_ROOT);
  const filePath = path.resolve(path.join(categoryDir(category), filename));
  // Defence in depth terhadap path traversal.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null;

  return { filePath, category, filename };
}

/**
 * Untuk URL lama tanpa kategori (/upload/abc123.mp4) -> cari di semua folder kategori.
 * @returns {Promise<{ filePath: string, category: string, filename: string } | null>}
 */
async function findStoredPath(filename) {
  if (!isSafeFilename(filename)) return null;

  const direct = resolveStoredPath(categoryForFilename(filename), filename);
  if (direct) {
    try {
      await fsPromises.access(direct.filePath, fs.constants.F_OK);
      return direct;
    } catch {
      /* lanjut cek kategori lain */
    }
  }

  for (const { name, dir } of allCategoryDirs()) {
    const candidate = path.resolve(path.join(dir, filename));
    if (!candidate.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await fsPromises.access(candidate, fs.constants.F_OK);
      return { filePath: candidate, category: name, filename };
    } catch {
      /* next */
    }
  }
  return null;
}

/** Stream file ke response dengan header yang benar. */
async function sendStoredFile(res, filePath, filename, method = 'GET') {
  const stats = await fsPromises.stat(filePath);
  if (!stats.isFile()) return fail(res, 404, 'File not found');

  const extension = path.extname(filename).toLowerCase();
  res.setHeader('Content-Type', EXTENSION_TO_MIME.get(extension) || 'application/octet-stream');
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // nama file unik
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${method === 'GET' ? 'inline' : 'attachment'}; filename="${filename}"`);

  if (method === 'HEAD') return res.status(200).end();

  res.status(200);
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    logger.error('Error while streaming a stored file', filename);
    if (!res.headersSent) res.status(500);
    res.end();
  });
  return stream.pipe(res);
}

/** Hapus file di path tertentu. */
async function removeStoredFile(res, filePath, filename) {
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('Delete target not found', { filename });
      return fail(res, 404, 'File not found');
    }
    logger.error('Failed to delete a stored file', error);
    return fail(res, 500, 'Failed to delete file');
  }

  logger.info('File deleted', { filename });
  return res.status(200).json({
    success: true,
    status: 200,
    message: 'File deleted successfully',
    data: { filename, deleted: true },
  });
}

/**
 * GET /upload/stats
 * Total ukuran seluruh file di folder upload, dikelompokkan per kategori.
 *
 * PENTING: route ini harus terdaftar SEBELUM "/:filename" dan
 * "/:category/:filename", kalau tidak akan tertangkap sebagai filename.
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getStorageStats();

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Storage statistics retrieved successfully',
      data: {
        total_size: stats.total.readable,
        total_size_bytes: stats.total.bytes,
        total_size_mb: stats.total.mb,
        total_size_gb: stats.total.gb,
        total_files: stats.total.files,
        folder: stats.folder,
        categories: stats.categories.map((category) => ({
          name: category.name,
          folder: category.folder,
          files: category.files,
          size: category.readable,
          size_bytes: category.bytes,
          size_mb: category.mb,
          size_gb: category.gb,
        })),
        disk: stats.disk
          ? {
              total: stats.disk.readable,
              total_bytes: stats.disk.bytes,
              free: formatBytes(stats.disk.free_bytes),
              free_bytes: stats.disk.free_bytes,
              used_bytes: stats.disk.used_bytes,
              used_percent: stats.disk.used_percent,
            }
          : null,
        skipped_temp_files: stats.skipped_temp_files,
        computed_at: stats.computed_at,
      },
    });
  } catch (error) {
    logger.error('Failed to compute storage statistics', error);
    return fail(res, 500, 'Failed to retrieve storage statistics');
  }
});

/**
 * POST /upload
 * multipart/form-data, field name: "file"
 * Gambar > 7 MB dikompresi; video & audio disimpan apa adanya.
 */
router.post(
  '/',
  uploadSingleFile,
  requireFile,
  verifyFileSignature,
  enforceCategoryLimit,
  async (req, res) => {
    const file = req.file;
    const startedAt = Date.now();
    const uploadTime = new Date().toISOString();
    const originalFilename = sanitizeOriginalFilename(file.originalname);
    const originalSize = file.size;
    const detected = req.detectedFile;
    const category = CATEGORIES[detected.category];
    const extension = pickExtension(detected.mime, file.originalname);

    let reserved;
    try {
      // Random id + ekstensi, dipisah secara atomik (tidak ada bentrok).
      reserved = await reserveUniquePath(categoryDir(detected.category), extension);
    } catch (error) {
      await discard(file);
      logger.error('Failed to reserve a storage filename', error);
      return fail(res, 500, 'Failed to store file');
    }

    try {
      let finalSize = originalSize;
      let compressed = false;

      if (category.compress && shouldCompress(originalSize)) {
        // Hanya gambar, dan hanya > 7 MB.
        try {
          const result = await compressImage({
            inputPath: file.path,
            outputPath: reserved.path,
            format: detected.type.format,
            originalSize,
          });

          if (result.size < originalSize) {
            finalSize = result.size;
            compressed = true;
            await discard(file); // file asli tidak dibutuhkan lagi
          } else {
            // Sharp justru memperbesar file -> pakai file asli.
            await fsPromises.rm(reserved.path, { force: true });
            await fsPromises.rename(file.path, reserved.path);
          }
        } catch (compressionError) {
          await discard(file);
          await fsPromises.rm(reserved.path, { force: true });
          logger.error('Image compression failed', compressionError);
          return fail(res, 500, 'Failed to compress image');
        }
      } else {
        // <= 7 MB, video, atau audio -> tanpa re-encode sama sekali.
        await fsPromises.rename(file.path, reserved.path);
      }

      const payload = {
        success: true,
        status: 200,
        message: category.compress ? 'Image uploaded successfully' : `${category.name} uploaded successfully`,
        data: {
          filename: reserved.filename,
          category: category.name,
          original_filename: originalFilename,
          url: `${BASE_URL}${UPLOAD_ROUTE}/${category.name}/${reserved.filename}`,
          file_type: detected.mime,
          extension,
          original_size: originalSize,
          original_size_mb: bytesToMb(originalSize),
          final_size: finalSize,
          final_size_mb: bytesToMb(finalSize),
          compressed,
          upload_time: uploadTime,
        },
      };

      logger.info('Upload success', {
        category: category.name,
        filename: reserved.filename,
        original_filename: originalFilename,
        size_mb: bytesToMb(finalSize),
        compressed,
        duration_ms: Date.now() - startedAt,
      });

      return res.status(200).json(payload);
    } catch (error) {
      // Apapun yang tidak terduga: jangan sisakan file separuh jadi.
      await discard(file);
      await fsPromises.rm(reserved.path, { force: true });
      logger.error('Failed to store the uploaded file', error);
      return fail(res, 500, 'Failed to store file');
    }
  },
);

/* ------------------------------------------------------------ GET / DELETE */

/** GET /upload/:category/:filename */
router.get('/:category/:filename', async (req, res) => {
  const { category, filename } = req.params;
  const target = resolveStoredPath(category, filename);

  if (!target) return fail(res, 400, 'Invalid filename');

  try {
    return await sendStoredFile(res, target.filePath, target.filename);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('File not found', { category, filename });
      return fail(res, 404, 'File not found');
    }
    logger.error('Failed to read a stored file', error);
    return fail(res, 500, 'Failed to retrieve file');
  }
});

/** DELETE /upload/:category/:filename */
router.delete('/:category/:filename', async (req, res) => {
  const { category, filename } = req.params;
  const target = resolveStoredPath(category, filename);

  if (!target) return fail(res, 400, 'Invalid filename');

  return removeStoredFile(res, target.filePath, target.filename);
});

/** GET /upload/:filename (tanpa kategori, tetap kompatibel dengan URL lama) */
router.get('/:filename', async (req, res) => {
  const { filename } = req.params;
  const target = await findStoredPath(filename);

  if (!target) {
    if (!isSafeFilename(filename)) return fail(res, 400, 'Invalid filename');
    return fail(res, 404, 'File not found');
  }

  try {
    return await sendStoredFile(res, target.filePath, target.filename);
  } catch (error) {
    if (error.code === 'ENOENT') return fail(res, 404, 'File not found');
    logger.error('Failed to read a stored file', error);
    return fail(res, 500, 'Failed to retrieve file');
  }
});

/** DELETE /upload/:filename (tanpa kategori) */
router.delete('/:filename', async (req, res) => {
  const { filename } = req.params;
  const target = await findStoredPath(filename);

  if (!target) {
    if (!isSafeFilename(filename)) return fail(res, 400, 'Invalid filename');
    return fail(res, 404, 'File not found');
  }

  return removeStoredFile(res, target.filePath, target.filename);
});

module.exports = router;