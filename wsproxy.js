/*  
  Lightweight Websocket <-> Telnet Proxy
  v1.3 - 2/27/2014 @plamzi
  v2.0 - ?? @neverbot
  v3.0 - March 2025 @neverbot
  
  Author: plamzi - plamzi@gmail.com 
  Contributor: neverbot
  MIT license
  
  Supports client setting any host and port prior to connect.
  
  Example (client-side JS):
  
    if (WebSocket) {
      let ws = new WebSocket('ws://mywsproxyserver:6200/');
      ws.onopen = function(e) { 
        ws.send('{ host: "localhost", port: 7000, connect: 1 }');
      };
    }
  
  Usage Notes:
    
    The server waits to receive { "connect": 1 } to begin connecting to
    a telnet client on behalf of the user, so you have to send it
    even if you are not passing it host and port from the client.
    
    JSON requests with { "chat": 1 } will be intercepted and handled
    by the basic in-proxy chat system.
*/

import util from 'util';
import net from 'net';
// import http from 'http'; // Commented out as in original
import https from 'https';
import zlib from 'zlib';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { minify } from 'uglify-js';
import ws from 'ws';
import iconv from 'iconv-lite';
// iconv.extendNodeEncodings(); // Kept commented as in original

// Get current file directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// if this is true, only allow connections to srv.tn_host, ignoring
// the server sent as argument by the client
const ONLY_ALLOW_DEFAULT_SERVER = true;
const REPOSITORY_URL = 'https://github.com/maldorne/mud-web-proxy/';

let server = {};
let chatlog;

process.chdir(__dirname);

const stringify = function (A) {
  let cache = [];
  let val = JSON.stringify(A, function (k, v) {
    if (typeof v === 'object' && v !== null) {
      if (cache.indexOf(v) !== -1) return;
      cache.push(v);
    }
    return v;
  });
  return val;
};

// Load chat log asynchronously
const loadChatLog = async () => {
  try {
    const data = await fs.promises.readFile('./chat.json', 'utf8');
    const parsed = JSON.parse(data);
    // Ensure we always return an array
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    srv.log('Chat log error: ' + err);
    return [];
  }
};

// const dump = function (o) {
//   console.log(stringify(o));
// };

