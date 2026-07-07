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

      const send = conn.sendToClient as sinon.SinonStub;
      expect(send.calledOnce).to.be.true;
      const forwarded = send.firstCall.args[0] as Buffer;
      expect(forwarded.subarray(3, forwarded.length - 2).toString()).to.equal(
        payload,
      );
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
