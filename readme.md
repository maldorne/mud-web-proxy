# mud-web-proxy

### What is this?

A [Node.js](https://nodejs.org/en/) WebSocket-to-Telnet proxy server for [MUD](https://en.wikipedia.org/wiki/MUD) / MUSH / MOO game servers. It accepts secure WebSocket (`wss://`) connections from web clients and translates them into raw TCP/Telnet connections to MUD servers, handling all major telnet protocol negotiations transparently.

The proxy is client-agnostic: it can be used with [`mud-web-client`](https://github.com/maldorne/mud-web-client) or any other WebSocket-based MUD client.

### History

This project was originally a fork of [MUDPortal-Web-App](https://github.com/plamzi/MUDPortal-Web-App), made by [@plamzi](https://github.com/plamzi), creator of [mudportal.com](http://www.mudportal.com/). The original project contained both the web client and proxy server in a single repository. In 2020, [@neverbot](https://github.com/neverbot) forked and split them into separate projects, adding support for secure connections (`wss://` instead of `ws://`). Kudos to [@plamzi](https://github.com/plamzi), whose original work made this project possible.

In 2025, the project was ported to ES modules and all dependencies were updated to their latest versions, modernizing the codebase while keeping the original architecture.

In 2026, the project was rewritten from scratch in TypeScript. This is no longer a fork — it is a completely new implementation with a modular architecture, full test suite, Docker support, and designed to run inside a Docker cluster behind a reverse proxy like Traefik.

### Motivation

In modern browsers, web pages served through `https://` are not allowed to open connections to non-secure endpoints. An `https://`-served page cannot use plain `ws://` WebSockets. This proxy bridges that gap by accepting `wss://` connections and translating them to plain TCP/Telnet.

When deployed inside a Docker cluster, TLS termination is handled by a reverse proxy (e.g. Traefik), so the proxy itself runs on plain `ws://` internally.

## Features

### Telnet protocol support

  * MCCP v2 compression support (zlib)
  * MXP (MUD eXtension Protocol) support
  * MSDP (MUD Server Data Protocol) support
  * GMCP / ATCP protocol support (bidirectional — client to MUD and MUD to client)
  * TTYPE (terminal type) negotiation
  * CHARSET / UTF-8 negotiation
  * NEW-ENVIRON negotiation
  * NAWS, SGA, ECHO handling

### Resilience

  * Automatic reconnection to MUD servers on TCP disconnect (configurable attempts and delay with exponential backoff)
  * WebSocket ping/pong keepalives to detect dead clients
  * Connect timeout and idle timeout for TCP connections
  * Graceful shutdown with client notification (SIGTERM/SIGINT)
  * Per-IP rate limiting (configurable)
  * Maximum concurrent connections limit

### Observability

  * Prometheus-compatible metrics endpoint at `/metrics`
  * Health check endpoint at `/health` (returns 503 during shutdown)
  * JSON log output in production (for log aggregators like Loki or Datadog), human-readable colored output in development
  * Log sanitization (strips ANSI escapes and control characters)

### Security

  * Zod-based runtime validation of all client messages
  * Configurable origin allowlist
  * HTTP security headers (HSTS, X-Content-Type-Options, X-Frame-Options, etc.)
  * No `eval()`, no hot-reload, no unsafe code patterns

### Deployment

  * Multi-stage Docker image (Node 20 Alpine, non-root user)
  * Works standalone with TLS certificates or behind a reverse proxy (Traefik)
  * Route-by-name for Docker clusters: clients send `{ mud: "docker-container-mud-name" }`, the proxy resolves via Docker DNS
  * Legacy host:port routing for standalone deployments
  * In-proxy chat system with broadcast and online user list

## Installation

### Standalone

```bash
git clone https://github.com/maldorne/mud-web-proxy
cd mud-web-proxy
npm install
npm run build
npm start
```

### Docker (local development)

```bash
docker compose -f docker-compose.dev.yml up --build
```

The proxy will be available at `ws://localhost:6200/`. Health check at `http://localhost:6200/health`.

### Docker (cluster with Traefik)

Add the proxy service to your `docker-compose.yml`:

```yaml
mud-web-proxy:
  container_name: mud-web-proxy
  image: ghcr.io/maldorne/mud-web-proxy:latest
  restart: unless-stopped
  networks:
    - maldorne-network
  environment:
    WS_PORT: "6200"
    TLS_ENABLED: "false"
    NODE_ENV: "production"
    COMPRESS: "true"
    ENABLE_LEGACY_ROUTING: "true"
    ALLOWED_ORIGINS: "https://maldorne.org"
    ALLOWED_HOSTS: "muds.maldorne.org"
    DEFAULT_ENCODING: "latin1"
    MUD_ROUTES: |-
      {
        "my-mud":      {"host": "my-mud",      "port": 5000, "encoding": "latin1"},
        "another-mud": {"host": "another-mud", "port": 5000, "encoding": "utf8"}
      }
  labels:
    - traefik.enable=true
    - traefik.http.routers.mud-proxy.rule=Host(`play.maldorne.org`)
    - traefik.http.routers.mud-proxy.entrypoints=websecure
    - traefik.http.routers.mud-proxy.tls.certresolver=myresolver
    - traefik.http.services.mud-proxy.loadbalancer.server.port=6200
```

## Configuration

All configuration is done through environment variables:

### Server

| Variable        | Default         | Description                                          |
| --------------- | --------------- | ---------------------------------------------------- |
| `WS_PORT`       | `6200`          | WebSocket server port                                |
| `TLS_ENABLED`   | `false`         | Enable TLS (set to `true` for standalone with certs) |
| `TLS_CERT_PATH` | `./cert.pem`    | Path to TLS certificate                              |
| `TLS_KEY_PATH`  | `./privkey.pem` | Path to TLS private key                              |
| `COMPRESS`      | `true`          | Enable proxy-level zlib compression                  |
| `DEBUG`         | `false`         | Enable debug logging                                 |
| `LOG_LEVEL`     | `info`          | Log level: `debug`, `info`, `warn`, `error`          |
| `NODE_ENV`      | —               | Set to `production` for JSON log output              |

### Routing

| Variable                | Default             | Description                                                   |
| ----------------------- | ------------------- | ------------------------------------------------------------- |
| `MUD_ROUTES`            | `{}`                | JSON map of MUD names to `{ host, port, encoding? }` for cluster routing |
| `ENABLE_LEGACY_ROUTING` | `true`              | Allow clients to specify host:port directly                              |
| `ALLOWED_HOSTS`         | —                   | Comma-separated list of hosts allowed for legacy routing (empty = all)   |
| `DEFAULT_HOST`          | `muds.maldorne.org` | Default MUD host for legacy routing                                      |
| `DEFAULT_PORT`          | `5010`              | Default MUD port for legacy routing                                      |
| `DEFAULT_ENCODING`      | `utf8`              | Fallback encoding when not negotiated or configured per route            |

### Limits and timeouts

| Variable               | Default   | Description                               |
| ---------------------- | --------- | ----------------------------------------- |
| `MAX_CONNECTIONS`      | `500`     | Maximum concurrent WebSocket connections  |
| `RATE_LIMIT_PER_IP`    | `10`      | Max connections per IP per window         |
| `RATE_LIMIT_WINDOW_MS` | `60000`   | Rate limit window in milliseconds         |
| `CONNECT_TIMEOUT_MS`   | `10000`   | TCP connect timeout                       |
| `IDLE_TIMEOUT_MS`      | `1800000` | Idle connection timeout (30 min)          |
| `PING_INTERVAL_MS`     | `30000`   | WebSocket ping interval                   |
| `PONG_TIMEOUT_MS`      | `10000`   | Pong response timeout                     |
| `RECONNECT_ATTEMPTS`   | `3`       | Auto-reconnect attempts on TCP disconnect |
| `RECONNECT_DELAY_MS`   | `2000`    | Base delay between reconnect attempts     |

### Chat

| Variable            | Default | Description                             |
| ------------------- | ------- | --------------------------------------- |
| `CHAT_ENABLED`      | `true`  | Enable the in-proxy chat system         |
| `CHAT_MAX_LOG_SIZE` | `300`   | Maximum chat log entries in memory      |
| `ALLOWED_ORIGINS`   | `*`     | Comma-separated list of allowed origins |

### Character encoding

MUD servers use different character encodings. Modern servers typically use UTF-8, but non-English MUDs running on older drivers sometimes use other encodings.

The proxy handles encoding conversion transparently: it decodes MUD output from the configured encoding into UTF-8 before sending it to the WebSocket client, and encodes client input from UTF-8 back into the MUD's encoding.

The encoding for a connection is resolved using the following priority chain (highest to lowest):

1. **Telnet CHARSET negotiation** — if the MUD supports RFC 2066, encoding is negotiated automatically (typically UTF-8).
2. **Client parameter** — the client can send `encoding` in its connect message (e.g. `{ "encoding": "latin1", "connect": 1 }`). This can be passed from the web client via URL query parameter `?encoding=latin1`.
3. **Route encoding** — each named route in `MUD_ROUTES` can specify an `encoding` field:
   ```json
   {
     "my-mud": {"host": "my-mud", "port": 5000, "encoding": "latin1"}
   }
   ```
4. **`DEFAULT_ENCODING`** — environment variable, applied when no other source specifies an encoding.
5. **UTF-8** — if nothing is configured, data is passed through as-is (assumed UTF-8).

Supported encoding names are those recognized by [iconv-lite](https://github.com/ashtuchkin/iconv-lite) (e.g. `utf8`, `latin1`, `cp1252`, `iso-8859-15`, `cp437`).

### Host restrictions

When `ENABLE_LEGACY_ROUTING` is `true`, clients can specify any host and port to connect to. To restrict this, set `ALLOWED_HOSTS` to a comma-separated list of permitted hostnames:

```
ALLOWED_HOSTS: "muds.maldorne.org,mud.maldorne.org"
```

Connections to hosts not in the list will be rejected. Named routes (`MUD_ROUTES`) are not affected by this restriction — they always resolve to the configured host.

If `ALLOWED_HOSTS` is empty or not set, no restriction is applied.

## Development

```bash
npm run dev        # Start with tsx watch (auto-reload)
npm run build      # Compile TypeScript to dist/
npm run lint       # ESLint check
npm run lint:fix   # ESLint auto-fix
npm test           # Run all tests with coverage
npm run test:only  # Run tests without coverage
```

## Changelog

  * v1 ([@plamzi](https://github.com/plamzi)): Original version, part of [MUDPortal-Web-App](https://github.com/plamzi/MUDPortal-Web-App).
  * v2 ([@neverbot](https://github.com/neverbot)): Forked, separated client and proxy. Added `wss://` support.
  * v3 ([@neverbot](https://github.com/neverbot)): Ported to ES modules. Updated all dependencies.
  * v4 ([@neverbot](https://github.com/neverbot)): Full rewrite in TypeScript. Modular architecture, Docker support, Prometheus metrics, rate limiting, auto-reconnect, zod validation, e2e tests.
