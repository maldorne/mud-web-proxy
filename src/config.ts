import type { ProxyConfig, MudRoute } from './types.js';
import { logger } from './logger.js';

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

function parseInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseRoutes(value: string | undefined): Record<string, MudRoute> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<
      string,
      { host: string; port: number }
    >;
    const routes: Record<string, MudRoute> = {};
    for (const [key, route] of Object.entries(parsed)) {
      if (typeof route.host === 'string' && typeof route.port === 'number') {
        routes[key] = { host: route.host, port: route.port };
      } else {
        logger.warn(`Invalid route for "${key}", skipping`);
      }
    }
    return routes;
  } catch {
    logger.error(`Failed to parse MUD_ROUTES: ${value}`);
    return {};
  }
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) return ['*'];
  return value.split(',').map((s) => s.trim());
}

export function loadConfig(): ProxyConfig {
  const env = process.env;

  return {
    wsPort: parseInt(env.WS_PORT, 6200),
    defaultHost: env.DEFAULT_HOST ?? 'muds.maldorne.org',
    defaultPort: parseInt(env.DEFAULT_PORT, 5010),
    debug: parseBoolean(env.DEBUG, false),
    compress: parseBoolean(env.COMPRESS, true),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    maxConnections: parseInt(env.MAX_CONNECTIONS, 500),
    connectTimeoutMs: parseInt(env.CONNECT_TIMEOUT_MS, 10_000),
    idleTimeoutMs: parseInt(env.IDLE_TIMEOUT_MS, 30 * 60 * 1000),
    pingIntervalMs: parseInt(env.PING_INTERVAL_MS, 30_000),
    pongTimeoutMs: parseInt(env.PONG_TIMEOUT_MS, 10_000),
    rateLimitPerIp: parseInt(env.RATE_LIMIT_PER_IP, 10),
    rateLimitWindowMs: parseInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
    enableLegacyRouting: parseBoolean(env.ENABLE_LEGACY_ROUTING, true),
    routes: parseRoutes(env.MUD_ROUTES),
    tls: {
      enabled: parseBoolean(env.TLS_ENABLED, false),
      certPath: env.TLS_CERT_PATH ?? './cert.pem',
      keyPath: env.TLS_KEY_PATH ?? './privkey.pem',
    },
    chat: {
      enabled: parseBoolean(env.CHAT_ENABLED, true),
      maxLogSize: parseInt(env.CHAT_MAX_LOG_SIZE, 300),
    },
    ttype: {
      enabled: true,
      portal: ['maldorne.org', 'XTERM-256color', 'MTTS 141'],
    },
    gmcp: {
      enabled: true,
      portal: ['client maldorne.org', 'client_version 1.0'],
    },
  };
}
