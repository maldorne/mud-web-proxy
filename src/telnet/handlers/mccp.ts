import type { TelnetOptionHandler, ConnectionState } from '../../types.js';
import * as T from '../constants.js';
import { logger } from '../../logger.js';

export class MccpHandler implements TelnetOptionHandler {
  readonly option = T.MCCP2;
  negotiated = false;
  timeoutMs = 8000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  handleIAC(verb: number, connection: ConnectionState): void {
    if (verb === T.WILL) {
      // Server offers MCCP2 — delay response to allow other negotiations
      setTimeout(() => {
        logger.debug('IAC DO MCCP2', connection.remoteAddress);
        connection.writeTcp(T.DO_MCCP);
      }, 6000);
    }
  }

  handleSB(_data: Buffer, connection: ConnectionState): void {
    // IAC SB MCCP2 IAC SE — compression starts after this
    connection.compressed = true;
    logger.info('MCCP compression started', connection.remoteAddress);
    this.negotiated = true;
    this.clearTimeout();
  }

  /**
   * Scans a data buffer for MCCP2 negotiation sequences.
   * Returns { preMccpData, postMccpData, compressionStarted } if
   * the MCCP SB sequence is found mid-buffer (data before it must be
   * sent uncompressed, data after is already compressed).
   */
  scanBuffer(
    data: Buffer,
    connection: ConnectionState,
  ): { before: Buffer | null; after: Buffer; started: boolean } | null {
    if (!connection.mccp || this.negotiated || connection.compressed) {
      return null;
    }

    for (let i = 0; i < data.length - 2; i++) {
      // IAC WILL MCCP2
      if (
        data[i] === T.IAC &&
        data[i + 1] === T.WILL &&
        data[i + 2] === T.MCCP2
      ) {
        this.handleIAC(T.WILL, connection);
      }

      // IAC SB MCCP2 (compression starts after IAC SE)
      if (
        data[i] === T.IAC &&
        data[i + 1] === T.SB &&
        data[i + 2] === T.MCCP2
      ) {
        const before = i > 0 ? data.subarray(0, i) : null;
        const after = data.subarray(i + 5); // skip IAC SB MCCP2 IAC SE
        this.handleSB(data, connection);
        return { before, after, started: true };
      }
    }

    return null;
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
