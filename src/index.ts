import { loadConfig } from './config.js';
import { ProxyServer } from './server.js';
import { logger } from './logger.js';

const config = loadConfig();
const server = new ProxyServer(config);

// Graceful shutdown handlers
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal}, shutting down...`);
  await server.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err: Error) => {
  logger.error(`Uncaught exception: ${err.message}\n${err.stack}`);
  shutdown('uncaughtException').catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

// Start
server.start();
