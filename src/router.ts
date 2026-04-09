import type { ProxyConfig, MudRoute, ClientMessage } from './types.js';
import { logger } from './logger.js';

export class Router {
  private routes: Record<string, MudRoute>;
  private defaultHost: string;
  private defaultPort: number;
  private legacyEnabled: boolean;

  constructor(config: ProxyConfig) {
    this.routes = config.routes;
    this.defaultHost = config.defaultHost;
    this.defaultPort = config.defaultPort;
    this.legacyEnabled = config.enableLegacyRouting;

    const routeCount = Object.keys(this.routes).length;
    if (routeCount > 0) {
      logger.info(`Loaded ${routeCount} MUD route(s): ${Object.keys(this.routes).join(', ')}`);
    }
    if (this.legacyEnabled) {
      logger.info(`Legacy routing enabled (default: ${this.defaultHost}:${this.defaultPort})`);
    }
  }

  resolve(msg: ClientMessage): MudRoute {
    // Route by MUD name (cluster mode)
    if (msg.mud) {
      const route = this.routes[msg.mud];
      if (!route) {
        throw new Error(
          `Unknown MUD "${msg.mud}". Available: ${Object.keys(this.routes).join(', ') || 'none'}`,
        );
      }
      logger.debug(`Route resolved: ${msg.mud} -> ${route.host}:${route.port}`);
      return route;
    }

    // Legacy mode: host + port from client
    if (this.legacyEnabled) {
      const host = msg.host ?? this.defaultHost;
      const port = msg.port ?? this.defaultPort;
      logger.debug(`Legacy route: ${host}:${port}`);
      return { host, port };
    }

    throw new Error(
      'No MUD identifier provided and legacy routing is disabled. Send { "mud": "<name>" } to connect.',
    );
  }
}
