import http from 'http';
import https from 'https';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ProxyConfig } from './types.js';
import { Router } from './router.js';
import { Connection } from './connection.js';
import { Chat } from './chat.js';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { RateLimiter } from './rate-limiter.js';

export class ProxyServer {
  private config: ProxyConfig;
  private router: Router;
  private httpServer: http.Server | https.Server;
  private wsServer: WebSocketServer;
  private connections: Set<Connection> = new Set();
  private chat: Chat;
  private rateLimiter: RateLimiter;
  private accepting = true;

  constructor(config: ProxyConfig) {
    this.config = config;
    this.router = new Router(config);

    // Create HTTP(S) server
    this.httpServer = this.createHttpServer();
    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.chat = new Chat(config, () => Array.from(this.connections));
    this.rateLimiter = new RateLimiter(
      config.rateLimitPerIp,
      config.rateLimitWindowMs,
    );

    this.setupWebSocketServer();

    // Register gauges
    metrics.gauge(
      'proxy_websocket_connections_active',
      'Current active WebSocket connections',
      () => this.connections.size,
    );
    metrics.gauge(
      'proxy_tcp_connections_active',
      'Current active TCP connections to MUD servers',
      () => Array.from(this.connections).filter((c) => c.tcp !== null).length,
    );
  }

  private createHttpServer(): http.Server | https.Server {
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      this.handleHttpRequest(req, res);
    };

    if (this.config.tls.enabled) {
      const certPath = this.config.tls.certPath!;
      const keyPath = this.config.tls.keyPath!;

      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        logger.error(
          'TLS certificates not found. Set TLS_ENABLED=false or provide valid paths.',
        );
        process.exit(1);
      }

      return https.createServer(
        {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        },
        handler,
      );
    }

    return http.createServer(handler);
  }

  private setSecurityHeaders(res: ServerResponse): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
    res.setHeader('Cache-Control', 'no-store');
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    this.setSecurityHeaders(res);

    if (req.url === '/health') {
      const status = this.accepting ? 200 : 503;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: this.accepting ? 'ok' : 'shutting_down',
          uptime: process.uptime(),
          connections: {
            websocket: this.connections.size,
            telnet: Array.from(this.connections).filter((c) => c.tcp !== null)
              .length,
          },
        }),
      );
      return;
    }

    if (req.url === '/metrics') {
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      });
      res.end(metrics.serialize());
      return;
    }

    res.writeHead(404);
    res.end();
  }

  private setupWebSocketServer(): void {
    this.wsServer.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      if (!this.accepting) {
        ws.close();
        return;
      }

      const remoteAddress =
        req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ??
        req.socket.remoteAddress ??
        'unknown';

      // Check origin
      if (!this.isOriginAllowed(req.headers.origin)) {
        logger.warn(`Rejected origin: ${req.headers.origin}`, remoteAddress);
        metrics.inc('proxy_connections_rejected_total');
        ws.close();
        return;
      }

      // Check rate limit
      if (!this.rateLimiter.allow(remoteAddress)) {
        logger.warn('Rate limited', remoteAddress);
        metrics.inc('proxy_connections_rejected_total');
        metrics.inc('proxy_rate_limited_total');
        ws.close();
        return;
      }

      // Check max connections
      if (this.connections.size >= this.config.maxConnections) {
        logger.warn('Max connections reached, rejecting', remoteAddress);
        metrics.inc('proxy_connections_rejected_total');
        ws.send(JSON.stringify({ error: 'Server at capacity' }));
        ws.close();
        return;
      }

      metrics.inc('proxy_connections_total');
      logger.info(
        `New WebSocket connection (total: ${this.connections.size + 1})`,
        remoteAddress,
      );

      const connection = new Connection(
        ws,
        remoteAddress,
        this.config,
        this.router,
        (conn) => this.removeConnection(conn),
      );

      this.connections.add(connection);

      // Listen for chat events from this connection
      ws.on('chat', (conn: Connection, msg: unknown) => {
        if (this.config.chat.enabled) {
          this.chat.handleChat(
            conn,
            msg as import('./types.js').ClientMessage,
          );
        }
      });
    });
  }

  private isOriginAllowed(origin: string | undefined): boolean {
    if (this.config.allowedOrigins.includes('*')) return true;
    if (!origin) return true; // Allow non-browser clients
    return this.config.allowedOrigins.includes(origin);
  }

  private removeConnection(connection: Connection): void {
    this.connections.delete(connection);
    logger.info(
      `Connection removed (remaining: ${this.connections.size})`,
      connection.remoteAddress,
    );
    if (this.config.chat.enabled) {
      this.chat.sendUpdate();
    }
  }

  start(): void {
    this.httpServer.listen(this.config.wsPort, () => {
      const protocol = this.config.tls.enabled ? 'wss' : 'ws';
      logger.info(
        `Proxy server listening on ${protocol}://0.0.0.0:${this.config.wsPort}`,
      );
      logger.info(
        `Health check at http://0.0.0.0:${this.config.wsPort}/health`,
      );
    });
  }

  async shutdown(): Promise<void> {
    logger.info('Graceful shutdown initiated');
    this.accepting = false;

    // Notify all connected clients
    for (const conn of this.connections) {
      conn.sendMessage('Proxy server is shutting down...\r\n');
    }

    this.rateLimiter.destroy();

    // Save chat log
    if (this.config.chat.enabled) {
      this.chat.saveToDisk();
    }

    // Wait briefly for messages to be sent, then close all connections
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    for (const conn of this.connections) {
      conn.close();
    }

    // Close servers
    this.wsServer.close();
    this.httpServer.close();

    // Wait for drain (max 10 seconds)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Shutdown timeout, forcing exit');
        resolve();
      }, 10_000);

      this.httpServer.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    logger.info('Shutdown complete');
  }
}
