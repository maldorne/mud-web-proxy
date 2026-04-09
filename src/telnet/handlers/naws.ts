import type { TelnetOptionHandler, ConnectionState } from '../../types.js';
import * as T from '../constants.js';
import { logger } from '../../logger.js';

export class NawsHandler implements TelnetOptionHandler {
  readonly option = T.NAWS;
  negotiated = false;
  timeoutMs = 5000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  handleIAC(verb: number, connection: ConnectionState): void {
    if (verb === T.DO || verb === T.WILL) {
      connection.writeTcp(Buffer.from([T.IAC, T.WONT, T.NAWS]));
      logger.debug('IAC WONT NAWS', connection.remoteAddress);
      this.negotiated = true;
      this.clearTimeout();
    }
  }

  handleSB(_data: Buffer, _connection: ConnectionState): void {
    // Not used — we decline NAWS
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
