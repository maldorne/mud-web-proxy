import net from 'net';
import zlib from 'zlib';
import iconv from 'iconv-lite';
import { WebSocket } from 'ws';
import type {
  ProxyConfig,
  ClientMessage,
  ConnectionState,
  MudRoute,
} from './types.js';
import { Router } from './router.js';
import { TelnetNegotiator } from './telnet/negotiator.js';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { clientMessageSchema } from './validation.js';

export class Connection implements ConnectionState {
  readonly id: string;
  readonly remoteAddress: string;
  name?: string;
  client?: string;
  mudId?: string;
  mccp = false;
  utf8 = false;
  compressed = false;
  passwordMode = false;
  debugEnabled = false;
  ttype: string[] = [];

  ws: WebSocket;
  tcp: net.Socket | null = null;

  private config: ProxyConfig;
  private router: Router;
  private negotiator: TelnetNegotiator;
  private closed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onClose: (connection: Connection) => void;
  private lastRoute: MudRoute | null = null;
  private lastConnectMsg: ClientMessage | null = null;
  private reconnectCount = 0;
  private tcpConnected = false;

  constructor(
    ws: WebSocket,
    remoteAddress: string,
    config: ProxyConfig,
    router: Router,
    onClose: (connection: Connection) => void,
  ) {
    this.id = Math.random().toString(36).substring(2, 10);
    this.ws = ws;
    this.remoteAddress = remoteAddress;
    this.config = config;
    this.router = router;
    this.negotiator = new TelnetNegotiator(config);
    this.onClose = onClose;

    this.setupWebSocket();
    this.startPing();
  }

