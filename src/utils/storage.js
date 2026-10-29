'use strict';

/**
 * Statistik penyimpanan: total ukuran file di dalam folder upload,
 * dikelompokkan per kategori (image / video / audio).
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const { UPLOAD_ROOT, CATEGORIES, TEMP_PREFIX } = require('../config');

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

/**
 * Format byte -> string yang mudah dibaca.
 * 5_368_709_120 => "5 GB"
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(2)} MB`;
  if (bytes < TB) return `${(bytes / GB).toFixed(2)} GB`;
  return `${(bytes / TB).toFixed(2)} TB`;
}

/** Detail ukuran dalam berbagai satuan. */
function sizeDetail(bytes) {
  return {
    bytes,
    readable: formatBytes(bytes),
    kb: Math.round((bytes / KB) * 100) / 100,
    mb: Math.round((bytes / MB) * 100) / 100,
    gb: Math.round((bytes / GB) * 100) / 100,
  };
}

/**
 * Recursive walk: kirimkan setiap file ke callback.
 * @param {string} dir
 * @param {(fullPath: string, name: string) => void} onFile
 */
async function walk(dir, onFile) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // folder belum ada -> dianggap kosong
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      await walk(fullPath, onFile);
    } else if (entry.isFile()) {
      // eslint-disable-next-line no-await-in-loop
      onFile(fullPath, entry.name);
    }
  }
}

/**
 * Hitung total ukuran + jumlah file di seluruh folder upload.
 * File temp (.tmp-*) tidak dihitung karena bukan file yang tersimpan permanen.
 *
 * @returns {Promise<object>}
 */
async function getStorageStats() {
  const startedAt = Date.now();
  const root = path.resolve(UPLOAD_ROOT);

  const byCategory = new Map(
    Object.values(CATEGORIES).map((category) => [
      category.folder,
      { name: category.name, folder: category.folder, files: 0, bytes: 0 },
    ]),
  );

  const unknown = { name: 'other', folder: null, files: 0, bytes: 0 };
  let totalBytes = 0;
  let totalFiles = 0;
  let skippedTemp = 0;

  await walk(root, async (fullPath, name) => {
    // Abaikan file tersembunyi: .tmp-* (upload belum selesai / yatim dari proses
    // yang mati) dan .gitkeep. Hanya file hasil upload yang dihitung.
    if (name.startsWith('.')) {
      if (name.startsWith(TEMP_PREFIX)) skippedTemp += 1;
      return;
    }

    let size = 0;
    try {
      size = (await fs.stat(fullPath)).size;
    } catch {
      return; // file hilang saat dibaca (aman diabaikan)
    }

    // Kategori ditentukan dari nama folder induk langsung.
    const parent = path.basename(path.dirname(fullPath));
    const bucket = byCategory.get(parent) || unknown;

    bucket.files += 1;
    bucket.bytes += size;
    totalBytes += size;
    totalFiles += 1;
  });

  // Info kapasitas disk (opsional, tidak selalu didukung).
  let disk = null;
  try {
    const st = await fs.statfs(root);
    const totalBytesDisk = st.blocks * st.bsize;
    const freeBytes = st.bavail * st.bsize;
    disk = {
      ...sizeDetail(totalBytesDisk),
      free_bytes: freeBytes,
      used_bytes: totalBytesDisk - st.bfree * st.bsize,
      used_percent: totalBytesDisk ? Math.round(((st.blocks - st.bfree) / st.blocks) * 100) : 0,
    };
  } catch {
    disk = null;
  }

  return {
    folder: root,
    total: { ...sizeDetail(totalBytes), files: totalFiles },
    categories: [...byCategory.values()].map((bucket) => ({
      ...bucket,
      readable: formatBytes(bucket.bytes),
      mb: Math.round((bucket.bytes / MB) * 100) / 100,
      gb: Math.round((bucket.bytes / GB) * 100) / 100,
    })),
    other: unknown.files ? { ...unknown, readable: formatBytes(unknown.bytes) } : null,
    skipped_temp_files: skippedTemp,
    disk,
    duration_ms: Date.now() - startedAt,
    computed_at: new Date().toISOString(),
  };
}

module.exports = { formatBytes, getStorageStats };