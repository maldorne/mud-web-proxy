import net from 'net';
import zlib from 'zlib';
import { WebSocket } from 'ws';
import { ProxyServer } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';
import type { ProxyConfig } from '../../src/types.js';

/**
 * Minimal telnet server for e2e testing.
 * Accepts connections, echoes data back, and can send
 * arbitrary data/IAC sequences to the client.
 */
export class MockTelnetServer {
  private server: net.Server;
  private connections: net.Socket[] = [];
  port = 0;

  constructor() {
    this.server = net.createServer((socket) => {
      this.connections.push(socket);
      socket.on('close', () => {
        const idx = this.connections.indexOf(socket);
        if (idx !== -1) this.connections.splice(idx, 1);
      });
      socket.on('error', () => {
        // ignore errors in tests
      });
    });
  }

  /** Start listening on a random available port. */
  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as net.AddressInfo;
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  /** Send data from the MUD server to all connected clients. */
  send(data: Buffer | string): void {
    const buf = typeof data === 'string' ? Buffer.from(data) : data;
    for (const conn of this.connections) {
      if (conn.writable) conn.write(buf);
    }
  }

  /** Set a handler for incoming data from the proxy. */
  onData(handler: (data: Buffer) => void): void {
    for (const conn of this.connections) {
      conn.on('data', handler);
    }
  }

  /** Wait until at least one connection is established. */
  async waitForConnection(timeoutMs = 5000): Promise<void> {
    if (this.connections.length > 0) return;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timeout waiting for telnet connection')),
        timeoutMs,
      );
      this.server.once('connection', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  get connectionCount(): number {
    return this.connections.length;
  }

  async stop(): Promise<void> {
    for (const conn of this.connections) {
      conn.destroy();
    }
    this.connections = [];
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

/**
 * Helper to create and start a proxy server for testing.
 */
export async function startProxy(
  telnetPort: number,
  overrides: Partial<ProxyConfig> = {},
): Promise<{ proxy: ProxyServer; port: number }> {
  // Find a free port for the proxy
  const freePort = await getFreePort();

  process.env.WS_PORT = String(freePort);
  process.env.DEFAULT_HOST = '127.0.0.1';
  process.env.DEFAULT_PORT = String(telnetPort);
  process.env.ENABLE_LEGACY_ROUTING = 'true';
  process.env.TLS_ENABLED = 'false';
  process.env.COMPRESS = 'false';
  process.env.DEBUG = 'false';
  process.env.ALLOWED_ORIGINS = '*';
  process.env.CHAT_ENABLED = 'false';
  process.env.LOG_LEVEL = 'error';
  process.env.MUD_ROUTES = JSON.stringify({
    'test-mud': { host: '127.0.0.1', port: telnetPort },
  });

  const config = { ...loadConfig(), ...overrides };
  const proxy = new ProxyServer(config);
  proxy.start();

  // Wait for server to be listening
  await new Promise((resolve) => setTimeout(resolve, 100));

  return { proxy, port: freePort };
}

/**
 * Create a WebSocket client connected to the proxy.
 */
export function connectClient(proxyPort: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/**
 * Send a connect message from the WS client to the proxy.
 */
export function sendConnect(
  ws: WebSocket,
  options: { mud?: string; host?: string; port?: number } = {},
): void {
  ws.send(
    JSON.stringify({
      ...options,
      connect: 1,
      utf8: 1,
      mxp: 1,
      mccp: 0,
    }),
  );
}

/**
 * Wait for the next message from the WebSocket.
 * Messages from the proxy are base64-encoded (optionally zlib-compressed).
 */
export function waitForMessage(
  ws: WebSocket,
  timeoutMs = 5000,
  compressed = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timeout waiting for WS message')),
      timeoutMs,
    );

    ws.once('message', (raw: Buffer | string) => {
      clearTimeout(timeout);
      const b64 = raw.toString();

      // Skip non-base64 messages (like chat)
      if (b64.startsWith('portal.')) {
        resolve(b64);
        return;
      }

      const buf = Buffer.from(b64, 'base64');

      if (compressed) {
        zlib.inflateRaw(buf, (err, result) => {
          if (err) reject(err);
          else resolve(result.toString());
        });
      } else {
        resolve(buf.toString());
      }
    });
  });
}

/**
 * Collect messages for a duration.
 */
export function collectMessages(
  ws: WebSocket,
  durationMs: number,
  compressed = false,
): Promise<string[]> {
  return new Promise((resolve) => {
    const messages: string[] = [];

    const handler = (raw: Buffer | string) => {
      const b64 = raw.toString();
      if (b64.startsWith('portal.')) {
        messages.push(b64);
        return;
      }
      const buf = Buffer.from(b64, 'base64');
      if (compressed) {
        zlib.inflateRaw(buf, (_err, result) => {
          if (result) messages.push(result.toString());
        });
      } else {
        messages.push(buf.toString());
      }
    };

    ws.on('message', handler);
    setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(messages);
    }, durationMs);
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}
