import type { TelnetOptionHandler, ConnectionState } from '../../types.js';
import * as T from '../constants.js';
import { logger } from '../../logger.js';

export class EchoHandler implements TelnetOptionHandler {
  readonly option = T.ECHO;
  negotiated = false;
  timeoutMs = 5000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  handleIAC(verb: number, connection: ConnectionState): void {
    if (verb === T.WILL) {
      logger.debug('IAC WILL ECHO (password mode)', connection.remoteAddress);
      connection.passwordMode = true;
      this.negotiated = true;
      this.clearTimeout();
    }
  }

  handleSB(_data: Buffer, _connection: ConnectionState): void {
    // Not used
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
