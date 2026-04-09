import type { TelnetOptionHandler, ConnectionState } from '../../types.js';
import * as T from '../constants.js';
import { logger } from '../../logger.js';

export class MsdpHandler implements TelnetOptionHandler {
  readonly option = T.MSDP;
  negotiated = false;
  timeoutMs = 5000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  handleIAC(verb: number, connection: ConnectionState): void {
    if (verb === T.WILL) {
      connection.writeTcp(T.DO_MSDP);
      logger.debug('IAC WILL MSDP <- IAC DO MSDP', connection.remoteAddress);

      this.sendPair(
        connection,
        'CLIENT_ID',
        connection.client ?? 'maldorne.org',
      );
      this.sendPair(connection, 'CLIENT_VERSION', '1.0');
      this.sendPair(connection, 'CLIENT_IP', connection.remoteAddress);
      this.sendPair(connection, 'XTERM_256_COLORS', '1');
      this.sendPair(connection, 'MXP', '1');
      this.sendPair(connection, 'UTF_8', '1');

      this.negotiated = true;
      this.clearTimeout();
    }
  }

  handleSB(_data: Buffer, _connection: ConnectionState): void {
    // MSDP SB data is forwarded to client as-is
  }

  sendPair(connection: ConnectionState, key: string, val: string): void {
    logger.debug(`sendMSDPPair ${key}=${val}`, connection.remoteAddress);
    connection.writeTcp(
      Buffer.concat([
        Buffer.from([T.IAC, T.SB, T.MSDP, T.MSDP_VAR]),
        Buffer.from(key),
        Buffer.from([T.MSDP_VAL]),
        Buffer.from(val),
        Buffer.from([T.IAC, T.SE]),
      ]),
    );
  }

  sendMSDP(
    connection: ConnectionState,
    msdp: { key: string; val: string | string[] },
  ): void {
    logger.debug(`sendMSDP ${JSON.stringify(msdp)}`, connection.remoteAddress);
    if (!msdp.key || !msdp.val) return;

    const vals = Array.isArray(msdp.val) ? msdp.val : [msdp.val];
    const parts: Buffer[] = [
      Buffer.from([T.IAC, T.SB, T.MSDP, T.MSDP_VAR]),
      Buffer.from(msdp.key),
    ];

    for (const v of vals) {
      parts.push(Buffer.from([T.MSDP_VAL]));
      parts.push(Buffer.from(v));
    }

    parts.push(Buffer.from([T.IAC, T.SE]));
    connection.writeTcp(Buffer.concat(parts));
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
