import { expect } from 'chai';
import sinon from 'sinon';
import type { ConnectionState } from '../../src/types.js';
import * as T from '../../src/telnet/constants.js';
import { TtypeHandler } from '../../src/telnet/handlers/ttype.js';
import { NewEnvHandler } from '../../src/telnet/handlers/newenv.js';
import { MccpHandler } from '../../src/telnet/handlers/mccp.js';
import { NawsHandler } from '../../src/telnet/handlers/naws.js';
import { MsdpHandler } from '../../src/telnet/handlers/msdp.js';
import { MxpHandler } from '../../src/telnet/handlers/mxp.js';
import { SgaHandler } from '../../src/telnet/handlers/sga.js';
import { EchoHandler } from '../../src/telnet/handlers/echo.js';
import { CharsetHandler } from '../../src/telnet/handlers/charset.js';
import { GmcpHandler } from '../../src/telnet/handlers/gmcp.js';

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

describe('TtypeHandler', () => {
  it('should send first TTYPE on IAC DO TTYPE', () => {
    const handler = new TtypeHandler();
    const conn = makeConnection({ ttype: ['XTERM', 'VT100'] });

    handler.handleIAC(T.DO, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.called).to.be.true;
    expect(conn.ttype).to.deep.equal(['VT100']);
  });

  it('should send next TTYPE on SB REQUEST', () => {
    const handler = new TtypeHandler();
    const conn = makeConnection({ ttype: ['VT100'] });

    handler.handleSB(Buffer.from([T.REQUEST]), conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.called).to.be.true;
    expect(conn.ttype).to.deep.equal([]);
    expect(handler.negotiated).to.be.true;
  });

  it('should not send if ttype list is empty', () => {
    const handler = new TtypeHandler();
    const conn = makeConnection({ ttype: [] });

    handler.handleIAC(T.DO, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.called).to.be.false;
  });

  it('should manage timeout lifecycle', () => {
    const handler = new TtypeHandler();
    handler.startTimeout();
    expect(handler.negotiated).to.be.false;
    handler.clearTimeout();
  });
});

