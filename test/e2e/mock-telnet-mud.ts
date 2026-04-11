import net from 'net';
import * as T from '../../src/telnet/constants.js';

/**
 * Full-featured mock MUD server for e2e testing.
 * Speaks telnet protocol: sends IAC sequences for negotiation,
 * responds to protocol handshakes, and can simulate game output.
 */
export class MockTelnetMud {
  private server: net.Server;
  private connections: net.Socket[] = [];
  port = 0;

  // Track what protocols were negotiated
  negotiated = {
    gmcp: false,
    msdp: false,
    mxp: false,
    ttype: false,
    charset: false,
    echo: false,
    sga: false,
    naws: false,
    newEnv: false,
  };

  // Collected data
  received: Buffer[] = [];
  gmcpMessages: string[] = [];
  msdpPairs: Array<{ key: string; val: string }> = [];

  constructor() {
    this.server = net.createServer((socket) => {
      this.connections.push(socket);

      socket.on('data', (data) => {
        this.received.push(data);
        this.handleData(socket, data);
      });

      socket.on('close', () => {
        const idx = this.connections.indexOf(socket);
        if (idx !== -1) this.connections.splice(idx, 1);
      });

      socket.on('error', () => {
        // ignore
      });

      // Send initial negotiation offers after a short delay
      setTimeout(() => this.sendNegotiationOffers(socket), 50);
    });
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as net.AddressInfo;
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  /** Send initial telnet negotiation offers like a real MUD. */
  private sendNegotiationOffers(socket: net.Socket): void {
    // Offer GMCP
    socket.write(Buffer.from([T.IAC, T.WILL, T.GMCP]));
    // Offer MSDP
    socket.write(Buffer.from([T.IAC, T.WILL, T.MSDP]));
    // Offer MXP
    socket.write(Buffer.from([T.IAC, T.DO, T.MXP]));
    // Ask for TTYPE
    socket.write(Buffer.from([T.IAC, T.DO, T.TTYPE]));
    // Offer CHARSET
    socket.write(Buffer.from([T.IAC, T.DO, T.CHARSET]));
    // Offer ECHO (password mode)
    socket.write(Buffer.from([T.IAC, T.WILL, T.ECHO]));
    // Offer SGA
    socket.write(Buffer.from([T.IAC, T.WILL, T.SGA]));
    // Ask for NEW-ENVIRON
    socket.write(Buffer.from([T.IAC, T.DO, T.NEW_ENVIRON]));

    // Send welcome message
    socket.write(Buffer.from('Welcome to MockMUD!\r\n'));
    socket.write(Buffer.from('Enter your name: '));
  }

  /** Handle incoming data from proxy, track protocol negotiations. */
  private handleData(socket: net.Socket, data: Buffer): void {
    let i = 0;
    while (i < data.length) {
      if (data[i] !== T.IAC || i + 1 >= data.length) {
        i++;
        continue;
      }

      const verb = data[i + 1];

      // Handle WILL/DO responses
      if ((verb === T.WILL || verb === T.DO) && i + 2 < data.length) {
        const option = data[i + 2];
        this.trackNegotiation(option);

        // If proxy sends WILL TTYPE, request it
        if (verb === T.WILL && option === T.TTYPE) {
          socket.write(
            Buffer.from([T.IAC, T.SB, T.TTYPE, T.REQUEST, T.IAC, T.SE]),
          );
        }

        // If proxy sends WILL NEW-ENVIRON, request it
        if (verb === T.WILL && option === T.NEW_ENVIRON) {
          socket.write(
            Buffer.from([T.IAC, T.SB, T.NEW_ENVIRON, T.REQUEST, T.IAC, T.SE]),
          );
        }

        // If proxy sends WILL CHARSET, offer UTF-8
        if (verb === T.WILL && option === T.CHARSET) {
          socket.write(
            Buffer.from([T.IAC, T.SB, T.CHARSET, T.REQUEST, T.IAC, T.SE]),
          );
        }

        i += 3;
        continue;
      }

      // Handle SB (sub-negotiation)
      if (verb === T.SB && i + 2 < data.length) {
        const option = data[i + 2];

        // Find IAC SE
        let end = i + 3;
        while (end < data.length - 1) {
          if (data[end] === T.IAC && data[end + 1] === T.SE) break;
          end++;
        }

        const sbData = data.subarray(i + 3, end);

        if (option === T.GMCP) {
          this.negotiated.gmcp = true;
          this.gmcpMessages.push(sbData.toString());
        }

        if (option === T.TTYPE) {
          this.negotiated.ttype = true;
          // Request more TTYPEs
          socket.write(
            Buffer.from([T.IAC, T.SB, T.TTYPE, T.REQUEST, T.IAC, T.SE]),
          );
        }

        if (option === T.MSDP) {
          this.negotiated.msdp = true;
          // Parse MSDP VAR/VAL pairs
          this.parseMsdp(sbData);
        }

        i = end + 2;
        continue;
      }

      // Handle WONT/DONT
      if ((verb === T.WONT || verb === T.DONT) && i + 2 < data.length) {
        i += 3;
        continue;
      }

      i += 2;
    }
  }

  private trackNegotiation(option: number): void {
    switch (option) {
      case T.GMCP:
        this.negotiated.gmcp = true;
        break;
      case T.MSDP:
        this.negotiated.msdp = true;
        break;
      case T.MXP:
        this.negotiated.mxp = true;
        break;
      case T.TTYPE:
        this.negotiated.ttype = true;
        break;
      case T.CHARSET:
        this.negotiated.charset = true;
        break;
      case T.NEW_ENVIRON:
        this.negotiated.newEnv = true;
        break;
    }
  }

  private parseMsdp(data: Buffer): void {
    // Simple MSDP parser: VAR key VAL value
    let key = '';
    let val = '';
    let readingVal = false;

    for (let i = 0; i < data.length; i++) {
      if (data[i] === T.MSDP_VAR) {
        readingVal = false;
        key = '';
      } else if (data[i] === T.MSDP_VAL) {
        readingVal = true;
        val = '';
      } else {
        if (readingVal) {
          val += String.fromCharCode(data[i]);
        } else {
          key += String.fromCharCode(data[i]);
        }
      }
    }

    if (key && val) {
      this.msdpPairs.push({ key, val });
    }
  }

  /** Send text from the MUD to all connected clients. */
  send(text: string): void {
    const buf = Buffer.from(text);
    for (const conn of this.connections) {
      if (conn.writable) conn.write(buf);
    }
  }

  /** Send raw bytes. */
  sendRaw(data: Buffer): void {
    for (const conn of this.connections) {
      if (conn.writable) conn.write(data);
    }
  }

  /** Send a GMCP message from the MUD to the proxy. */
  sendGMCP(msg: string): void {
    const buf = Buffer.concat([
      Buffer.from([T.IAC, T.SB, T.GMCP]),
      Buffer.from(msg),
      Buffer.from([T.IAC, T.SE]),
    ]);
    for (const conn of this.connections) {
      if (conn.writable) conn.write(buf);
    }
  }

  async waitForConnection(timeoutMs = 5000): Promise<void> {
    if (this.connections.length > 0) return;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timeout waiting for connection')),
        timeoutMs,
      );
      this.server.once('connection', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  get connectionCount(): number {
    return this.connections.length;
  }

  reset(): void {
    this.received = [];
    this.gmcpMessages = [];
    this.msdpPairs = [];
    this.negotiated = {
      gmcp: false,
      msdp: false,
      mxp: false,
      ttype: false,
      charset: false,
      echo: false,
      sga: false,
      naws: false,
      newEnv: false,
    };
  }

  async stop(): Promise<void> {
    for (const conn of this.connections) {
      conn.destroy();
    }
    this.connections = [];
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
