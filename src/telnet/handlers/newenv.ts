import type { TelnetOptionHandler, ConnectionState } from '../../types.js';
import * as T from '../constants.js';
import { logger } from '../../logger.js';

export class NewEnvHandler implements TelnetOptionHandler {
  readonly option = T.NEW_ENVIRON;
  negotiated = false;
  timeoutMs = 5000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handshakeDone = false;

  handleIAC(verb: number, connection: ConnectionState): void {
    if (verb === T.DO) {
      connection.writeTcp(Buffer.from([T.IAC, T.WILL, T.NEW_ENVIRON]));
      logger.debug('IAC WILL NEW-ENV', connection.remoteAddress);
    }
  }

  handleSB(data: Buffer, connection: ConnectionState): void {
    // IAC SB NEW-ENVIRON REQUEST -> send IPADDRESS
    if (!this.handshakeDone && data.length >= 1 && data[0] === T.REQUEST) {
      connection.writeTcp(
        Buffer.concat([
          Buffer.from([T.IAC, T.SB, T.NEW_ENVIRON, T.IS, T.IS]),
          Buffer.from('IPADDRESS'),
          Buffer.from([T.REQUEST]),
          Buffer.from(connection.remoteAddress),
          Buffer.from([T.IAC, T.SE]),
        ]),
      );
      logger.debug('IAC NEW-ENV IP VAR SEND', connection.remoteAddress);
      this.handshakeDone = true;
      this.negotiated = true;
      this.clearTimeout();
    }
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