describe('NewEnvHandler', () => {
  it('should respond WILL NEW-ENV on IAC DO', () => {
    const handler = new NewEnvHandler();
    const conn = makeConnection();

    handler.handleIAC(T.DO, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
    const buf = writeTcp.firstCall.args[0] as Buffer;
    expect(buf[0]).to.equal(T.IAC);
    expect(buf[1]).to.equal(T.WILL);
    expect(buf[2]).to.equal(T.NEW_ENVIRON);
  });

  it('should send IPADDRESS on SB REQUEST', () => {
    const handler = new NewEnvHandler();
    const conn = makeConnection({ remoteAddress: '10.0.0.1' });

    handler.handleSB(Buffer.from([T.REQUEST]), conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
    const buf = writeTcp.firstCall.args[0] as Buffer;
    expect(buf.toString()).to.include('IPADDRESS');
    expect(buf.toString()).to.include('10.0.0.1');
    expect(handler.negotiated).to.be.true;
  });

  it('should not send IPADDRESS twice', () => {
    const handler = new NewEnvHandler();
    const conn = makeConnection();

    handler.handleSB(Buffer.from([T.REQUEST]), conn);
    handler.handleSB(Buffer.from([T.REQUEST]), conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
  });

  it('should manage timeout lifecycle', () => {
    const handler = new NewEnvHandler();
    handler.startTimeout();
    handler.clearTimeout();
    expect(handler.negotiated).to.be.false;
  });
});

describe('MccpHandler', () => {
  it('should schedule DO MCCP2 on IAC WILL', function (done) {
    this.timeout(7000);
    const handler = new MccpHandler();
    const conn = makeConnection();

    handler.handleIAC(T.WILL, conn);

    setTimeout(() => {
      const writeTcp = conn.writeTcp as sinon.SinonStub;
      expect(writeTcp.calledOnce).to.be.true;
      done();
    }, 6100);
  });

  it('should set compressed on handleSB', () => {
    const handler = new MccpHandler();
    const conn = makeConnection();

    handler.handleSB(Buffer.alloc(0), conn);

    expect(conn.compressed).to.be.true;
    expect(handler.negotiated).to.be.true;
  });

  it('should return null from scanBuffer when mccp is disabled', () => {
    const handler = new MccpHandler();
    const conn = makeConnection({ mccp: false });

    const result = handler.scanBuffer(Buffer.from([1, 2, 3]), conn);
    expect(result).to.be.null;
  });

  it('should return null from scanBuffer when already negotiated', () => {
    const handler = new MccpHandler();
    handler.negotiated = true;
    const conn = makeConnection({ mccp: true });

    const result = handler.scanBuffer(Buffer.from([1, 2, 3]), conn);
    expect(result).to.be.null;
  });

  it('should detect MCCP SB mid-buffer', () => {
    const handler = new MccpHandler();
    const conn = makeConnection({ mccp: true });

    // "Hello" + IAC SB MCCP2 IAC SE + "compressed"
    const before = Buffer.from('Hello');
    const mccpSeq = Buffer.from([T.IAC, T.SB, T.MCCP2, T.IAC, T.SE]);
    const after = Buffer.from('compressed');
    const data = Buffer.concat([before, mccpSeq, after]);

    const result = handler.scanBuffer(data, conn);

    expect(result).to.not.be.null;
    expect(result!.started).to.be.true;
    expect(result!.before!.toString()).to.equal('Hello');
    expect(result!.after.toString()).to.equal('compressed');
    expect(conn.compressed).to.be.true;
  });

  it('should return null before for MCCP SB at buffer start', () => {
    const handler = new MccpHandler();
    const conn = makeConnection({ mccp: true });

    const data = Buffer.from([T.IAC, T.SB, T.MCCP2, T.IAC, T.SE, 65, 66]);
    const result = handler.scanBuffer(data, conn);

    expect(result).to.not.be.null;
    expect(result!.before).to.be.null;
    expect(result!.after.toString()).to.equal('AB');
  });

  it('should manage timeout lifecycle', () => {
    const handler = new MccpHandler();
    handler.startTimeout();
    handler.clearTimeout();
    expect(handler.negotiated).to.be.false;
  });
});

describe('NawsHandler', () => {
  it('should respond WONT NAWS on IAC DO', () => {
    const handler = new NawsHandler();
    const conn = makeConnection();

    handler.handleIAC(T.DO, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
    const buf = writeTcp.firstCall.args[0] as Buffer;
    expect(buf[1]).to.equal(T.WONT);
    expect(buf[2]).to.equal(T.NAWS);
    expect(handler.negotiated).to.be.true;
  });

  it('should respond WONT NAWS on IAC WILL', () => {
    const handler = new NawsHandler();
    const conn = makeConnection();

    handler.handleIAC(T.WILL, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
    expect(handler.negotiated).to.be.true;
  });

  it('should manage timeout lifecycle', () => {
    const handler = new NawsHandler();
    handler.startTimeout();
    handler.clearTimeout();
  });
});

describe('MsdpHandler', () => {
  it('should send MSDP pairs with single value', () => {
    const handler = new MsdpHandler();
    const conn = makeConnection();

    handler.sendMSDP(conn, { key: 'LIST', val: 'COMMANDS' });

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
    const buf = writeTcp.firstCall.args[0] as Buffer;
    expect(buf.toString()).to.include('LIST');
    expect(buf.toString()).to.include('COMMANDS');
  });

  it('should send MSDP pairs with array value', () => {
    const handler = new MsdpHandler();
    const conn = makeConnection();

    handler.sendMSDP(conn, { key: 'LIST', val: ['FOO', 'BAR'] });

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
    const buf = writeTcp.firstCall.args[0] as Buffer;
    expect(buf.toString()).to.include('FOO');
    expect(buf.toString()).to.include('BAR');
  });

  it('should skip if key or val is missing', () => {
    const handler = new MsdpHandler();
    const conn = makeConnection();

    handler.sendMSDP(conn, { key: '', val: 'x' });

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.called).to.be.false;
  });

  it('should manage timeout lifecycle', () => {
    const handler = new MsdpHandler();
    handler.startTimeout();
    handler.clearTimeout();
  });
});

describe('MxpHandler', () => {
  it('should respond WILL MXP on IAC DO', () => {
    const handler = new MxpHandler();
    const conn = makeConnection();

    handler.handleIAC(T.DO, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    const buf = writeTcp.firstCall.args[0] as Buffer;
    expect(buf[1]).to.equal(T.WILL);
    expect(buf[2]).to.equal(T.MXP);
    expect(handler.negotiated).to.be.true;
  });

  it('should respond DO MXP on IAC WILL', () => {
    const handler = new MxpHandler();
    const conn = makeConnection();

    handler.handleIAC(T.WILL, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    const buf = writeTcp.firstCall.args[0] as Buffer;
    expect(buf[1]).to.equal(T.DO);
    expect(buf[2]).to.equal(T.MXP);
  });

  it('should manage timeout lifecycle', () => {
    const handler = new MxpHandler();
    handler.startTimeout();
    handler.clearTimeout();
  });
});

describe('SgaHandler', () => {
  it('should respond WONT SGA on IAC WILL', () => {
    const handler = new SgaHandler();
    const conn = makeConnection();

    handler.handleIAC(T.WILL, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    const buf = writeTcp.firstCall.args[0] as Buffer;
    expect(buf[1]).to.equal(T.WONT);
    expect(buf[2]).to.equal(T.SGA);
    expect(handler.negotiated).to.be.true;
  });

  it('should not respond to IAC DO', () => {
    const handler = new SgaHandler();
    const conn = makeConnection();

    handler.handleIAC(T.DO, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.called).to.be.false;
  });

  it('should manage timeout lifecycle', () => {
    const handler = new SgaHandler();
    handler.startTimeout();
    handler.clearTimeout();
  });
});

describe('EchoHandler', () => {
  it('should set password mode on IAC WILL', () => {
    const handler = new EchoHandler();
    const conn = makeConnection();

    handler.handleIAC(T.WILL, conn);

    expect(conn.passwordMode).to.be.true;
    expect(handler.negotiated).to.be.true;
  });

  it('should not set password mode on IAC DO', () => {
    const handler = new EchoHandler();
    const conn = makeConnection();

    handler.handleIAC(T.DO, conn);

    expect(conn.passwordMode).to.be.false;
    expect(handler.negotiated).to.be.false;
  });

  it('should manage timeout lifecycle', () => {
    const handler = new EchoHandler();
    handler.startTimeout();
    handler.clearTimeout();
  });
});

describe('CharsetHandler', () => {
  it('should respond WILL CHARSET on IAC DO', () => {
    const handler = new CharsetHandler();
    const conn = makeConnection();

    handler.handleIAC(T.DO, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.calledOnce).to.be.true;
  });

  it('should accept UTF-8 on handleSB and set utf8 flag', () => {
    const handler = new CharsetHandler();
    const conn = makeConnection();

    handler.handleSB(Buffer.from([T.REQUEST]), conn);

    expect(conn.utf8).to.be.true;
    expect(handler.negotiated).to.be.true;
  });

  it('should manage timeout lifecycle', () => {
    const handler = new CharsetHandler();
    handler.startTimeout();
    handler.clearTimeout();
  });
});

describe('GmcpHandler', () => {
  it('should respond WILL GMCP on IAC DO and send handshake', () => {
    const handler = new GmcpHandler(['client test', 'client_version 1.0']);
    const conn = makeConnection({
      client: 'my-client',
      remoteAddress: '10.0.0.1',
    });

    handler.handleIAC(T.DO, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    // WILL_GMCP + client handshake + client_version + client_ip
    expect(writeTcp.callCount).to.equal(4);
    expect(handler.negotiated).to.be.true;
  });

  it('should respond DO GMCP on IAC WILL', () => {
    const handler = new GmcpHandler(['client test']);
    const conn = makeConnection({ remoteAddress: '10.0.0.1' });

    handler.handleIAC(T.WILL, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    expect(writeTcp.callCount).to.be.greaterThan(1);
    expect(handler.negotiated).to.be.true;
  });

  it('should use client name when provided for first GMCP message', () => {
    const handler = new GmcpHandler(['client default', 'client_version 1.0']);
    const conn = makeConnection({
      client: 'custom-client',
      remoteAddress: '10.0.0.1',
    });

    handler.handleIAC(T.DO, conn);

    const writeTcp = conn.writeTcp as sinon.SinonStub;
    // Second call (after WILL_GMCP) should contain custom client
    const secondBuf = writeTcp.secondCall.args[0] as Buffer;
    expect(secondBuf.toString()).to.include('custom-client');
  });

  it('should manage timeout lifecycle', () => {
    const handler = new GmcpHandler([]);
    handler.startTimeout();
    handler.clearTimeout();
  });
});
