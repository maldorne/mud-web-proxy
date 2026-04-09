import type { TelnetOptionHandler, ConnectionState } from '../../types.js';
import * as T from '../constants.js';
import { logger } from '../../logger.js';

export class TtypeHandler implements TelnetOptionHandler {
  readonly option = T.TTYPE;
  negotiated = false;
  timeoutMs = 5000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  handleIAC(verb: number, connection: ConnectionState): void {
    if (verb === T.DO && connection.ttype.length > 0) {
      logger.debug(
        'IAC DO TTYPE <- sending first TTYPE',
        connection.remoteAddress,
      );
      this.sendTTYPE(connection, connection.ttype.shift()!);
    }
  }

  handleSB(data: Buffer, connection: ConnectionState): void {
    // IAC SB TTYPE REQUEST -> send next TTYPE
    if (
      data.length >= 1 &&
      data[0] === T.REQUEST &&
      connection.ttype.length > 0
    ) {
      logger.debug(
        'IAC SB TTYPE REQUEST <- sending next TTYPE',
        connection.remoteAddress,
      );
      this.sendTTYPE(connection, connection.ttype.shift()!);
    }

    if (connection.ttype.length === 0) {
      this.negotiated = true;
      this.clearTimeout();
    }
  }

  private sendTTYPE(connection: ConnectionState, value: string): void {
    if (!value) return;
    logger.debug(`TTYPE: ${value}`, connection.remoteAddress);
    connection.writeTcp(T.WILL_TTYPE);
    connection.writeTcp(
      Buffer.concat([
        Buffer.from([T.IAC, T.SB, T.TTYPE, T.IS]),
        Buffer.from(value),
        Buffer.from([T.IAC, T.SE]),
      ]),
    );
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
