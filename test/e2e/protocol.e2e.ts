import { expect } from 'chai';
import type { ProxyServer } from '../../src/server.js';
import {
  startProxy,
  connectClient,
  sendConnect,
  waitForMessage,
  collectMessages,
} from './helpers.js';
import { MockTelnetMud } from './mock-telnet-mud.js';

describe('E2E: telnet protocol negotiation', function () {
  this.timeout(15000);

  let mud: MockTelnetMud;
  let proxy: ProxyServer;
  let proxyPort: number;

  before(async () => {
    mud = new MockTelnetMud();
    await mud.start();
    const result = await startProxy(mud.port);
    proxy = result.proxy;
    proxyPort = result.port;
  });

  after(async () => {
    await proxy.shutdown();
    await mud.stop();
  });

  beforeEach(() => {
    mud.reset();
  });

  it('should negotiate GMCP with the MUD server', async () => {
    const ws = await connectClient(proxyPort);
    sendConnect(ws, { mud: 'test-mud' });
    await mud.waitForConnection();

    // Wait for negotiation to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mud.negotiated.gmcp).to.be.true;
    expect(mud.gmcpMessages.length).to.be.greaterThan(0);

    // Should have sent client info
    const clientMsg = mud.gmcpMessages.find((m) => m.startsWith('client '));
    expect(clientMsg).to.exist;

    ws.close();
  });

  it('should negotiate MSDP with the MUD server', async () => {
    const ws = await connectClient(proxyPort);
    sendConnect(ws, { mud: 'test-mud' });
    await mud.waitForConnection();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mud.negotiated.msdp).to.be.true;
    expect(mud.msdpPairs.length).to.be.greaterThan(0);

    // Should have sent CLIENT_ID
    const clientId = mud.msdpPairs.find((p) => p.key === 'CLIENT_ID');
    expect(clientId).to.exist;

    ws.close();
  });

  it('should negotiate MXP with the MUD server', async () => {
    const ws = await connectClient(proxyPort);
    sendConnect(ws, { mud: 'test-mud' });
    await mud.waitForConnection();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mud.negotiated.mxp).to.be.true;

    ws.close();
  });

  it('should negotiate TTYPE with the MUD server', async () => {
    const ws = await connectClient(proxyPort);
    sendConnect(ws, { mud: 'test-mud' });
    await mud.waitForConnection();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mud.negotiated.ttype).to.be.true;

    ws.close();
  });

  it('should receive welcome message through protocol negotiation', async () => {
    const ws = await connectClient(proxyPort);
    sendConnect(ws, { mud: 'test-mud' });
    await mud.waitForConnection();

    const messages = await collectMessages(ws, 1000);
    const combined = messages.join('');

    expect(combined).to.include('Welcome to MockMUD!');

    ws.close();
  });

  it('should forward GMCP from MUD to client', async () => {
    const ws = await connectClient(proxyPort);
    sendConnect(ws, { mud: 'test-mud' });
    await mud.waitForConnection();

    // Wait for negotiation to settle
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Drain any pending negotiation messages
    await collectMessages(ws, 200);

    // Set up listener BEFORE sending GMCP to avoid race condition
    const messagePromise = waitForMessage(ws, 3000);

    // MUD sends a GMCP message
    mud.sendGMCP('Char.Status {"hp":100,"mp":50}');

    // The GMCP data should arrive as part of the telnet stream
    const received = await messagePromise;
    expect(received.length).to.be.greaterThan(0);

    ws.close();
  });

  it('should forward game text from MUD to client', async () => {
    const ws = await connectClient(proxyPort);
    sendConnect(ws, { mud: 'test-mud' });
    await mud.waitForConnection();

    // Wait for negotiation
    await new Promise((resolve) => setTimeout(resolve, 300));

    mud.send('You are standing in a dark room.\r\n');
    mud.send('Exits: north, south, east\r\n');

    const messages = await collectMessages(ws, 500);
    const combined = messages.join('');

    expect(combined).to.include('dark room');
    expect(combined).to.include('Exits');

    ws.close();
  });
});
