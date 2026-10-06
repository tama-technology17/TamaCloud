'use strict';

/**
 * Tiny leveled logger (no external dependency).
 * Keeps stdout readable without pulling in a logging framework.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ACTIVE_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function write(level, message, meta) {
  if (LEVELS[level] < ACTIVE_LEVEL) return;
  const time = new Date().toISOString();
  const extra = meta === undefined ? '' : ` ${formatMeta(meta)}`;
  // eslint-disable-next-line no-console
  console.log(`${time} [${level.toUpperCase()}] ${message}${extra}`);
}

function formatMeta(meta) {
  if (meta instanceof Error) return meta.message;
  if (typeof meta === 'string') return meta;
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};