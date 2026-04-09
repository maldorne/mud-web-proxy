import type { TelnetOptionHandler, ConnectionState } from '../../types.js';
import * as T from '../constants.js';
import { logger } from '../../logger.js';

export class SgaHandler implements TelnetOptionHandler {
  readonly option = T.SGA;
  negotiated = false;
  timeoutMs = 5000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  handleIAC(verb: number, connection: ConnectionState): void {
    if (verb === T.WILL) {
      connection.writeTcp(Buffer.from([T.IAC, T.WONT, T.SGA]));
      logger.debug('IAC WILL SGA <- IAC WONT SGA', connection.remoteAddress);
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
