import { expect } from 'chai';
import { WebSocket } from 'ws';
import type { ProxyServer } from '../../src/server.js';
import {
  MockTelnetServer,
  startProxy,
  connectClient,
  sendConnect,
} from './helpers.js';

describe('E2E: server limits and origin', () => {
  let telnet: MockTelnetServer;
  let proxy: ProxyServer;
  let proxyPort: number;

  before(async () => {
    telnet = new MockTelnetServer();
    await telnet.start();
    const result = await startProxy(telnet.port, {
      maxConnections: 2,
      allowedOrigins: ['http://allowed.example.com'],
    });
    proxy = result.proxy;
    proxyPort = result.port;
  });

  after(async () => {
    await proxy.shutdown();
    await telnet.stop();
  });

  it('should reject connections when max is reached', async function () {
    this.timeout(5000);

    const ws1 = await connectClient(proxyPort);
    const ws2 = await connectClient(proxyPort);

    // Third connection: set up message listener before connecting
    const ws3 = new WebSocket(`ws://127.0.0.1:${proxyPort}`);

    const result = await new Promise<{ msg: string; closed: boolean }>(
      (resolve) => {
        let msg = '';
        let closed = false;

        ws3.on('message', (data: Buffer) => {
          msg = data.toString();
        });
        ws3.on('close', () => {
          closed = true;
          resolve({ msg, closed });
        });

        // Fallback timeout
        setTimeout(() => resolve({ msg, closed }), 3000);
      },
    );

    expect(result.closed).to.be.true;

    ws1.close();
    ws2.close();
  });

  it('should return 503 during shutdown', async function () {
    this.timeout(5000);

    // Health check should be 200 before shutdown
    const res1 = await fetch(`http://127.0.0.1:${proxyPort}/health`);
    expect(res1.status).to.equal(200);
    const body1 = await res1.json();
    expect(body1.status).to.equal('ok');
  });
});

describe('E2E: compressed proxy', () => {
  let telnet: MockTelnetServer;
  let proxy: ProxyServer;
  let proxyPort: number;

  before(async () => {
    telnet = new MockTelnetServer();
    await telnet.start();
    const result = await startProxy(telnet.port, {
      compress: true,
    });
    proxy = result.proxy;
    proxyPort = result.port;
  });

  after(async () => {
    await proxy.shutdown();
    await telnet.stop();
  });

  it('should send zlib-compressed data when compress is enabled and client requests it', async () => {
    const ws = await connectClient(proxyPort);

    // Send connect with mccp: 1 to request compression
    ws.send(
      JSON.stringify({
        mud: 'test-mud',
        connect: 1,
        utf8: 1,
        mxp: 1,
        mccp: 1,
      }),
    );
    await telnet.waitForConnection();

    telnet.send('Compressed hello!\r\n');

    // The raw message should be base64-encoded zlib data
    const raw = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
      ws.once('message', (data: Buffer | string) => {
        clearTimeout(timeout);
        resolve(data.toString());
      });
    });

    // Verify it's base64
    expect(() => Buffer.from(raw, 'base64')).to.not.throw();

    // Decompress and verify content
    const zlib = await import('zlib');
    const buf = Buffer.from(raw, 'base64');
    const decompressed = await new Promise<string>((resolve, reject) => {
      zlib.inflateRaw(buf, (err, result) => {
        if (err) reject(err);
        else resolve(result.toString());
      });
    });

    expect(decompressed).to.include('Compressed hello!');

    ws.close();
  });

  it('should send raw data when compress is enabled but client sends mccp: 0', async function () {
    const ws = await connectClient(proxyPort);

    // Collect all messages from the start
    const messages: Buffer[] = [];
    ws.on('message', (data: Buffer) => {
      messages.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    sendConnect(ws, { mud: 'test-mud' });
    await telnet.waitForConnection();

    telnet.send('Raw hello!\r\n');

    // Wait until we receive a message containing our text
    const raw = await new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
      const check = () => {
        const found = messages.find((m) =>
          m.toString('utf-8').includes('Raw hello!'),
        );
        if (found) {
          clearTimeout(timeout);
          resolve(found);
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    // Should be raw text, not base64-encoded
    const text = raw.toString('utf-8');
    expect(text).to.include('Raw hello!');

    // Verify it's NOT valid base64+zlib (would throw on inflateRawSync)
    const zlib = await import('zlib');
    let inflated = false;
    try {
      zlib.inflateRawSync(Buffer.from(text, 'base64'));
      inflated = true;
    } catch {
      // expected — raw data is not compressed
    }
    expect(inflated).to.be.false;

    ws.close();
  });
});
