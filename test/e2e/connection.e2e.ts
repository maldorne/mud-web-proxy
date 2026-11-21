import { expect } from 'chai';
import { WebSocket } from 'ws';
import net from 'net';
import type { ProxyServer } from '../../src/server.js';
import type { MudRoute } from '../../src/types.js';
import {
  MockTelnetServer,
  startProxy,
  connectClient,
  sendConnect,
  waitForMessage,
} from './helpers.js';

function waitForClose(ws: WebSocket, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve(-1);
    const timeout = setTimeout(
      () => reject(new Error('Timeout waiting for WS close')),
      timeoutMs,
    );
    ws.once('close', (code: number) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

/** Port with nothing listening on it (bind, read port, release). */
function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function withProxy(
  routes: (telnetPort: number) => Record<string, MudRoute>,
  overrides: Parameters<typeof startProxy>[1] = {},
) {
  const telnet = new MockTelnetServer();
  await telnet.start();
  const { proxy, port } = await startProxy(telnet.port, {
    routes: routes(telnet.port),
    ...overrides,
  });
  return { telnet, proxy, port };
}

describe('E2E: connection', function () {
  this.timeout(10_000);

  describe('PROXY protocol', () => {
    let telnet: MockTelnetServer;
    let proxy: ProxyServer;
    let port: number;

    before(async () => {
      ({ telnet, proxy, port } = await withProxy((p) => ({
        pp: { host: '127.0.0.1', port: p, proxyProtocol: true },
        plain: { host: '127.0.0.1', port: p },
      })));
    });

    after(async () => {
      await proxy.shutdown();
      await telnet.stop();
    });

    it('should send a PROXY v1 header before any other data', async () => {
      const ws = await connectClient(port);
      sendConnect(ws, { mud: 'pp' });
      await telnet.waitForConnection();

      const data = await telnet.waitForReceived((d) => d.includes('\r\n'));
      const firstLine = data.toString('latin1').split('\r\n')[0];
      expect(firstLine).to.match(/^PROXY TCP4 \S+ 127\.0\.0\.1 0 \d+$/);
      expect(firstLine).to.include('127.0.0.1');
      ws.close();
    });

    it('should not send a PROXY header on routes without proxyProtocol', async () => {
      const ws = await connectClient(port);
      sendConnect(ws, { mud: 'plain' });
      await telnet.waitForConnection();

      ws.send('look\r\n');
      const data = await telnet.waitForReceived((d) => d.includes('look'));
      expect(data.toString('latin1')).to.not.include('PROXY');
      ws.close();
    });
  });

  describe('client messages to the MUD', () => {
    let telnet: MockTelnetServer;
    let proxy: ProxyServer;
    let port: number;

    before(async () => {
      ({ telnet, proxy, port } = await withProxy((p) => ({
        'test-mud': { host: '127.0.0.1', port: p },
      })));
    });

    after(async () => {
      await proxy.shutdown();
      await telnet.stop();
    });

    it('should write bin bytes verbatim', async () => {
      const ws = await connectClient(port);
      sendConnect(ws, { mud: 'test-mud' });
      await telnet.waitForConnection();

      const bytes = [255, 251, 31, 0, 200];
      ws.send(JSON.stringify({ bin: bytes }));
      const data = await telnet.waitForReceived((d) =>
        d.includes(Buffer.from(bytes)),
      );
      expect(data.includes(Buffer.from(bytes))).to.be.true;
      ws.close();
    });

    it('should wrap gmcp messages in IAC SB GMCP ... IAC SE', async () => {
      const ws = await connectClient(port);
      sendConnect(ws, { mud: 'test-mud' });
      await telnet.waitForConnection();

      ws.send(JSON.stringify({ gmcp: 'Core.Ping' }));
      const expected = Buffer.concat([
        Buffer.from([255, 250, 201]),
        Buffer.from('Core.Ping'),
        Buffer.from([255, 240]),
      ]);
      const data = await telnet.waitForReceived((d) => d.includes(expected));
      expect(data.includes(expected)).to.be.true;
      ws.close();
    });

    it('should encode msdp messages as MSDP_VAR/MSDP_VAL pairs', async () => {
      const ws = await connectClient(port);
      sendConnect(ws, { mud: 'test-mud' });
      await telnet.waitForConnection();

      ws.send(JSON.stringify({ msdp: { key: 'SEND', val: 'HEALTH' } }));
      const expected = Buffer.concat([
        Buffer.from([255, 250, 69, 1]),
        Buffer.from('SEND'),
        Buffer.from([2]),
        Buffer.from('HEALTH'),
        Buffer.from([255, 240]),
      ]);
      const data = await telnet.waitForReceived((d) => d.includes(expected));
      expect(data.includes(expected)).to.be.true;
      ws.close();
    });

    it('should ignore invalid JSON without closing the connection', async () => {
      const ws = await connectClient(port);
      sendConnect(ws, { mud: 'test-mud' });
      await telnet.waitForConnection();

      ws.send('{not json');
      ws.send(JSON.stringify({ port: 'nope' }));
      ws.send('still here\r\n');
      await telnet.waitForReceived((d) => d.includes('still here'));
      expect(ws.readyState).to.equal(WebSocket.OPEN);
      ws.close();
    });
  });

  describe('non-UTF-8 route', () => {
    let telnet: MockTelnetServer;
    let proxy: ProxyServer;
    let port: number;

    before(async () => {
      ({ telnet, proxy, port } = await withProxy((p) => ({
        latin1: { host: '127.0.0.1', port: p, encoding: 'latin1' },
      })));
    });

    after(async () => {
      await proxy.shutdown();
      await telnet.stop();
    });

    it('should decode MUD output from latin1 to UTF-8', async () => {
      const ws = await connectClient(port);
      sendConnect(ws, { mud: 'latin1' });
      await telnet.waitForConnection();

      telnet.send(Buffer.from('Año, cañón\r\n', 'latin1'));
      const msg = await waitForMessage(ws);
      expect(msg).to.include('Año, cañón');
      ws.close();
    });

    it('should encode client input from UTF-8 to latin1', async () => {
      const ws = await connectClient(port);
      sendConnect(ws, { mud: 'latin1' });
      await telnet.waitForConnection();

      ws.send('decir señor\r\n');
      const expected = Buffer.from('decir señor', 'latin1');
      const data = await telnet.waitForReceived((d) => d.includes(expected));
      expect(data.includes(expected)).to.be.true;
      ws.close();
    });
  });

  describe('MUD connection lifecycle', () => {
    let telnet: MockTelnetServer;
    let proxy: ProxyServer;
    let port: number;
    let deadPort: number;

    before(async () => {
      deadPort = await closedPort();
      ({ telnet, proxy, port } = await withProxy((p) => ({
        'test-mud': { host: '127.0.0.1', port: p },
        dead: { host: '127.0.0.1', port: deadPort },
      })));
    });

    after(async () => {
      await proxy.shutdown();
      await telnet.stop();
    });

    it('should report an error and close when the MUD is unreachable', async () => {
      const ws = await connectClient(port);
      const closed = waitForClose(ws);
      sendConnect(ws, { mud: 'dead' });

      const msg = await waitForMessage(ws);
      expect(msg).to.include('could not connect');
      await closed;
    });

    it('should close the WebSocket when the MUD drops the connection', async () => {
      const ws = await connectClient(port);
      sendConnect(ws, { mud: 'test-mud' });
      await telnet.waitForConnection();

      const closed = waitForClose(ws);
      telnet.dropLatest();
      await closed;
      expect(ws.readyState).to.equal(WebSocket.CLOSED);
    });
  });

  describe('timeouts', () => {
    let telnet: MockTelnetServer;
    let proxy: ProxyServer;
    let port: number;

    before(async () => {
      ({ telnet, proxy, port } = await withProxy(
        (p) => ({ 'test-mud': { host: '127.0.0.1', port: p } }),
        { idleTimeoutMs: 300, pingIntervalMs: 200, pongTimeoutMs: 200 },
      ));
    });

    after(async () => {
      await proxy.shutdown();
      await telnet.stop();
    });

    it('should close idle connections with a notice', async () => {
      const ws = await connectClient(port);
      const messages: string[] = [];
      ws.on('message', (m) => messages.push(m.toString()));
      const closed = waitForClose(ws);
      sendConnect(ws, { mud: 'test-mud' });

      await closed;
      expect(messages.join('')).to.include('Idle timeout');
    });

    it('should close connections that do not answer pings', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { autoPong: false });
      await new Promise((resolve) => ws.once('open', resolve));
      let pinged = false;
      ws.on('ping', () => (pinged = true));

      await waitForClose(ws);
      expect(pinged).to.be.true;
    });
  });
});
