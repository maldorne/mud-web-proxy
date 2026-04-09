import fs from 'fs';
import type { ProxyConfig, ClientMessage } from './types.js';
import type { Connection } from './connection.js';
import { logger } from './logger.js';

interface ChatLogEntry {
  date: string;
  channel?: string;
  name?: string;
  msg?: string;
}

function safeStringify(obj: unknown): string {
  const cache = new Set<unknown>();
  return JSON.stringify(obj, (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.has(value)) return undefined;
      cache.add(value);
    }
    return value;
  });
}

function chatCleanup(text: string): string {
  /* eslint-disable no-control-regex */
  text = text.replace(/([^\x1b])</g, '$1&lt;');
  text = text.replace(/([^\x1b])>/g, '$1&gt;');
  text = text.replace(/\x1b>/g, '>');
  text = text.replace(/\x1b</g, '<');
  /* eslint-enable no-control-regex */
  return text;
}

export class Chat {
  private log: ChatLogEntry[] = [];
  private maxSize: number;
  private connections: () => Connection[];
  private chatFilePath = './chat.json';

  constructor(
    config: ProxyConfig,
    getConnections: () => Connection[],
  ) {
    this.maxSize = config.chat.maxLogSize;
    this.connections = getConnections;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      const data = fs.readFileSync(this.chatFilePath, 'utf8');
      const parsed = JSON.parse(data);
      this.log = Array.isArray(parsed) ? parsed.slice(-this.maxSize) : [];
      logger.info(`Chat log loaded: ${this.log.length} entries`);
    } catch {
      logger.info('No chat log found, starting fresh');
      this.log = [];
    }
  }

  saveToDisk(): void {
    try {
      fs.writeFileSync(this.chatFilePath, safeStringify(this.log));
      logger.info(`Chat log saved: ${this.log.length} entries`);
    } catch (err) {
      logger.error(`Failed to save chat log: ${err}`);
    }
  }

  handleChat(connection: Connection, msg: ClientMessage): void {
    logger.debug(`chat: ${safeStringify(msg)}`, connection.remoteAddress);

    if (msg.channel === 'op') {
      this.sendChatLog(connection);
      return;
    }

    const entry: ChatLogEntry = {
      date: new Date().toISOString(),
      channel: msg.channel,
      name: msg.name,
      msg: msg.msg ? chatCleanup(msg.msg) : undefined,
    };

    this.log.push(entry);

    // Ring buffer: trim to maxSize
    if (this.log.length > this.maxSize) {
      this.log = this.log.slice(-this.maxSize);
    }

    // Broadcast to all connections with chat enabled
    const broadcast = safeStringify(entry);
    for (const conn of this.connections()) {
      try {
        conn.ws.send('portal.chat ' + broadcast);
      } catch {
        // Connection may be closing
      }
    }
  }

  private sendChatLog(connection: Connection): void {
    const conns = this.connections();
    const users: string[] = [];

    for (const conn of conns) {
      const name = conn.name ?? 'Guest';
      const host = conn.tcp ? (conn.mudId ?? 'unknown') : 'chat';
      const user = `${name}@${host}`;
      if (!users.includes(user)) users.push(user);
    }

    const temp = [
      ...this.log.slice(-this.maxSize),
      {
        date: new Date().toISOString(),
        channel: 'status',
        name: 'online:',
        msg: users.join(', '),
      },
    ];

    let text = safeStringify(temp);
    text = chatCleanup(text);
    connection.ws.send('portal.chatlog ' + text);
  }

  sendUpdate(): void {
    for (const conn of this.connections()) {
      this.handleChat(conn, { chat: 1, channel: 'op' });
    }
  }
}
