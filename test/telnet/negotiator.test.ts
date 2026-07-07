import { expect } from 'chai';
import sinon from 'sinon';
import { TelnetNegotiator } from '../../src/telnet/negotiator.js';
import { loadConfig } from '../../src/config.js';
import type { ConnectionState } from '../../src/types.js';
import * as T from '../../src/telnet/constants.js';

function makeConnection(
  overrides: Partial<ConnectionState> = {},
): ConnectionState {
  return {
    remoteAddress: '127.0.0.1',
    mccp: false,
    utf8: false,
    compressed: false,
    passwordMode: false,
    debugEnabled: false,
    ttype: [],
    ws: {} as ConnectionState['ws'],
    tcp: null,
    writeTcp: sinon.stub(),
    sendToClient: sinon.stub(),
    sendJsonToClient: sinon.stub(),
    ...overrides,
  };
}

describe('TelnetNegotiator', () => {
  let negotiator: TelnetNegotiator;

  beforeEach(() => {
    negotiator = new TelnetNegotiator(loadConfig());
  });

  afterEach(() => {
    negotiator.destroy();
  });

  it('should handle IAC WILL MXP by responding with IAC DO MXP', () => {
    const conn = makeConnection();
    const data = Buffer.from([T.IAC, T.WILL, T.MXP, 65, 66, 67]); // IAC WILL MXP + "ABC"

    negotiator.processServerData(data, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
    const response = writeTcp.firstCall.args[0] as Buffer;
    expect(response[0]).to.equal(T.IAC);
    expect(response[1]).to.equal(T.DO);
    expect(response[2]).to.equal(T.MXP);
  });

  it('should handle IAC DO MXP by responding with IAC WILL MXP', () => {
    const conn = makeConnection();
    const data = Buffer.from([T.IAC, T.DO, T.MXP]);

    negotiator.processServerData(data, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
    const response = writeTcp.firstCall.args[0] as Buffer;
    expect(response[0]).to.equal(T.IAC);
    expect(response[1]).to.equal(T.WILL);
    expect(response[2]).to.equal(T.MXP);
  });

  it('should handle IAC WILL ECHO by setting password mode', () => {
    const conn = makeConnection();
    const data = Buffer.from([T.IAC, T.WILL, T.ECHO]);

    negotiator.processServerData(data, conn);

    expect(conn.passwordMode).to.be.true;
  });

  it('should handle IAC WILL SGA by responding WONT SGA', () => {
    const conn = makeConnection();
    const data = Buffer.from([T.IAC, T.WILL, T.SGA]);

    negotiator.processServerData(data, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
    const response = writeTcp.firstCall.args[0] as Buffer;
    expect(response[0]).to.equal(T.IAC);
    expect(response[1]).to.equal(T.WONT);
    expect(response[2]).to.equal(T.SGA);
  });

  it('should handle IAC WILL MSDP by responding DO MSDP and sending client info', () => {
    const conn = makeConnection({ client: 'test-client' });
    const data = Buffer.from([T.IAC, T.WILL, T.MSDP]);

    negotiator.processServerData(data, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    // DO_MSDP + 6 MSDP pairs (CLIENT_ID, CLIENT_VERSION, CLIENT_IP, XTERM_256_COLORS, MXP, UTF_8)
    expect(writeTcp.callCount).to.equal(7);
  });

  it('should handle GMCP negotiation (DO)', () => {
    const conn = makeConnection({ client: 'test-client' });
    const data = Buffer.from([T.IAC, T.DO, T.GMCP]);

    negotiator.processServerData(data, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    // WILL_GMCP + GMCP handshake messages (client, client_version, client_ip)
    expect(writeTcp.callCount).to.be.greaterThan(1);
  });

  it('should pass through non-IAC data unchanged', () => {
    const conn = makeConnection();
    const data = Buffer.from('Hello, world!');

    const result = negotiator.processServerData(data, conn);

    expect(result.toString()).to.equal('Hello, world!');
    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.called).to.be.false;
  });

  describe('chunk-boundary handling', () => {
    const GA = 249; // telnet Go Ahead, sent by LPmuds after prompts

    it('should strip IAC GA arriving complete at the end of a chunk', () => {
      const conn = makeConnection();
      const data = Buffer.concat([
        Buffer.from('> '),
        Buffer.from([T.IAC, GA]),
      ]);

      const result = negotiator.processServerData(data, conn);

      expect(result.toString()).to.equal('> ');
    });

    it('should not leak a lone trailing IAC when GA arrives in the next chunk', () => {
      const conn = makeConnection();

      const first = negotiator.processServerData(
        Buffer.concat([Buffer.from('> '), Buffer.from([T.IAC])]),
        conn,
      );
      const second = negotiator.processServerData(
        Buffer.concat([Buffer.from([GA]), Buffer.from('next')]),
        conn,
      );

      expect(first.toString()).to.equal('> ');
      expect(second.toString()).to.equal('next');
    });

    it('should complete an IAC WILL split before its option byte', () => {
      const conn = makeConnection();

      const first = negotiator.processServerData(
        Buffer.from([T.IAC, T.WILL]),
        conn,
      );
      const second = negotiator.processServerData(Buffer.from([T.ECHO]), conn);

      expect(first.length).to.equal(0);
      expect(second.length).to.equal(0);
      expect(conn.passwordMode).to.be.true;
    });

    it('should buffer an IAC SB subnegotiation split across chunks', () => {
      const conn = makeConnection();
      const payload = 'Char.Vitals {"hp":10}';
      const sb = Buffer.concat([
        Buffer.from([T.IAC, T.SB, T.GMCP]),
        Buffer.from(payload),
      ]);

      const first = negotiator.processServerData(sb.subarray(0, 10), conn);
      const second = negotiator.processServerData(
        Buffer.concat([
          sb.subarray(10),
          Buffer.from([T.IAC, T.SE]),
          Buffer.from('after'),
        ]),
        conn,
      );

      expect(first.length).to.equal(0);
      expect(second.toString()).to.equal('after');

      const sendJson = conn.sendJsonToClient as sinon.SinonStub;
      expect(sendJson.calledOnce).to.be.true;
      expect(sendJson.firstCall.args[0]).to.deep.equal({ gmcp: payload });
    });

    it('forwards GMCP subnegotiations as JSON messages, never raw telnet framing', () => {
      const conn = makeConnection();
      const payload = 'Char.Status {"hp":100}';

      negotiator.processServerData(
        Buffer.concat([
          Buffer.from([T.IAC, T.SB, T.GMCP]),
          Buffer.from(payload),
          Buffer.from([T.IAC, T.SE]),
        ]),
        conn,
      );

      const sendJson = conn.sendJsonToClient as sinon.SinonStub;
      expect(sendJson.calledOnce).to.be.true;
      expect(sendJson.firstCall.args[0]).to.deep.equal({ gmcp: payload });
      // The raw byte path must not carry the frame: on latin1 encodings
      // the 0xff framing bytes would be mangled into text.
      expect((conn.sendToClient as sinon.SinonStub).called).to.be.false;
    });

    it('forwards MSDP VAR/VAL pairs as JSON messages', () => {
      const conn = makeConnection();

      const result = negotiator.processServerData(
        Buffer.concat([
          Buffer.from([T.IAC, T.SB, T.MSDP, T.MSDP_VAR]),
          Buffer.from('HEALTH'),
          Buffer.from([T.MSDP_VAL]),
          Buffer.from('100'),
          Buffer.from([T.MSDP_VAR]),
          Buffer.from('MANA'),
          Buffer.from([T.MSDP_VAL]),
          Buffer.from('50'),
          Buffer.from([T.IAC, T.SE]),
        ]),
        conn,
      );

      expect(result.length).to.equal(0);
      const sendJson = conn.sendJsonToClient as sinon.SinonStub;
      expect(sendJson.callCount).to.equal(2);
      expect(sendJson.firstCall.args[0]).to.deep.equal({
        msdp: { key: 'HEALTH', val: '100' },
      });
      expect(sendJson.secondCall.args[0]).to.deep.equal({
        msdp: { key: 'MANA', val: '50' },
      });
      expect((conn.sendToClient as sinon.SinonStub).called).to.be.false;
    });

    it('forwards repeated MSDP VAL entries for one VAR as an array', () => {
      const conn = makeConnection();

      negotiator.processServerData(
        Buffer.concat([
          Buffer.from([T.IAC, T.SB, T.MSDP, T.MSDP_VAR]),
          Buffer.from('FLAGS'),
          Buffer.from([T.MSDP_VAL]),
          Buffer.from('pvp'),
          Buffer.from([T.MSDP_VAL]),
          Buffer.from('quiet'),
          Buffer.from([T.IAC, T.SE]),
        ]),
        conn,
      );

      const sendJson = conn.sendJsonToClient as sinon.SinonStub;
      expect(sendJson.calledOnce).to.be.true;
      expect(sendJson.firstCall.args[0]).to.deep.equal({
        msdp: { key: 'FLAGS', val: ['pvp', 'quiet'] },
      });
    });

    it('should unescape IAC IAC to a literal 0xff byte', () => {
      const conn = makeConnection();
      const data = Buffer.from([0x61, T.IAC, T.IAC, 0x62]);

      const result = negotiator.processServerData(data, conn);

      expect([...result]).to.deep.equal([0x61, 0xff, 0x62]);
    });
  });

  it('should handle CHARSET sub-negotiation for UTF-8', () => {
    const conn = makeConnection();

    // First: IAC DO CHARSET
    negotiator.processServerData(Buffer.from([T.IAC, T.DO, T.CHARSET]), conn);

    // Then: IAC SB CHARSET ... IAC SE
    negotiator.processServerData(
      Buffer.from([T.IAC, T.SB, T.CHARSET, T.REQUEST, T.IAC, T.SE]),
      conn,
    );

    expect(conn.utf8).to.be.true;
  });
});
