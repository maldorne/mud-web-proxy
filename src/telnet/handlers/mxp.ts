import type { TelnetOptionHandler, ConnectionState } from '../../types.js';
import * as T from '../constants.js';
import { logger } from '../../logger.js';

export class MxpHandler implements TelnetOptionHandler {
  readonly option = T.MXP;
  negotiated = false;
  timeoutMs = 5000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  handleIAC(verb: number, connection: ConnectionState): void {
    if (verb === T.DO) {
      connection.writeTcp(Buffer.from([T.IAC, T.WILL, T.MXP]));
      logger.debug('IAC DO MXP <- IAC WILL MXP', connection.remoteAddress);
    } else if (verb === T.WILL) {
      connection.writeTcp(Buffer.from([T.IAC, T.DO, T.MXP]));
      logger.debug('IAC WILL MXP <- IAC DO MXP', connection.remoteAddress);
    }
    this.negotiated = true;
    this.clearTimeout();
  }

  handleSB(_data: Buffer, _connection: ConnectionState): void {
    // MXP SB not typically used in negotiation
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
