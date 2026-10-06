'use strict';

/**
 * File Upload API (image + video + audio)
 * --------------------------------------
 * POST   /upload                       upload file (multipart/form-data, field "file")
 * GET    /upload/:category/:filename   read file
 * DELETE /upload/:category/:filename   delete file
 * GET    /upload/:filename             read file (URL lama tanpa kategori)
 * DELETE /upload/:filename             delete file (URL lama tanpa kategori)
 * GET    /health                       health check
 * GET    /                            api information
 * GET    /app                          web playground (static HTML frontend)
 *
 * Penyimpanan per kategori: upload/image, upload/video, upload/audio
 * Kompresi hanya berlaku untuk gambar (> 7 MB -> diturunkan sampai <= 5 MB).
 */

const path = require('node:path');

const cors = require('cors');
const express = require('express');
require('dotenv').config();

const {
  ROOT_DIR,
  PORT,
  BASE_URL,
  UPLOAD_ROOT,
  UPLOAD_ROUTE,
  MAX_FILE_SIZE_MB,
  MAX_MEDIA_FILE_SIZE_MB,
  COMPRESS_THRESHOLD_BYTES,
  TARGET_SIZE_BYTES,
  CATEGORIES,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  ensureUploadDir,
  cleanupStaleTempFiles,
} = require('./config');
const uploadRoutes = require('./routes/upload');
const { mapMulterError } = require('./middleware/upload');
const { bytesToMb } = require('./utils/compress');
const logger = require('./utils/logger');

const app = express();

/** Static web frontend (public/index.html). */
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const APP_ROUTE = '/app';

// Make sure ./upload always exists before the first request is handled.
ensureUploadDir();

// Drop half-written temp files left behind by a previous crash / restart.
const staleTempFiles = cleanupStaleTempFiles();
if (staleTempFiles.length) {
  logger.warn(`Cleaned ${staleTempFiles.length} stale temp file(s) from ./upload`);
}

app.disable('x-powered-by');
app.set('trust proxy', true);

// --- Security / parsing -----------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// --- GET / ------------------------------------------------------------------
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    status: 200,
    message: 'File Upload API',
    data: {
      name: 'TamaCloud',
      version: '2.0.0',
      stack: 'Node.js + Express + Multer + Sharp',
      max_file_size_mb: MAX_FILE_SIZE_MB,
      max_media_file_size_mb: MAX_MEDIA_FILE_SIZE_MB,
      categories: Object.values(CATEGORIES).map((category) => ({
        name: category.name,
        folder: `${UPLOAD_ROUTE}/${category.folder}`,
        max_size_mb: category.maxSizeMb,
        compression: category.compress
          ? `auto above ${bytesToMb(COMPRESS_THRESHOLD_BYTES)} MB, target ${bytesToMb(TARGET_SIZE_BYTES)} MB`
          : 'disabled',
        formats: [...new Set(Object.values(category.types).flatMap((type) => type.extensions))],
      })),
      allowed_mime_types: ALLOWED_MIME_TYPES,
      allowed_extensions: ALLOWED_EXTENSIONS,
      ui: {
        path: APP_ROUTE,
        url: `${BASE_URL}${APP_ROUTE}`,
        description: 'Web playground (static HTML frontend)',
      },
      endpoints: [
        { method: 'GET', path: '/', description: 'API information' },
        { method: 'GET', path: APP_ROUTE, description: 'Web playground (HTML frontend)' },
        { method: 'GET', path: '/health', description: 'Health check' },
        { method: 'POST', path: '/upload', description: 'Upload a file (field: file)' },
        { method: 'GET', path: '/upload/:category/:filename', description: 'Get an image / video / audio' },
        { method: 'DELETE', path: '/upload/:category/:filename', description: 'Delete an image / video / audio' },
        { method: 'GET', path: '/upload/:filename', description: 'Get a file (legacy URL without category)' },
        { method: 'DELETE', path: '/upload/:filename', description: 'Delete a file (legacy URL without category)' },
      ],
    },
  });
});

// --- GET /health ------------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Upload routes ----------------------------------------------------------
app.use(UPLOAD_ROUTE, uploadRoutes);

// --- Web frontend (static HTML) ---------------------------------------------
// GET /app  ->  the playground page itself (no directory redirect)
app.get([APP_ROUTE, `${APP_ROUTE}/`], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// GET /app/app.js, /app/style.css, ... -> static assets.
// maxAge 0 + ETag: browser selalu revalidasi, jadi perubahan frontend langsung
// terlihat tanpa perlu hard refresh (tidak ada JS lama yang tertahan di cache).
app.use(
  APP_ROUTE,
  express.static(PUBLIC_DIR, {
    index: false,
    dotfiles: 'ignore',
    maxAge: 0,
    etag: true,
    lastModified: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

// --- Static files (./upload/{image,video,audio} are publicly reachable) ------
// URL: http://host:port/upload/<category>/<file>
app.use(
  UPLOAD_ROUTE,
  express.static(UPLOAD_ROOT, {
    index: false,
    dotfiles: 'ignore', // never serve temp files (.tmp-*) or dotfiles
    maxAge: '365d',
    immutable: true,
    fallthrough: true,
  }),
);

// --- 404 --------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    status: 404,
    message: `Endpoint not found: ${req.method} ${req.path}`,
  });
});

// --- Global error handler ---------------------------------------------------
// Keeps internal details (stack traces, paths, messages) out of the response.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ success: false, status: 413, message: 'Request body is too large' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, status: 400, message: 'Invalid JSON payload' });
  }

  return mapMulterError(err, req, res, (error) => {
    logger.error('Unhandled server error', {
      method: req.method,
      path: req.path,
      message: error ? error.message : 'unknown error',
    });
    res.status(500).json({ success: false, status: 500, message: 'Internal server error' });
  });
});

// --- Start ------------------------------------------------------------------
const server = app.listen(PORT, () => {
  logger.info(`Upload API running at ${BASE_URL}`);
  logger.info(`Web playground     ${BASE_URL}${APP_ROUTE}`);
  logger.info(`Storage folders ready: ${Object.values(CATEGORIES).map((c) => `${c.folder}/`).join(', ')} (in ${UPLOAD_ROOT})`);
  logger.info(
    `Limits: image ${MAX_FILE_SIZE_MB} MB (compress > ${bytesToMb(COMPRESS_THRESHOLD_BYTES)} MB -> <= ${bytesToMb(
      TARGET_SIZE_BYTES,
    )} MB) | video & audio ${MAX_MEDIA_FILE_SIZE_MB} MB (no compression)`,
  );
});

function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;