  private setupWebSocket(): void {
    this.ws.on('message', (data: Buffer | string) => {
      this.resetIdleTimer();
      this.handleClientMessage(data);
    });

    this.ws.on('close', () => {
      logger.info(`WebSocket closed`, this.remoteAddress);
      this.close();
    });

    this.ws.on('error', (error: Error) => {
      logger.error(`WebSocket error: ${error.message}`, this.remoteAddress);
      this.close();
    });

    this.ws.on('pong', () => {
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
      }
    });
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws.readyState !== WebSocket.OPEN) return;

      this.ws.ping();
      this.pongTimeout = setTimeout(() => {
        logger.warn('Pong timeout, closing connection', this.remoteAddress);
        this.close();
      }, this.config.pongTimeoutMs);
    }, this.config.pingIntervalMs);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      logger.info('Idle timeout, closing connection', this.remoteAddress);
      this.sendMessage('Idle timeout. Connection closed.\r\n');
      this.close();
    }, this.config.idleTimeoutMs);
  }

  private handleClientMessage(raw: Buffer | string): void {
    const buf = typeof raw === 'string' ? Buffer.from(raw) : raw;
    metrics.inc('proxy_messages_from_client_total');
    metrics.inc('proxy_bytes_from_client_total', buf.length);
    const str = raw.toString();

    // Only parse JSON messages (starting with '{')
    if (str[0] !== '{') {
      this.forwardToMud(raw);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(str);
    } catch {
      logger.warn('Invalid JSON from client', this.remoteAddress);
      return;
    }

    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn(
        `Invalid client message: ${result.error.issues.map((i) => i.message).join(', ')}`,
        this.remoteAddress,
      );
      return;
    }
    const msg: ClientMessage = result.data;

    if (msg.host) {
      logger.debug(`Target host set to ${msg.host}`, this.remoteAddress);
    }
    if (msg.port) {
      logger.debug(`Target port set to ${msg.port}`, this.remoteAddress);
    }
    if (msg.ttype) {
      this.ttype = [msg.ttype];
    }
    if (msg.name) this.name = msg.name;
    if (msg.client) this.client = msg.client;
    if (msg.mccp) this.mccp = true;
    if (msg.utf8) this.utf8 = true;
    if (msg.debug) this.debugEnabled = true;
    if (msg.mud) this.mudId = msg.mud;

    // Chat messages are handled separately
    if (msg.chat) {
      // Emit a chat event — the chat module will handle it
      this.ws.emit('chat', this, msg);
      return;
    }

    if (msg.connect) {
      this.connectToMud(msg);
    }

    if (msg.bin && this.tcp) {
      try {
        logger.debug(
          `Binary send: ${JSON.stringify(msg.bin)}`,
          this.remoteAddress,
        );
        this.tcp.write(Buffer.from(msg.bin));
      } catch (ex) {
        logger.error(`Binary send error: ${ex}`, this.remoteAddress);
      }
    }

    if (msg.msdp && this.tcp) {
      try {
        this.negotiator.msdp.sendMSDP(this, msg.msdp);
      } catch (ex) {
        logger.error(`MSDP send error: ${ex}`, this.remoteAddress);
      }
    }

    if (msg.gmcp && this.tcp) {
      try {
        logger.debug(`GMCP send: ${msg.gmcp}`, this.remoteAddress);
        this.negotiator.gmcp.sendGMCP(this, msg.gmcp);
      } catch (ex) {
        logger.error(`GMCP send error: ${ex}`, this.remoteAddress);
      }
    }
  }

  private connectToMud(msg: ClientMessage): void {
    let route: MudRoute;
    try {
      route = this.router.resolve(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Route resolution failed: ${message}`, this.remoteAddress);
      this.sendMessage(message + '\r\n');
      setTimeout(() => this.close(), 500);
      return;
    }

    // Build ttype list
    this.ttype = this.ttype.concat(
      this.config.ttype.portal.slice(0),
      this.remoteAddress,
      this.remoteAddress,
    );

    this.compressed = false;
    this.lastRoute = route;
    this.lastConnectMsg = msg;

    metrics.inc('proxy_tcp_connections_total');
    logger.info(
      `Connecting to ${route.host}:${route.port} for ${this.remoteAddress}`,
    );

    this.tcp = net.createConnection(
      {
        host: route.host,
        port: route.port,
        timeout: this.config.connectTimeoutMs,
      },
      () => {
        this.tcpConnected = true;
        logger.info(
          `TCP connected to ${route.host}:${route.port}`,
          this.remoteAddress,
        );
        this.resetIdleTimer();
      },
    );

    this.tcp.on('data', (data: Buffer) => {
      metrics.inc('proxy_messages_from_mud_total');
      metrics.inc('proxy_bytes_from_mud_total', data.length);
      this.resetIdleTimer();
      this.handleMudData(data);
    });

    this.tcp.on('timeout', () => {
      metrics.inc('proxy_tcp_errors_total');
      logger.warn('TCP connect timeout', this.remoteAddress);
      this.sendMessage('Timeout: server is not responding.\r\n');
      setTimeout(() => this.close(), 500);
    });

    this.tcp.on('close', () => {
      logger.info('TCP socket closed', this.remoteAddress);
      if (!this.closed && this.tcpConnected) {
        this.attemptReconnect();
      } else if (!this.closed) {
        setTimeout(() => this.close(), 500);
      }
    });

    this.tcp.on('error', (err: Error) => {
      metrics.inc('proxy_tcp_errors_total');
      logger.error(`TCP error: ${err.message}`, this.remoteAddress);
      if (!this.tcpConnected) {
        this.sendMessage('Error: could not connect to MUD server.\r\n');
        setTimeout(() => this.close(), 500);
      }
    });
  }

  private attemptReconnect(): void {
    if (
      !this.lastRoute ||
      this.reconnectCount >= this.config.reconnectAttempts
    ) {
      if (this.reconnectCount > 0) {
        this.sendMessage(
          'Reconnection failed after ' +
            this.reconnectCount +
            ' attempts.\r\n',
        );
      }
      setTimeout(() => this.close(), 500);
      return;
    }

    this.reconnectCount++;
    metrics.inc('proxy_reconnect_attempts_total');
    const delay = this.config.reconnectDelayMs * this.reconnectCount;

    logger.info(
      `Reconnect attempt ${this.reconnectCount}/${this.config.reconnectAttempts} in ${delay}ms`,
      this.remoteAddress,
    );
    this.sendMessage(
      `Connection lost. Reconnecting (${this.reconnectCount}/${this.config.reconnectAttempts})...\r\n`,
    );

    // Clean up old TCP socket
    if (this.tcp) {
      this.tcp.removeAllListeners();
      this.tcp.destroy();
      this.tcp = null;
    }

    // Reset negotiation state for reconnect
    this.negotiator.destroy();
    this.negotiator = new TelnetNegotiator(this.config);
    this.compressed = false;

    setTimeout(() => {
      if (this.closed || !this.lastRoute) return;

      const route = this.lastRoute;
      metrics.inc('proxy_tcp_connections_total');

      this.tcp = net.createConnection(
        {
          host: route.host,
          port: route.port,
          timeout: this.config.connectTimeoutMs,
        },
        () => {
          logger.info(
            `Reconnected to ${route.host}:${route.port}`,
            this.remoteAddress,
          );
          metrics.inc('proxy_reconnect_successes_total');
          this.reconnectCount = 0;
          this.sendMessage('Reconnected.\r\n');
          this.resetIdleTimer();
        },
      );

      this.tcp.on('data', (data: Buffer) => {
        metrics.inc('proxy_messages_from_mud_total');
        metrics.inc('proxy_bytes_from_mud_total', data.length);
        this.resetIdleTimer();
        this.handleMudData(data);
      });

      this.tcp.on('close', () => {
        if (!this.closed) this.attemptReconnect();
      });

      this.tcp.on('timeout', () => {
        metrics.inc('proxy_tcp_errors_total');
        if (!this.closed) this.attemptReconnect();
      });

      this.tcp.on('error', (err: Error) => {
        metrics.inc('proxy_tcp_errors_total');
        logger.error(
          `Reconnect TCP error: ${err.message}`,
          this.remoteAddress,
        );
      });
    }, delay);
  }

  private handleMudData(data: Buffer): void {
    if (this.config.debug) {
      this.negotiator.debugRaw(data, this.remoteAddress);
    }

    // Let the negotiator process IAC sequences
    const processed = this.negotiator.processServerData(data, this);

    if (processed.length === 0) return;

    this.sendToClient(processed);
  }

  sendToClient(data: Buffer): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;

    // Compress only if both the server allows it and the client requested it
    if (!this.config.compress || !this.mccp) {
      this.ws.send(data);
      return;
    }

    // Proxy-level compression (zlib deflate + base64)
    zlib.deflateRaw(data, (err, buffer) => {
      if (err) {
        logger.error(`zlib error: ${err.message}`, this.remoteAddress);
        return;
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(buffer.toString('base64'));
      }
    });
  }

  writeTcp(data: Buffer | string): void {
    if (!this.tcp || !this.tcp.writable) return;

    const buf = typeof data === 'string' ? Buffer.from(data) : data;

    if (this.config.debug) {
      const raw: string[] = [];
      for (let i = 0; i < buf.length; i++) raw.push(buf[i].toString());
      logger.debug(`write bin: ${raw.join(',')}`, this.remoteAddress);
    }

    // Encode as latin1 for non-UTF8 connections, UTF-8 otherwise
    try {
      const encoded = this.utf8 ? buf : iconv.encode(buf.toString(), 'latin1');
      this.tcp.write(encoded);
    } catch (ex) {
      logger.error(`Encoding error: ${ex}`, this.remoteAddress);
      this.tcp.write(buf);
    }
  }

  private forwardToMud(data: Buffer | string): void {
    if (!this.tcp) return;

    if (this.debugEnabled) {
      if (this.passwordMode) {
        logger.debug('forward: **** (omitted)', this.remoteAddress);
      } else {
        logger.debug(`forward: ${data}`, this.remoteAddress);
      }
    }

    if (this.passwordMode) {
      this.passwordMode = false;
    }

    const buf = typeof data === 'string' ? Buffer.from(data) : data;
    try {
      const encoded = this.utf8 ? buf : iconv.encode(buf.toString(), 'latin1');
      if (this.tcp.writable) this.tcp.write(encoded);
    } catch {
      if (this.tcp.writable) this.tcp.write(buf);
    }
  }

  sendMessage(msg: string): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;

    const data = Buffer.from(msg);
    if (this.config.compress && this.mccp) {
      zlib.deflateRaw(data, (err, buffer) => {
        if (!err && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(buffer.toString('base64'));
        }
      });
    } else {
      this.ws.send(data);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    logger.info(
      `Closing connection ${this.mudId ?? this.remoteAddress}`,
      this.remoteAddress,
    );

    // Clean up timers
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimeout) clearTimeout(this.pongTimeout);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.negotiator.destroy();

    // Close TCP socket
    if (this.tcp) {
      this.tcp.removeAllListeners();
      this.tcp.destroy();
      this.tcp = null;
    }

    // Close WebSocket
    if (
      this.ws.readyState === WebSocket.OPEN ||
      this.ws.readyState === WebSocket.CONNECTING
    ) {
      this.ws.close();
    }

    this.onClose(this);
  }
}
