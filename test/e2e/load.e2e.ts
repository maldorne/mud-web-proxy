import { expect } from 'chai';
import { WebSocket } from 'ws';
import type { ProxyServer } from '../../src/server.js';
import { MockTelnetServer, startProxy, sendConnect } from './helpers.js';

describe('E2E: load test', function () {
  this.timeout(30000);

  let telnet: MockTelnetServer;
  let proxy: ProxyServer;
  let proxyPort: number;

  before(async () => {
    telnet = new MockTelnetServer();
    await telnet.start();
    const result = await startProxy(telnet.port, {
      maxConnections: 200,
      rateLimitPerIp: 200,
      rateLimitWindowMs: 5000,
      reconnectAttempts: 0,
    });
    proxy = result.proxy;
    proxyPort = result.port;
  });

  after(async () => {
    await proxy.shutdown();
    await telnet.stop();
  });

  it('should handle 50 concurrent connections', async () => {
    const count = 50;
    const clients: WebSocket[] = [];

    // Open all connections concurrently
    const connectPromises = Array.from(
      { length: count },
      () =>
        new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}`);
          ws.on('open', () => resolve(ws));
          ws.on('error', reject);
        }),
    );

    const results = await Promise.allSettled(connectPromises);
    for (const r of results) {
      if (r.status === 'fulfilled') clients.push(r.value);
    }

    expect(clients.length).to.equal(count);

    // Verify /health reports correct connection count
    const res = await fetch(`http://127.0.0.1:${proxyPort}/health`);
    const body = await res.json();
    expect(body.connections.websocket).to.equal(count);

    // Close all
    for (const ws of clients) ws.close();
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it('should handle rapid connect/disconnect cycles', async () => {
    const cycles = 30;

    for (let i = 0; i < cycles; i++) {
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const w = new WebSocket(`ws://127.0.0.1:${proxyPort}`);
        w.on('open', () => resolve(w));
        w.on('error', reject);
      });
      ws.close();
    }

    // Server should still be healthy
    const res = await fetch(`http://127.0.0.1:${proxyPort}/health`);
    expect(res.status).to.equal(200);
  });

  it('should handle 20 concurrent MUD connections with data', async () => {
    const count = 20;
    const clients: WebSocket[] = [];

    // Connect all clients
    for (let i = 0; i < count; i++) {
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const w = new WebSocket(`ws://127.0.0.1:${proxyPort}`);
        w.on('open', () => resolve(w));
        w.on('error', reject);
      });
      sendConnect(ws, { mud: 'test-mud' });
      clients.push(ws);
    }

    // Wait for TCP connections
    await new Promise((resolve) => setTimeout(resolve, 500));

    // MUD sends data to all
    telnet.send('Broadcast message to all players!\r\n');

    // Collect at least one message per client
    const messagePromises = clients.map(
      (ws) =>
        new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => resolve(false), 3000);
          ws.once('message', () => {
            clearTimeout(timeout);
            resolve(true);
          });
        }),
    );

    const received = await Promise.all(messagePromises);
    const successCount = received.filter(Boolean).length;

    // At least 80% should have received the message
    expect(successCount).to.be.greaterThan(count * 0.8);

    // Check metrics
    const res = await fetch(`http://127.0.0.1:${proxyPort}/metrics`);
    const metricsText = await res.text();
    expect(metricsText).to.include('proxy_connections_total');

    // Close all
    for (const ws of clients) ws.close();
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it('should not leak memory after many connections', async () => {
    const before = process.memoryUsage().heapUsed;

    // Open and close 50 connections
    for (let i = 0; i < 50; i++) {
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const w = new WebSocket(`ws://127.0.0.1:${proxyPort}`);
        w.on('open', () => resolve(w));
        w.on('error', reject);
      });
      sendConnect(ws, { mud: 'test-mud' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Force GC if available
    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const after = process.memoryUsage().heapUsed;
    const growth = after - before;

    // Memory growth should be < 50MB (reasonable for 50 open/close cycles)
    expect(growth).to.be.lessThan(50 * 1024 * 1024);

    // Verify no connections leaked
    const res = await fetch(`http://127.0.0.1:${proxyPort}/health`);
    const body = await res.json();
    expect(body.connections.websocket).to.equal(0);
  });
});
