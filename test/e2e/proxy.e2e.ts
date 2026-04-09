import { expect } from 'chai';
import { WebSocket } from 'ws';
import type { ProxyServer } from '../../src/server.js';
import {
  MockTelnetServer,
  startProxy,
  connectClient,
  sendConnect,
  waitForMessage,
  collectMessages,
} from './helpers.js';

describe('E2E: proxy', () => {
  let telnet: MockTelnetServer;
  let proxy: ProxyServer;
  let proxyPort: number;

  before(async () => {
    telnet = new MockTelnetServer();
    await telnet.start();
    const result = await startProxy(telnet.port);
    proxy = result.proxy;
    proxyPort = result.port;
  });

  after(async () => {
    await proxy.shutdown();
    await telnet.stop();
  });

  it('should establish a WS connection to the proxy', async () => {
    const ws = await connectClient(proxyPort);
    expect(ws.readyState).to.equal(WebSocket.OPEN);
    ws.close();
  });

  it('should proxy data from MUD server to WS client (legacy routing)', async () => {
    const ws = await connectClient(proxyPort);

    sendConnect(ws, { host: '127.0.0.1', port: telnet.port });
    await telnet.waitForConnection();

    // MUD sends data
    telnet.send('Welcome to TestMUD!\r\n');

    const msg = await waitForMessage(ws);
    expect(msg).to.include('Welcome to TestMUD!');

    ws.close();
  });

  it('should proxy data from MUD server to WS client (route by mud name)', async () => {
    const ws = await connectClient(proxyPort);

    sendConnect(ws, { mud: 'test-mud' });
    await telnet.waitForConnection();

    telnet.send('Hello from routed MUD!\r\n');

    const msg = await waitForMessage(ws);
    expect(msg).to.include('Hello from routed MUD!');

    ws.close();
  });

  it('should forward commands from WS client to MUD server', async () => {
    const ws = await connectClient(proxyPort);

    sendConnect(ws, { mud: 'test-mud' });
    await telnet.waitForConnection();

    // Collect what the telnet server receives
    const received: string[] = [];
    telnet.onData((data) => {
      received.push(data.toString());
    });

    // Send a command from the client
    ws.send('look\r\n');
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received.some((d) => d.includes('look'))).to.be.true;

    ws.close();
  });

  it('should send error for unknown mud route', async () => {
    const ws = await connectClient(proxyPort);

    sendConnect(ws, { mud: 'nonexistent-mud' });

    const msg = await waitForMessage(ws);
    expect(msg).to.include('Unknown MUD');

    // Connection should close shortly after
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(ws.readyState).to.equal(WebSocket.CLOSED);
  });

  it('should handle MUD server sending multiple messages', async () => {
    const ws = await connectClient(proxyPort);

    sendConnect(ws, { mud: 'test-mud' });
    await telnet.waitForConnection();

    const messagesPromise = collectMessages(ws, 500);

    telnet.send('Line 1\r\n');
    telnet.send('Line 2\r\n');
    telnet.send('Line 3\r\n');

    const messages = await messagesPromise;
    const combined = messages.join('');

    expect(combined).to.include('Line 1');
    expect(combined).to.include('Line 2');
    expect(combined).to.include('Line 3');

    ws.close();
  });

  it('should respond 200 on /health', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/health`);
    expect(res.status).to.equal(200);

    const body = await res.json();
    expect(body.status).to.equal('ok');
    expect(body).to.have.property('uptime');
    expect(body).to.have.property('connections');
  });

  it('should expose Prometheus metrics on /metrics', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/metrics`);
    expect(res.status).to.equal(200);

    const text = await res.text();
    expect(text).to.include('proxy_connections_total');
    expect(text).to.include('proxy_websocket_connections_active');
    expect(text).to.include('proxy_tcp_connections_active');
    expect(text).to.include('# TYPE');
    expect(text).to.include('# HELP');
  });

  it('should return 404 on unknown paths', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/unknown`);
    expect(res.status).to.equal(404);
  });
});
