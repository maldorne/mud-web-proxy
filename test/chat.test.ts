import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import { Chat } from '../src/chat.js';
import { loadConfig } from '../src/config.js';
import type { Connection } from '../src/connection.js';

function mockConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    remoteAddress: '127.0.0.1',
    name: 'TestUser',
    mudId: 'test-mud',
    tcp: null,
    ws: {
      send: sinon.stub(),
    },
    ...overrides,
  } as unknown as Connection;
}

describe('Chat', () => {
  let readStub: sinon.SinonStub;
  let writeStub: sinon.SinonStub;

  beforeEach(() => {
    readStub = sinon.stub(fs, 'readFileSync');
    writeStub = sinon.stub(fs, 'writeFileSync');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should load chat log from disk on construction', () => {
    readStub.returns(JSON.stringify([{ date: '2026-01-01', msg: 'hello' }]));

    const connections: Connection[] = [];
    const chat = new Chat(loadConfig(), () => connections);

    expect(readStub.calledOnce).to.be.true;
    expect(chat).to.exist;
  });

  it('should handle missing chat log file gracefully', () => {
    readStub.throws(new Error('ENOENT'));

    const connections: Connection[] = [];
    const chat = new Chat(loadConfig(), () => connections);

    expect(chat).to.exist;
  });

  it('should save chat log to disk', () => {
    readStub.throws(new Error('ENOENT'));

    const connections: Connection[] = [];
    const chat = new Chat(loadConfig(), () => connections);

    chat.saveToDisk();
    expect(writeStub.calledOnce).to.be.true;
  });

  it('should broadcast a chat message to all connections', () => {
    readStub.throws(new Error('ENOENT'));

    const conn1 = mockConnection({ name: 'User1' });
    const conn2 = mockConnection({ name: 'User2' });
    const connections = [conn1, conn2];
    const chat = new Chat(loadConfig(), () => connections);

    chat.handleChat(conn1, {
      chat: 1,
      channel: 'general',
      name: 'User1',
      msg: 'Hello everyone!',
    });

    const send1 = conn1.ws.send as sinon.SinonStub;
    const send2 = conn2.ws.send as sinon.SinonStub;
    expect(send1.calledOnce).to.be.true;
    expect(send2.calledOnce).to.be.true;
    expect(send1.firstCall.args[0]).to.include('"type":"chat"');
    expect(send1.firstCall.args[0]).to.include('Hello everyone!');
  });

  it('should send chat log on channel=op', () => {
    readStub.throws(new Error('ENOENT'));

    const conn = mockConnection({ name: 'User1' });
    const connections = [conn];
    const chat = new Chat(loadConfig(), () => connections);

    chat.handleChat(conn, { chat: 1, channel: 'op' });

    const send = conn.ws.send as sinon.SinonStub;
    expect(send.calledOnce).to.be.true;
    expect(send.firstCall.args[0]).to.include('"type":"chatlog"');
    expect(send.firstCall.args[0]).to.include('online:');
  });

  it('should include online users in chatlog status', () => {
    readStub.throws(new Error('ENOENT'));

    const conn1 = mockConnection({
      name: 'Alice',
      tcp: {} as Connection['tcp'],
      mudId: 'iluminado',
    });
    const conn2 = mockConnection({ name: 'Bob' });
    const connections = [conn1, conn2];
    const chat = new Chat(loadConfig(), () => connections);

    chat.handleChat(conn1, { chat: 1, channel: 'op' });

    const send = conn1.ws.send as sinon.SinonStub;
    const msg = send.firstCall.args[0] as string;
    expect(msg).to.include('Alice@iluminado');
    expect(msg).to.include('Bob@chat');
  });

  it('should sanitize HTML in chat messages', () => {
    readStub.throws(new Error('ENOENT'));

    const conn = mockConnection();
    const connections = [conn];
    const chat = new Chat(loadConfig(), () => connections);

    chat.handleChat(conn, {
      chat: 1,
      msg: 'a<script>alert(1)</script>b',
    });

    const send = conn.ws.send as sinon.SinonStub;
    const msg = send.firstCall.args[0] as string;
    expect(msg).to.not.include('<script>');
    expect(msg).to.include('&lt;script&gt;');
  });

  it('should send update to all connections', () => {
    readStub.throws(new Error('ENOENT'));

    const conn = mockConnection();
    const connections = [conn];
    const chat = new Chat(loadConfig(), () => connections);

    chat.sendUpdate();

    const send = conn.ws.send as sinon.SinonStub;
    expect(send.called).to.be.true;
  });

  it('should trim log to maxSize', () => {
    readStub.throws(new Error('ENOENT'));

    process.env.CHAT_MAX_LOG_SIZE = '3';
    const conn = mockConnection();
    const connections = [conn];
    const chat = new Chat(loadConfig(), () => connections);

    for (let i = 0; i < 5; i++) {
      chat.handleChat(conn, { chat: 1, msg: `msg${i}` });
    }

    // Request chatlog to verify size
    chat.handleChat(conn, { chat: 1, channel: 'op' });

    const send = conn.ws.send as sinon.SinonStub;
    const lastCall = send.lastCall.args[0] as string;
    expect(lastCall).to.include('"type":"chatlog"');
    // Should not contain msg0 or msg1 (trimmed)
    expect(lastCall).to.not.include('msg0');

    delete process.env.CHAT_MAX_LOG_SIZE;
  });
});
