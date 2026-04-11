import type {
  TelnetOptionHandler,
  ConnectionState,
  ProxyConfig,
} from '../types.js';
import * as T from './constants.js';
import { logger } from '../logger.js';
import { MccpHandler } from './handlers/mccp.js';
import { GmcpHandler } from './handlers/gmcp.js';
import { MsdpHandler } from './handlers/msdp.js';
import { MxpHandler } from './handlers/mxp.js';
import { TtypeHandler } from './handlers/ttype.js';
import { CharsetHandler } from './handlers/charset.js';
import { NewEnvHandler } from './handlers/newenv.js';
import { NawsHandler } from './handlers/naws.js';
import { SgaHandler } from './handlers/sga.js';
import { EchoHandler } from './handlers/echo.js';

export class TelnetNegotiator {
  private handlers: Map<number, TelnetOptionHandler>;
  readonly mccp: MccpHandler;
  readonly msdp: MsdpHandler;
  readonly gmcp: GmcpHandler;

  constructor(config: ProxyConfig) {
    this.mccp = new MccpHandler();
    this.gmcp = new GmcpHandler(config.gmcp.portal);
    this.msdp = new MsdpHandler();

    this.handlers = new Map<number, TelnetOptionHandler>([
      [T.MCCP2, this.mccp],
      [T.GMCP, this.gmcp],
      [T.MSDP, this.msdp],
      [T.MXP, new MxpHandler()],
      [T.TTYPE, new TtypeHandler()],
      [T.CHARSET, new CharsetHandler()],
      [T.NEW_ENVIRON, new NewEnvHandler()],
      [T.NAWS, new NawsHandler()],
      [T.SGA, new SgaHandler()],
      [T.ECHO, new EchoHandler()],
    ]);
  }

  /**
   * Process incoming data from the MUD server. Handles IAC sequences
   * in a single pass through the buffer, dispatching to the appropriate
   * handler. Returns the data with IAC sequences that were handled
   * stripped out (passthrough data remains for the client).
   */
  processServerData(data: Buffer, connection: ConnectionState): Buffer {
    // First, check for MCCP mid-stream activation
    const mccpResult = this.mccp.scanBuffer(data, connection);
    if (mccpResult) {
      // Send pre-MCCP data first
      if (mccpResult.before && mccpResult.before.length > 0) {
        connection.sendToClient(mccpResult.before);
      }
      // Remaining data is already compressed
      if (mccpResult.after.length > 0) {
        return mccpResult.after;
      }
      return Buffer.alloc(0);
    }

    // Single-pass scan: copy clean text to output, strip handled IAC sequences
    const chunks: Buffer[] = [];
    let textStart = 0;
    let i = 0;

    while (i < data.length - 1) {
      if (data[i] !== T.IAC) {
        i++;
        continue;
      }

      const verb = data[i + 1];

      // Three-byte IAC commands: IAC WILL/WONT/DO/DONT <option>
      if (
        (verb === T.WILL ||
          verb === T.WONT ||
          verb === T.DO ||
          verb === T.DONT) &&
        i + 2 < data.length
      ) {
        // Flush text before this IAC sequence
        if (i > textStart) chunks.push(data.subarray(textStart, i));

        const option = data[i + 2];
        const handler = this.handlers.get(option);
        if (handler && !handler.negotiated) {
          handler.handleIAC(verb, connection);
        }
        i += 3;
        textStart = i;
        continue;
      }

      // Sub-negotiation: IAC SB <option> ... IAC SE
      if (verb === T.SB && i + 2 < data.length) {
        // Flush text before this IAC sequence
        if (i > textStart) chunks.push(data.subarray(textStart, i));

        const option = data[i + 2];
        // Find the IAC SE that ends this sub-negotiation
        let end = i + 3;
        while (end < data.length - 1) {
          if (data[end] === T.IAC && data[end + 1] === T.SE) {
            break;
          }
          end++;
        }

        const handler = this.handlers.get(option);
        if (handler) {
          const sbData = data.subarray(i + 3, end);
          handler.handleSB(sbData, connection);
        }

        i = end + 2; // skip past IAC SE
        textStart = i;
        continue;
      }

      // Unrecognized two-byte IAC sequence — strip it
      if (i > textStart) chunks.push(data.subarray(textStart, i));
      i += 2;
      textStart = i;
    }

    // Flush remaining text
    if (textStart < data.length) {
      chunks.push(data.subarray(textStart));
    }

    if (chunks.length === 0) return Buffer.alloc(0);
    if (chunks.length === 1) return chunks[0];
    return Buffer.concat(chunks);
  }

  /**
   * Log raw binary data for debugging.
   */
  debugRaw(data: Buffer, context: string): void {
    const raw: string[] = [];
    for (let i = 0; i < data.length; i++) {
      raw.push(data[i].toString());
    }
    logger.debug(`raw bin: ${raw.join(',')}`, context);
  }

  /**
   * Clean up all handler timeouts.
   */
  destroy(): void {
    for (const handler of this.handlers.values()) {
      handler.clearTimeout();
    }
  }
}
