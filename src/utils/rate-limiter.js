import { logger } from './logger.js';
import { sleep } from './retry.js';

export class RateLimiter {
  /** @param {number} maxPerMinute  @param {string} name */
  constructor(maxPerMinute, name) {
    this.maxPerMinute = maxPerMinute;
    this.name = name;
    this.timestamps = [];
  }

  async waitForSlot() {
    const now = Date.now();
    // Remover timestamps com mais de 60s
    this.timestamps = this.timestamps.filter(t => now - t < 60_000);

    if (this.timestamps.length >= this.maxPerMinute) {
      const oldest = this.timestamps[0];
      const waitMs = 60_000 - (now - oldest) + 100; // +100ms margem
      logger.info(`[${this.name}] Rate limit — aguardando ${(waitMs / 1000).toFixed(1)}s`);
      await sleep(waitMs);
    }

    this.timestamps.push(Date.now());
  }
}

// Instancia global (margem de seguranca: 90% do limite real)
export const talkifyLimiter = new RateLimiter(10, 'Talkify');
