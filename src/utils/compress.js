'use strict';

/**
 * Image compression helpers built on top of Sharp.
 *
 * Rules implemented here:
 *  - never compress when the file is <= COMPRESS_THRESHOLD_BYTES (7 MB)
 *  - keep the original format (jpeg stays jpeg, png stays png, ...)
 *  - step the quality down gradually so the visual result stays as good as possible
 *  - only as a last resort scale the image down
 *  - never return something bigger than the input
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const sharp = require('sharp');

const { COMPRESS_THRESHOLD_BYTES, TARGET_SIZE_BYTES } = require('../config');
const logger = require('./logger');

const MB = 1024 * 1024;

/**
 * Compression ladder per format: we try every step from best looking to smallest.
 * The first step whose result fits the target wins.
 */
const QUALITY_STEPS = {
  jpeg: [
    { quality: 88, mozjpeg: true, progressive: true },
    { quality: 82, mozjpeg: true, progressive: true },
    { quality: 76, mozjpeg: true, progressive: true },
    { quality: 70, mozjpeg: true, progressive: true },
    { quality: 64, mozjpeg: true, progressive: true },
    { quality: 58, mozjpeg: true, progressive: true },
    { quality: 50, mozjpeg: true, progressive: true },
    { quality: 42, mozjpeg: true, progressive: true },
  ],
  webp: [
    { quality: 88, effort: 6 },
    { quality: 82, effort: 6 },
    { quality: 76, effort: 6 },
    { quality: 70, effort: 6 },
    { quality: 64, effort: 6 },
    { quality: 58, effort: 6 },
    { quality: 50, effort: 6 },
    { quality: 42, effort: 6 },
  ],
  png: [
    // PNG is lossless: first try maximum lossless deflate, then quantize (palette).
    { compressionLevel: 9, effort: 10, palette: false },
    { compressionLevel: 9, effort: 10, palette: true, quality: 92 },
    { compressionLevel: 9, effort: 10, palette: true, quality: 85 },
    { compressionLevel: 9, effort: 10, palette: true, quality: 78 },
    { compressionLevel: 9, effort: 10, palette: true, quality: 70 },
    { compressionLevel: 9, effort: 10, palette: true, quality: 60 },
    { compressionLevel: 9, effort: 10, palette: true, quality: 50 },
  ],
  gif: [
    { effort: 10 },
    { effort: 10, dither: 0.6 },
  ],
};

/** Scales tried when quality reduction alone cannot reach the target. */
const RESIZE_SCALES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];

/**
 * @param {number} bytes
 * @returns {boolean} true when the file must be compressed (> 7 MB)
 */
function shouldCompress(bytes) {
  return bytes > COMPRESS_THRESHOLD_BYTES;
}

/**
 * Bytes -> megabytes rounded to 2 decimals (7340032 => 7, 3245120 => 3.09).
 * @param {number} bytes
 * @returns {number}
 */
function bytesToMb(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round((bytes / MB) * 100) / 100;
}

function stepsForFormat(format) {
  return QUALITY_STEPS[format] || QUALITY_STEPS.jpeg;
}

/**
 * Encode the source image with the given format + options.
 * @returns {Promise<Buffer>}
 */
async function encode(inputPath, format, options) {
  const pipeline = sharp(inputPath, { failOn: 'none', animated: true }).toFormat(format, options);
  return pipeline.toBuffer();
}

/**
 * Compress an image until it fits into `targetBytes`, keeping its format.
 *
 * @param {object} params
 * @param {string} params.inputPath  source file
 * @param {string} params.outputPath destination file (same format as source)
 * @param {string} params.format     "jpeg" | "png" | "webp" | "gif"
 * @param {number} [params.targetBytes=TARGET_SIZE_BYTES]
 * @param {number} [params.originalSize] size of the source, used to bail out early
 * @returns {Promise<{ size: number, targetReached: boolean, attempts: number, format: string }>}
 * @throws {Error} when sharp cannot process the file at all
 */
async function compressImage({ inputPath, outputPath, format, targetBytes = TARGET_SIZE_BYTES, originalSize }) {
  const steps = stepsForFormat(format);
  const startedAt = Date.now();

  let best = null; // { buffer, options }
  let targetReached = false;
  let attempts = 0;

  // Phase 1 - quality ladder (format is never changed).
  for (const options of steps) {
    attempts += 1;
    // eslint-disable-next-line no-await-in-loop
    const buffer = await encode(inputPath, format, options);

    if (!best || buffer.length < best.buffer.length) {
      best = { buffer, options };
    }
    if (buffer.length <= targetBytes) {
      targetReached = true;
      break;
    }
    // Quality already at the bottom of the ladder and still too big -> stop early.
    if (options === steps[steps.length - 1]) break;
  }

  // Phase 2 - last resort: scale the image down and re-encode.
  if (!targetReached && best) {
    const metadata = await sharp(inputPath, { failOn: 'none', animated: true }).metadata();
    const width = metadata.width;
    const height = metadata.pageHeight || metadata.height;

    if (width && height) {
      for (const scale of RESIZE_SCALES) {
        if (best.buffer.length <= targetBytes) break;
        attempts += 1;
        const resizeOptions = { width: Math.max(1, Math.round(width * scale)) };
        // eslint-disable-next-line no-await-in-loop
        const buffer = await sharp(inputPath, { failOn: 'none', animated: true })
          .resize({ ...resizeOptions, withoutEnlargement: true, fit: 'inside' })
          .toFormat(format, steps[steps.length - 1])
          .toBuffer();

        if (buffer.length < best.buffer.length) best = { buffer, options: steps[steps.length - 1] };
        if (buffer.length <= targetBytes) {
          targetReached = true;
          break;
        }
      }
    }
  }

  if (!best || best.buffer.length === 0) {
    throw new Error('Compression produced an empty result');
  }

  // Writing happens only once, at the very end.
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, best.buffer);

  const size = best.buffer.length;
  const durationMs = Date.now() - startedAt;

  logger.info('Image compressed', {
    filename: path.basename(outputPath),
    from_bytes: originalSize ?? null,
    to_bytes: size,
    to_mb: bytesToMb(size),
    target_reached: targetReached,
    attempts,
    duration_ms: durationMs,
  });

  if (!targetReached) {
    logger.warn('Could not reach the compression target, using smallest result', {
      filename: path.basename(outputPath),
      size_mb: bytesToMb(size),
      target_mb: bytesToMb(targetBytes),
    });
  }

  return { size, targetReached, attempts, format };
}

module.exports = {
  MB,
  shouldCompress,
  bytesToMb,
  compressImage,
};