import { logger } from './logger.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private maxPerWindow: number;
  private windowMs: number;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(maxPerWindow: number, windowMs: number) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;

    // Periodically clean up expired entries
    this.cleanupTimer = setInterval(() => this.cleanup(), windowMs);
  }

  /**
   * Check if a request from this IP is allowed.
   * Returns true if allowed, false if rate limited.
   */
  allow(ip: string): boolean {
    const now = Date.now();
    const entry = this.limits.get(ip);

    if (!entry || now >= entry.resetAt) {
      this.limits.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    entry.count++;

    if (entry.count > this.maxPerWindow) {
      logger.warn(
        `Rate limited: ${ip} (${entry.count}/${this.maxPerWindow} in window)`,
      );
      return false;
    }

    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.limits) {
      if (now >= entry.resetAt) {
        this.limits.delete(ip);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.limits.clear();
  }
}
