import type { TelnetOptionHandler, ConnectionState } from '../../types.js';
import * as T from '../constants.js';
import { logger } from '../../logger.js';

export class GmcpHandler implements TelnetOptionHandler {
  readonly option = T.GMCP;
  negotiated = false;
  timeoutMs = 5000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private gmcpPortal: string[];

  constructor(portal: string[]) {
    this.gmcpPortal = portal;
  }

  handleIAC(verb: number, connection: ConnectionState): void {
    if (verb === T.DO) {
      connection.writeTcp(T.WILL_GMCP);
      logger.debug('IAC DO GMCP <- IAC WILL GMCP', connection.remoteAddress);
    } else if (verb === T.WILL) {
      connection.writeTcp(T.DO_GMCP);
      logger.debug('IAC WILL GMCP <- IAC DO GMCP', connection.remoteAddress);
    }

    this.negotiated = true;
    this.clearTimeout();

    // Send GMCP handshake data
    for (let i = 0; i < this.gmcpPortal.length; i++) {
      if (i === 0 && connection.client) {
        this.sendGMCP(connection, 'client ' + connection.client);
        continue;
      }
      this.sendGMCP(connection, this.gmcpPortal[i]);
    }

    this.sendGMCP(connection, 'client_ip ' + connection.remoteAddress);
  }

  handleSB(data: Buffer, connection: ConnectionState): void {
    // Forward GMCP subnegotiation data to the client as-is (wrapped in IAC SB/SE)
    const start = Buffer.from([T.IAC, T.SB, T.GMCP]);
    const stop = Buffer.from([T.IAC, T.SE]);
    connection.sendToClient(Buffer.concat([start, data, stop]));
  }

  sendGMCP(connection: ConnectionState, msg: string): void {
    const start = Buffer.from([T.IAC, T.SB, T.GMCP]);
    const stop = Buffer.from([T.IAC, T.SE]);
    connection.writeTcp(Buffer.concat([start, Buffer.from(msg), stop]));
  }

  startTimeout(): void {
    this.timer = setTimeout(() => {
      this.negotiated = true;
    }, this.timeoutMs);
  }

  clearTimeout(): void {
    if (this.timer) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
