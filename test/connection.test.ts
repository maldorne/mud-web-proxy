import { expect } from 'chai';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { Connection } from '../src/connection.js';
import { loadConfig } from '../src/config.js';
import { Router } from '../src/router.js';
import type { ProxyConfig } from '../src/types.js';

/** Minimal WebSocket stub that extends EventEmitter for .on/.emit */
function mockWs(readyState = 1 /* OPEN */) {
  const ws = new EventEmitter() as EventEmitter & {
    readyState: number;
    send: sinon.SinonStub;
    ping: sinon.SinonStub;
    close: sinon.SinonStub;
  };
  ws.readyState = readyState;
  ws.send = sinon.stub();
  ws.ping = sinon.stub();
  ws.close = sinon.stub();
  return ws;
}

function testConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  process.env.LOG_LEVEL = 'silent';
  process.env.ENABLE_LEGACY_ROUTING = 'true';
  process.env.DEFAULT_HOST = '127.0.0.1';
  process.env.DEFAULT_PORT = '9999';
  process.env.MUD_ROUTES = JSON.stringify({
    'test-mud': { host: '127.0.0.1', port: 9999 },
  });
  return { ...loadConfig(), reconnectAttempts: 0, ...overrides };
}

describe('Connection', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('handleClientMessage', () => {
    it('should set name, client, and mudId from connect message', () => {
      const ws = mockWs();
      const config = testConfig();
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      expect(conn.name).to.equal(undefined);

      // Simulate a connect message (won't actually connect TCP since host is unreachable)
      ws.emit(
        'message',
        Buffer.from(
          JSON.stringify({
            name: 'Player1',
            client: 'TestClient',
            mud: 'test-mud',
            connect: 1,
            utf8: 1,
          }),
        ),
      );

      expect(conn.name).to.equal('Player1');
      expect(conn.client).to.equal('TestClient');
      expect(conn.mudId).to.equal('test-mud');

      conn.close();
    });

    it('should set mccp flag when client requests it', () => {
      const ws = mockWs();
      const config = testConfig();
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      expect(conn.mccp).to.equal(false);

      ws.emit(
        'message',
        Buffer.from(JSON.stringify({ mccp: 1, mud: 'test-mud', connect: 1 })),
      );

      expect(conn.mccp).to.equal(true);

      conn.close();
    });

    it('should forward plain text to MUD when connected', () => {
      const ws = mockWs();
      const config = testConfig();
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      // Simulate a TCP socket
      const tcpStub = new EventEmitter() as EventEmitter & {
        writable: boolean;
        write: sinon.SinonStub;
        destroy: sinon.SinonStub;
        removeAllListeners: sinon.SinonStub;
        setTimeout: sinon.SinonStub;
      };
      tcpStub.writable = true;
      tcpStub.write = sinon.stub();
      tcpStub.destroy = sinon.stub();
      tcpStub.removeAllListeners = sinon.stub();
      tcpStub.setTimeout = sinon.stub();
      conn.tcp = tcpStub as never;

      ws.emit('message', Buffer.from('look\r\n'));

      expect(tcpStub.write.calledOnce).to.equal(true);

      conn.close();
    });

    it('should reject invalid JSON gracefully', () => {
      const ws = mockWs();
      const config = testConfig();
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      // Should not throw
      ws.emit('message', Buffer.from('{invalid json'));

      conn.close();
    });
  });

  describe('sendToClient', () => {
    it('should send raw buffer when compress is disabled', () => {
      const ws = mockWs();
      const config = testConfig({ compress: false });
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      conn.sendToClient(Buffer.from('hello'));

      expect(ws.send.calledOnce).to.equal(true);
      expect(ws.send.firstCall.args[0].toString()).to.equal('hello');

      conn.close();
    });

    it('should send raw buffer when compress is enabled but mccp is false', () => {
      const ws = mockWs();
      const config = testConfig({ compress: true });
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      conn.mccp = false;
      conn.sendToClient(Buffer.from('hello'));

      expect(ws.send.calledOnce).to.equal(true);
      expect(ws.send.firstCall.args[0].toString()).to.equal('hello');

      conn.close();
    });

    it('should send compressed base64 when compress and mccp are enabled', (done) => {
      const ws = mockWs();
      const config = testConfig({ compress: true });
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      conn.mccp = true;
      conn.sendToClient(Buffer.from('compressed data'));

      // deflateRaw is async, wait for it
      setTimeout(() => {
        expect(ws.send.calledOnce).to.equal(true);
        const sent = ws.send.firstCall.args[0] as string;
        // Should be base64 string
        expect(typeof sent).to.equal('string');
        expect(() => Buffer.from(sent, 'base64')).to.not.throw();
        conn.close();
        done();
      }, 100);
    });

    it('should not send when ws is not open', () => {
      const ws = mockWs(3 /* CLOSED */);
      const config = testConfig();
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      conn.sendToClient(Buffer.from('hello'));

      expect(ws.send.called).to.equal(false);

      conn.close();
    });
  });

  describe('sendMessage', () => {
    it('should send raw buffer when not compressing', () => {
      const ws = mockWs();
      const config = testConfig({ compress: false });
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      conn.sendMessage('test message');

      expect(ws.send.calledOnce).to.equal(true);

      conn.close();
    });
  });

  describe('close', () => {
    it('should clean up and call onClose callback', () => {
      const ws = mockWs();
      const config = testConfig();
      const router = new Router(config);
      const onClose = sinon.stub();
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        onClose,
      );

      conn.close();

      expect(onClose.calledOnce).to.equal(true);
      expect(onClose.firstCall.args[0]).to.equal(conn);
      expect(ws.close.calledOnce).to.equal(true);
    });

    it('should not close twice', () => {
      const ws = mockWs();
      const config = testConfig();
      const router = new Router(config);
      const onClose = sinon.stub();
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        onClose,
      );

      conn.close();
      conn.close();

      expect(onClose.calledOnce).to.equal(true);
    });
  });

  describe('applyEncoding', () => {
    it('should parse simple encoding', () => {
      const ws = mockWs();
      const config = testConfig();
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      Connection.applyEncoding(conn, 'latin1');

      expect(conn.encoding).to.equal('latin1');
      expect(conn.fallbackEncoding).to.equal(null);

      conn.close();
    });

    it('should parse encoding with fallback', () => {
      const ws = mockWs();
      const config = testConfig();
      const router = new Router(config);
      const conn = new Connection(
        ws as never,
        '127.0.0.1',
        config,
        router,
        () => {},
      );

      Connection.applyEncoding(conn, 'utf8/latin1');

      expect(conn.encoding).to.equal('utf8');
      expect(conn.fallbackEncoding).to.equal('latin1');

      conn.close();
    });
  });

  describe('decodeWithFallback', () => {
    it('should decode pure ASCII unchanged', () => {
      const result = Connection.decodeWithFallback(
        Buffer.from('Hello world'),
        'latin1',
      );
      expect(result).to.equal('Hello world');
    });

    it('should decode valid UTF-8 correctly', () => {
      const result = Connection.decodeWithFallback(
        Buffer.from('café'),
        'latin1',
      );
      expect(result).to.equal('café');
    });

    it('should fall back to latin1 for invalid UTF-8 bytes', () => {
      // 0xe9 is 'é' in latin1 but invalid standalone UTF-8
      const buf = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "caf" + 0xe9
      const result = Connection.decodeWithFallback(buf, 'latin1');
      expect(result).to.equal('café');
    });

    it('should handle mixed UTF-8 and latin1 in same buffer', () => {
      // "ñ" in UTF-8 (0xc3 0xb1) + "é" in latin1 (0xe9)
      const buf = Buffer.concat([
        Buffer.from([0xc3, 0xb1]), // ñ in UTF-8
        Buffer.from([0xe9]), // é in latin1
      ]);
      const result = Connection.decodeWithFallback(buf, 'latin1');
      expect(result).to.equal('ñé');
    });

    it('should handle 3-byte UTF-8 characters', () => {
      // Euro sign: U+20AC = 0xE2 0x82 0xAC
      const buf = Buffer.from([0xe2, 0x82, 0xac]);
      const result = Connection.decodeWithFallback(buf, 'latin1');
      expect(result).to.equal('€');
    });

    it('should handle 4-byte UTF-8 characters', () => {
      // Emoji: U+1F600 = 0xF0 0x9F 0x98 0x80
      const buf = Buffer.from([0xf0, 0x9f, 0x98, 0x80]);
      const result = Connection.decodeWithFallback(buf, 'latin1');
      expect(result).to.equal('😀');
    });
  });
});
