import type { LogLevel } from './types.js';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
};

const RESET = '\x1b[0m';

/**
 * Strip ANSI escape sequences and control characters from log messages
 * to prevent log injection attacks.
 */
function sanitize(str: string): string {
  /* eslint-disable no-control-regex */
  return str
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\r?\n/g, ' ');
  /* eslint-enable no-control-regex */
}

class Logger {
  private level: number;
  private json: boolean;

  constructor() {
    const envLevel = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
    this.level = LEVELS[envLevel] ?? LEVELS.info;
    this.json = process.env.NODE_ENV === 'production';
  }

  private log(level: LogLevel, rawMsg: string, rawContext?: string): void {
    if (LEVELS[level] < this.level) return;

    const msg = sanitize(rawMsg);
    const context = rawContext ? sanitize(rawContext) : undefined;
    const timestamp = new Date().toISOString();

    if (this.json) {
      const entry: Record<string, string> = { timestamp, level, msg };
      if (context) entry.context = context;
      process.stdout.write(JSON.stringify(entry) + '\n');
    } else {
      const color = COLORS[level];
      const prefix = context ? ` [${context}]` : '';
      process.stdout.write(
        `${timestamp} ${color}${level.toUpperCase()}${RESET}${prefix} ${msg}\n`,
      );
    }
  }

  debug(msg: string, context?: string): void {
    this.log('debug', msg, context);
  }

  info(msg: string, context?: string): void {
    this.log('info', msg, context);
  }

  warn(msg: string, context?: string): void {
    this.log('warn', msg, context);
  }

  error(msg: string, context?: string): void {
    this.log('error', msg, context);
  }
}

export const logger = new Logger();