let srv = {
  path: __dirname,
  /* this websocket proxy port */
  ws_port: 6200,
  /* default telnet host */
  tn_host: 'muds.maldorne.org',
  /* default telnet/target port */
  tn_port: 5010,
  /* enable additional debugging */
  debug: false,
  /* use node zlib (different from mccp) - you want this turned off unless your server can't do MCCP and your client can inflate data */
  compress: true,
  /* set to false while server is shutting down */
  open: true,

  ttype: {
    enabled: 1,
    portal: ['maldorne.org', 'XTERM-256color', 'MTTS 141'],
  },

  gmcp: {
    enabled: 1,
    portal: ['client maldorne.org', 'client_version 1.0'],
  },

  prt: {
    WILL_ATCP: Buffer.from([255, 251, 200]),
    WILL_GMCP: Buffer.from([255, 251, 201]),
    DO_GMCP: Buffer.from([255, 253, 201]),
    DO_MCCP: Buffer.from([255, 253, 86]),
    DO_MSDP: Buffer.from([255, 253, 69]),
    DO_MXP: Buffer.from([255, 253, 91]),
    WILL_MXP: Buffer.from([255, 251, 91]),
    START: Buffer.from([255, 250, 201]),
    STOP: Buffer.from([255, 240]),
    WILL_TTYPE: Buffer.from([255, 251, 24]),
    WILL_NEW: Buffer.from([255, 251, 39]),
    WONT_NAWS: Buffer.from([255, 252, 31]),
    SGA: 3,
    NEW: 39,
    TTYPE: 24,
    MCCP2: 86,
    MSDP: 69,
    MSDP_VAR: 1,
    MSDP_VAL: 2,
    MXP: 91,
    ATCP: 200,
    GMCP: 201,
    SE: 240,
    SB: 250,
    WILL: 251,
    WONT: 252,
    DO: 253,
    DONT: 254,
    IAC: 255,
    IS: 0,
    REQUEST: 1,
    ECHO: 1,
    VAR: 1,
    ACCEPTED: 2,
    REJECTED: 3,
    CHARSET: 42,
    ESC: 33,
    NAWS: 31,
    WILL_CHARSET: Buffer.from([255, 251, 42]),
    WILL_UTF8: Buffer.from([255, 250, 42, 2, 85, 84, 70, 45, 56, 255, 240]),
    ACCEPT_UTF8: Buffer.from([
      255, 250, 2, 34, 85, 84, 70, 45, 56, 34, 255, 240,
    ]),
    //WILL_UTF8:    Buffer.from([ 255, 250, 42, 2, "UTF-8", 255, 240 ])
  },

  init: async function () {
    let webserver;
    let wsServer;

    // Get Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);

    srv.log('Using node version ' + majorVersion);

    server = {
      sockets: [],
    };

    try {
      // Load chat log asynchronously
      chatlog = await loadChatLog();
      srv.log('Chat log loaded successfully');
    } catch (err) {
      srv.log('Error loading chat log: ' + err);
      chatlog = [];
    }

    // let webserver = http.createServer(function(request, response) {
    //   response.writeHead(404);
    //   response.end();
    // }, function(err) {
    //   srv.log(err);
    // });

    // webserver.listen(srv.ws_port, function() {
    //   srv.log('(ws) server listening: port ' + srv.ws_port);
    // });

    if (fs.existsSync('./cert.pem') && fs.existsSync('./privkey.pem')) {
      webserver = https.createServer({
        cert: fs.readFileSync('./cert.pem'),
        key: fs.readFileSync('./privkey.pem'),
      });
    } else {
      // TODO: maybe fallback to non secure connection
      srv.log('Could not find cert and/or privkey files, exiting.');
      process.exit();
    }

    webserver.listen(srv.ws_port, function () {
      srv.log('(ws) server listening: port ' + srv.ws_port);
    });

    // Create WebSocket server based on Node.js version
    try {
      if (majorVersion >= 16) {
        // Dynamic import with destructuring
        const { WebSocketServer } = await import('ws');

        // Modern Node.js version (16+)
        wsServer = new WebSocketServer({ server: webserver });
      } else {
        // Legacy Node.js version (14 and below)
        wsServer = new ws({ server: webserver });
      }

      srv.log(`WebSocket server initialized (Node.js ${process.version})`);
    } catch (err) {
      srv.log('Error creating WebSocket server: ' + err);
      process.exit(1);
    }

    wsServer.on('connection', function connection(socket, req) {
      srv.log('(ws on connection) new connection');
      if (!srv.open) {
        socket.terminate();
        return;
      }

      if (!srv.originAllowed(req.headers.origin)) {
        socket.terminate();
        return;
      }

      if (!socket.req) socket.req = req;

      // Add compatibility methods for the WebSocket
      socket.sendUTF = socket.send.bind(socket);
      socket.terminate = socket.close.bind(socket);

      server.sockets.push(socket);
      srv.log('(ws on connection) connection count: ' + server.sockets.length);

      socket.on('message', function message(msg) {
        // if (msg.type === 'utf8') {
        // msg = msg.utf8Data;
        if (!srv.parse(socket, msg)) {
          srv.forward(socket, msg);
        }
        // }
        // else {
        //   srv.log('unrecognized msg type: ' + msg.type);
        // }
      });

      socket.on('close', () => {
        srv.log(
          new Date().toISOString() +
            ' (ws) peer ' +
            socket.req.connection.remoteAddress +
            ' disconnected.',
        );
        srv.closeSocket(socket);
      });

      socket.on('error', (error) => {
        srv.log(
          new Date().toISOString() +
            ' (ws) peer ' +
            socket.req.connection.remoteAddress +
            ' error: ' +
            error,
        );
        srv.closeSocket(socket);
      });
    });

    fs.watch(srv.path + '/wsproxy.js', function (e, f) {
      if (srv['update-' + f]) clearTimeout(srv['update-' + f]);
      srv['update-' + f] = setTimeout(function () {
        srv.loadF(f);
      }, 1000);
    });
  },

  parse: function (s, d) {
    if (d[0] != '{') return 0;

    let req;

    try {
      req = eval('(' + d + ')');
    } catch (err) {
      srv.log('parse: ' + err);
      return 0;
    }

    if (req.host) {
      s.host = req.host;
      srv.log('Target host set to ' + s.host, s);
    }

    if (req.port) {
      s.port = req.port;
      srv.log('Target port set to ' + s.port, s);
    }

    if (req.ttype) {
      s.ttype = [req.ttype];
      srv.log('Client ttype set to ' + s.ttype, s);
    }

    if (req.name) s.name = req.name;

    if (req.client) s.client = req.client;

    if (req.mccp) s.mccp = req.mccp;

    if (req.utf8) s.utf8 = req.utf8;

    if (req.debug) s.debug = req.debug;

    if (req.chat) srv.chat(s, req);

    if (req.connect) srv.initT(s);

    if (req.bin && s.ts) {
      try {
        srv.log('Attempt binary send: ' + req.bin);
        s.ts.send(Buffer.from(req.bin));
      } catch (ex) {
        srv.log(ex);
      }
    }

    if (req.msdp && s.ts) {
      try {
        srv.log('Attempt msdp send: ' + stringify(req.msdp));
        srv.sendMSDP(s, req.msdp);
      } catch (ex) {
        srv.log(ex);
      }
    }

    return 1;
  },

  sendTTYPE: function (s, msg) {
    if (msg) {
      let p = srv.prt;
      s.ts.write(p.WILL_TTYPE);
      s.ts.write(Buffer.from([p.IAC, p.SB, p.TTYPE, p.IS]));
      s.ts.send(msg);
      s.ts.write(Buffer.from([p.IAC, p.SE]));
      srv.log(msg);
    }
  },

  sendGMCP: function (s, msg) {
    s.ts.write(srv.prt.START);
    s.ts.write(msg);
    s.ts.write(srv.prt.STOP);
  },

  sendMXP: function (s, msg) {
    let p = srv.prt;
    s.ts.write(Buffer.from([p.ESC]));
    s.ts.write('[1z' + msg);
    s.ts.write(Buffer.from([p.ESC]));
    s.ts.write('[7z');
  },

  sendMSDP: function (s, msdp) {
    let p = srv.prt;
    srv.log('sendMSDP ' + stringify(msdp), s);

    if (!msdp.key || !msdp.val) return;

    s.ts.write(Buffer.from([p.IAC, p.SB, p.MSDP, p.MSDP_VAR]));
    s.ts.write(msdp.key);

    msdp.val = msdp.val.pop ? msdp.val : [msdp.val];

    for (let i = 0; i < msdp.val.length; i++) {
      s.ts.write(Buffer.from([p.MSDP_VAL]));
      s.ts.write(msdp.val[i]);
    }

    s.ts.write(Buffer.from([p.IAC, p.SE]));
  },

  sendMSDPPair: function (s, key, val) {
    let p = srv.prt;
    srv.log('sendMSDPPair ' + key + '=' + val, s);
    s.ts.write(Buffer.from([p.IAC, p.SB, p.MSDP, p.MSDP_VAR]));
    s.ts.write(key);
    s.ts.write(Buffer.from([p.MSDP_VAL]));
    s.ts.write(val);
    s.ts.write(Buffer.from([p.IAC, p.SE]));
  },

  initT: function (so) {
    let s = so;
    let host = s.host || srv.tn_host;
    let port = s.port || srv.tn_port;

    if (!s.ttype) s.ttype = [];

    s.ttype = s.ttype.concat(srv.ttype.portal.slice(0));
    s.ttype.push(s.remoteAddress);
    s.ttype.push(s.remoteAddress);

    s.compressed = 0;

    // do not allow the proxy connect to different servers
    if (ONLY_ALLOW_DEFAULT_SERVER) {
      if (s.host !== srv.tn_host) {
        srv.log('avoid connection attempt to: ' + s.host + ':' + s.port, s);
        srv.sendClient(
          s,
          Buffer.from(
            'This proxy does not allow connections to servers different to ' +
              srv.tn_host +
              '.\r\nTake a look in ' +
              REPOSITORY_URL +
              ' and install it in your own server.\r\n',
          ),
        );
        setTimeout(function () {
          srv.closeSocket(s);
        }, 500);
        return;
      }
    }

    s.ts = net.createConnection(port, host, function () {
      srv.log(
        'new connection to ' + host + ':' + port + ' for ' + s.remoteAddress,
      );
    });

    // s.ts.setEncoding('binary');

    s.ts.send = function (data) {
      if (srv.debug) {
        let raw = [];
        for (let i = 0; i < data.length; i++)
          raw.push(util.format('%d', data[i]));
        srv.log('write bin: ' + raw.toString(), s);
      }

      try {
        data = iconv.encode(data, 'latin1');
      } catch (ex) {
        srv.log('error: ' + ex.toString(), s);
      }

      if (s.ts.writable) s.ts.write(data);
    };

    s.ts
      .on('connect', function () {
        // let p = srv.prt;

        srv.log('new telnet socket connected');

        setTimeout(function () {
          s.utf8_negotiated =
            s.mccp_negotiated =
            s.mxp_negotiated =
            s.gmcp_negotiated =
              1;
          s.new_negotiated =
            s.new_handshake =
            s.sga_negotiated =
            s.echo_negotiated =
            s.naws_negotiated =
              1;
        }, 12000);

        srv.chatUpdate();
      })
      .on('data', function (data) {
        srv.sendClient(s, data);
      })
      .on('timeout', function () {
        srv.log('telnet socket timeout: ' + s);
        srv.sendClient(s, Buffer.from('Timeout: server port is down.\r\n'));
        setTimeout(function () {
          srv.closeSocket(s);
        }, 500);
      })
      .on('close', function () {
        srv.log('telnet socket closed: ' + s.remoteAddress);
        srv.chatUpdate();
        setTimeout(function () {
          srv.closeSocket(s);
        }, 500);
        // srv.initT(s);
      })
      .on('error', function (err) {
        srv.log('error: ' + err.toString());
        // srv.sendClient(s, Buffer.from(err.toString()));
        srv.sendClient(s, Buffer.from('Error: maybe the mud server is down?'));
        setTimeout(function () {
          srv.closeSocket(s);
        }, 500);
      });
  },

  closeSocket: function (s) {
    if (s.ts) {
      srv.log(
        'closing telnet socket: ' + s.host ||
          srv.tn_host + ':' + s.port ||
          srv.tn_port,
      );
      // s.ts.destroy();
      s.terminate();
    }

    let i = server.sockets.indexOf(s);
    if (i != -1) server.sockets.splice(i, 1);

    srv.log('closing socket: ' + s.remoteAddress);

    if (s.terminate)
      // s.destroy();
      s.terminate();
    // s.socket.destroy();
    else s.socket.terminate();

    srv.log('active sockets: ' + server.sockets.length);
  },

  sendClient: function (s, data) {
    let p = srv.prt;

    if (s.mccp && !s.mccp_negotiated && !s.compressed) {
      for (let i = 0; i < data.length; i++) {
        if (
          data[i] == p.IAC &&
          data[i + 1] == p.WILL &&
          data[i + 2] == p.MCCP2
        ) {
          setTimeout(function () {
            srv.log('IAC DO MCCP2', s);
            s.ts.write(p.DO_MCCP);
          }, 6000);
        } else if (
          data[i] == p.IAC &&
          data[i + 1] == p.SB &&
          data[i + 2] == p.MCCP2
        ) {
          if (i) srv.sendClient(s, data.slice(0, i));

          data = data.slice(i + 5);
          s.compressed = 1;
          srv.log('MCCP compression started', s);

          if (!data.length) return;
        }
      }
    }

    if (s.ttype.length) {
      for (let i = 0; i < data.length; i++) {
        if (
          data[i] == p.IAC &&
          data[i + 1] == p.DO &&
          data[i + 2] == p.TTYPE
        ) {
          srv.log('IAC DO TTYPE <- IAC FIRST TTYPE', s);
          srv.sendTTYPE(s, s.ttype.shift());
          /*
             * s.ts.send(p.WILL_TTYPE);
            for (i = 0; i < s.ttype.length; i++)  {
              srv.sendTTYPE(s, s.ttype.shift());
            }*/
        } else if (
          data[i] == p.IAC &&
          data[i + 1] == p.SB &&
          data[i + 2] == p.TTYPE &&
          data[i + 3] == p.REQUEST
        ) {
          srv.log('IAC SB TTYPE <- IAC NEXT TTYPE');
          srv.sendTTYPE(s, s.ttype.shift());
        }
      }
    }

    if (!s.gmcp_negotiated) {
      for (let i = 0; i < data.length; i++) {
        if (
          data[i] == p.IAC &&
          (data[i + 1] == p.DO || data[i + 1] == p.WILL) &&
          data[i + 2] == p.GMCP
        ) {
          srv.log('IAC DO GMCP', s);

          if (data[i + 1] == p.DO) s.ts.write(p.WILL_GMCP);
          else s.ts.write(p.DO_GMCP);

          srv.log('IAC DO GMCP <- IAC WILL GMCP', s);

          s.gmcp_negotiated = 1;

          for (let t = 0; t < srv.gmcp.portal.length; t++) {
            if (t == 0 && s.client) {
              srv.sendGMCP(s, 'client ' + s.client);
              continue;
            }

            srv.sendGMCP(s, srv.gmcp.portal[t]);
          }

          srv.sendGMCP(s, 'client_ip ' + s.remoteAddress);
        }
      }
    }

    if (!s.msdp_negotiated) {
      for (let i = 0; i < data.length; i++) {
        if (
          data[i] == p.IAC &&
          data[i + 1] == p.WILL &&
          data[i + 2] == p.MSDP
        ) {
          s.ts.write(p.DO_MSDP);
          srv.log('IAC WILL MSDP <- IAC DO MSDP', s);
          srv.sendMSDPPair(s, 'CLIENT_ID', s.client || 'mudportal.com');
          srv.sendMSDPPair(s, 'CLIENT_VERSION', '1.0');
          srv.sendMSDPPair(s, 'CLIENT_IP', s.remoteAddress);
          srv.sendMSDPPair(s, 'XTERM_256_COLORS', '1');
          srv.sendMSDPPair(s, 'MXP', '1');
          srv.sendMSDPPair(s, 'UTF_8', '1');
          s.msdp_negotiated = 1;
        }
      }
    }

    if (!s.mxp_negotiated) {
      for (let i = 0; i < data.length; i++) {
        if (data[i] == p.IAC && data[i + 1] == p.DO && data[i + 2] == p.MXP) {
          s.ts.write(Buffer.from([p.IAC, p.WILL, p.MXP]));
          srv.log('IAC DO MXP <- IAC WILL MXP', s);
          s.mxp_negotiated = 1;
        } else if (
          data[i] == p.IAC &&
          data[i + 1] == p.WILL &&
          data[i + 2] == p.MXP
        ) {
          s.ts.write(Buffer.from([p.IAC, p.DO, p.MXP]));
          srv.log('IAC WILL MXP <- IAC DO MXP', s);
          s.mxp_negotiated = 1;
        }
      }
    }

    if (!s.new_negotiated) {
      for (let i = 0; i < data.length; i++) {
        if (data[i] == p.IAC && data[i + 1] == p.DO && data[i + 2] == p.NEW) {
          s.ts.write(Buffer.from([p.IAC, p.WILL, p.NEW]));
          srv.log('IAC WILL NEW-ENV', s);
          s.new_negotiated = 1;
        }
      }
    } else if (!s.new_handshake) {
      for (let i = 0; i < data.length; i++) {
        if (
          data[i] == p.IAC &&
          data[i + 1] == p.SB &&
          data[i + 2] == p.NEW &&
          data[i + 3] == p.REQUEST
        ) {
          s.ts.write(Buffer.from([p.IAC, p.SB, p.NEW, p.IS, p.IS]));
          s.ts.write('IPADDRESS');
          s.ts.write(Buffer.from([p.REQUEST]));
          s.ts.write(s.remoteAddress);
          s.ts.write(Buffer.from([p.IAC, p.SE]));
          srv.log('IAC NEW-ENV IP VAR SEND');
          s.new_handshake = 1;
        }
      }
    }

    if (!s.echo_negotiated) {
      for (let i = 0; i < data.length; i++) {
        if (
          data[i] == p.IAC &&
          data[i + 1] == p.WILL &&
          data[i + 2] == p.ECHO
        ) {
          //s.ts.send(Buffer.from([p.IAC, p.WILL, p.ECHO]));
          srv.log('IAC WILL ECHO <- IAC WONT ECHO');
          // set a flag to avoid logging the next message (maybe passwords)
          s.password_mode = true;
          s.echo_negotiated = 1;
        }
      }
    }

    if (!s.sga_negotiated) {
      for (let i = 0; i < data.length; i++) {
        if (
          data[i] == p.IAC &&
          data[i + 1] == p.WILL &&
          data[i + 2] == p.SGA
        ) {
          s.ts.write(Buffer.from([p.IAC, p.WONT, p.SGA]));
          srv.log('IAC WILL SGA <- IAC WONT SGA');
          s.sga_negotiated = 1;
        }
      }
    }

    if (!s.naws_negotiated) {
      for (let i = 0; i < data.length; i++) {
        if (
          data[i] == p.IAC &&
          data[i + 1] == p.WILL &&
          data[i + 2] == p.NAWS
        ) {
          s.ts.write(Buffer.from([p.IAC, p.WONT, p.NAWS]));
          srv.log('IAC WILL SGA <- IAC WONT NAWS');
          s.naws_negotiated = 1;
        }
      }
    }

    if (!s.utf8_negotiated) {
      for (let i = 0; i < data.length; i++) {
        if (
          data[i] == p.IAC &&
          data[i + 1] == p.DO &&
          data[i + 2] == p.CHARSET
        ) {
          s.ts.write(p.WILL_CHARSET);
          srv.log('IAC DO CHARSET <- IAC WILL CHARSET', s);
        }

        if (
          data[i] == p.IAC &&
          data[i + 1] == p.SB &&
          data[i + 2] == p.CHARSET
        ) {
          s.ts.write(p.ACCEPT_UTF8);
          srv.log('UTF-8 negotiated', s);
          s.utf8_negotiated = 1;
        }
      }
    }

    if (srv.debug) {
      let raw = [];
      for (let i = 0; i < data.length; i++)
        raw.push(util.format('%d', data[i]));
      srv.log('raw bin: ' + raw, s);
      // srv.log('raw: ' + data, s);
    }

    if (!srv.compress || (s.mccp && s.compressed)) {
      s.send(data.toString('base64'));
      return;
    }

    /* Client<->Proxy only Compression */
    zlib.deflateRaw(data, function (err, buffer) {
      if (!err) {
        s.send(buffer.toString('base64'));
      } else {
        srv.log('zlib error: ' + err);
      }
    });
  },

  loadF: function (f) {
    try {
      let fl = minify(srv.path + '/' + f).code;
      eval(fl + '');
      srv.log('dyn.reload: ' + f);
    } catch (err) {
      srv.log(f);
      srv.log('Minify/load error: ' + err);
      return;
    }
  },

  chat: function (s, req) {
    srv.log('chat: ' + stringify(req), s);
    s.chat = 1;

    let ss = server.sockets;

    // Ensure chatlog is always an array
    if (!Array.isArray(chatlog)) {
      chatlog = [];
    }

    if (req.channel && req.channel == 'op') {
      // chatlog = chatlog.filter(function(l) { return (l[1].channel == 'status')?0:1 });
      // Create a copy of the last 300 messages
      const temp = Array.from(chatlog).slice(-300);
      const users = [];

      for (let i = 0; i < ss.length; i++) {
        if (!ss[i].ts && ss[i].name) continue;

        let u;
        if (ss[i].ts) {
          // let u = '\x1b<span style="color: #01c8d4"\x1b>' + (ss[i].name||'Guest') + '\x1b</span\x1b>@'+ss[i].host;
          u = (ss[i].name || 'Guest') + '@' + ss[i].host;
        } else {
          u = (ss[i].name || 'Guest') + '@chat';
        }

        if (users.indexOf(u) == -1) users.push(u);
      }

      temp.push([
        new Date(),
        { channel: 'status', name: 'online:', msg: users.join(', ') },
      ]);

      let t = stringify(temp);
      t = this.chatCleanup(t);

      // s.sendUTF('portal.chatlog ' + t);
      s.send('portal.chatlog ' + t);
      // fs.writeFileSync("./chat.json", stringify(chatlog));
      return;
    }

    delete req.chat;
    chatlog.push([new Date(), req]);
    req.msg = this.chatCleanup(req.msg);

    for (let i = 0; i < ss.length; i++) {
      // if (ss[i].chat) ss[i].sendUTF('portal.chat ' + stringify(req));
      if (ss[i].chat) ss[i].send('portal.chat ' + stringify(req));
    }

    fs.writeFileSync('./chat.json', stringify(chatlog));
  },

  chatUpdate: function () {
    let ss = server.sockets;
    for (let i = 0; i < ss.length; i++)
      if (ss[i].chat) srv.chat(ss[i], { channel: 'op' });
  },

  chatCleanup: function (t) {
    /* eslint-disable no-control-regex */
    t = t.replace(/([^\x1b])</g, '$1&lt;');
    t = t.replace(/([^\x1b])>/g, '$1&gt;');
    t = t.replace(/\x1b>/g, '>');
    t = t.replace(/\x1b</g, '<');
    /* eslint-enable no-control-regex */
    return t;
  },

  originAllowed: function () {
    return 1;
  },

  log: function (msg, s) {
    if (!s) s = { req: { connection: { remoteAddress: '' } } };
    // eslint-disable-next-line no-console
    console.log(
      util.format(
        new Date().toISOString() + ' %s: %s',
        s.req.connection.remoteAddress,
        msg,
      ),
    );
  },

  die: function (core) {
    srv.log('Dying gracefully in 3 sec.');
    let ss = server.sockets;

    for (let i = 0; i < ss.length; i++) {
      /* inform clients so they can hop to another instance faster */
      if (ss[i] && ss[i].write) ss[i].write('Proxy server is going down...');
      setTimeout(srv.closeSocket, 10, ss[i]);
    }

    setTimeout(
      process.exit,
      3000,
      core ? 3 : 0,
    ); /* send SIGQUIT if core dump */
  },

  newSocket: function (s) {
    if (!srv.open) {
      /* server is going down */
      s.terminate();
      // s.destroy?s.destroy():s.socket.destroy();
      return;
    }

    server.sockets.push(s);

    s.on('data', function (d) {
      srv.forward(s, d);
    });

    s.on('end', function () {
      srv.closeSocket(s);
    });

    s.on('error', function () {
      srv.closeSocket(s);
    });

    srv.initT(s);
    srv.log('(rs): new connection');
  },

  forward: function (s, d) {
    if (s.ts) {
      if (s.debug) {
        if (s.password_mode) {
          srv.log('forward: **** (omitted)', s);
        } else {
          srv.log('forward: ' + d, s);
        }
      }

      // reset password mode after forwarding the message
      if (s.password_mode) {
        s.password_mode = false;
      }

      s.ts.send(d);
    }
  },
};

// Initialize async
const init = async () => {
  chatlog = await loadChatLog();

  process.stdin.resume();

  process
    .on('SIGINT', () => {
      srv.log('Got SIGINT.');
      srv.die();
    })
    .on('SIGABRT', () => {
      srv.log('Got SIGABRT.');
      srv.die();
    })
    .on('SIGSEGV', () => {
      srv.log('Got SIGSEGV.');
      srv.die(true);
    })
    .on('SIGTERM', () => {
      srv.log('Got SIGTERM.');
      srv.die();
    });

  srv.init();
};

// Start the server
init().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to initialize:', err);
  process.exit(1);
});
