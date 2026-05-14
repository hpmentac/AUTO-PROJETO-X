import { logger } from './logger.js';

const RETRYABLE_CODES = new Set([429, 500, 503, 524]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executa `fn` com retry e exponential backoff.
 * So faz retry em erros com status code retryable (429, 500, 503, 524).
 */
export async function retry(fn, { maxAttempts = 3, baseDelayMs = 2000, name = 'operation' } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status || err.statusCode;
      const isRetryable = status ? RETRYABLE_CODES.has(status) : false;

      if (!isRetryable || attempt === maxAttempts) {
        throw err;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(`[${name}] Tentativa ${attempt}/${maxAttempts} falhou (${status}). Retry em ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
}

export { sleep };
