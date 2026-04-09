import type { TelnetOptionHandler, ConnectionState } from '../../types.js';
import * as T from '../constants.js';
import { logger } from '../../logger.js';

export class CharsetHandler implements TelnetOptionHandler {
  readonly option = T.CHARSET;
  negotiated = false;
  timeoutMs = 5000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  handleIAC(verb: number, connection: ConnectionState): void {
    if (verb === T.DO) {
      connection.writeTcp(T.WILL_CHARSET);
      logger.debug('IAC DO CHARSET <- IAC WILL CHARSET', connection.remoteAddress);
    }
  }

  handleSB(_data: Buffer, connection: ConnectionState): void {
    // Server proposes charset list — accept UTF-8
    connection.writeTcp(T.ACCEPT_UTF8);
    logger.info('UTF-8 negotiated', connection.remoteAddress);
    connection.utf8 = true;
    this.negotiated = true;
    this.clearTimeout();
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
