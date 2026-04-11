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
