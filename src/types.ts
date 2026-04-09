import type { WebSocket } from 'ws';
import type { Socket } from 'net';

export interface MudRoute {
  host: string;
  port: number;
}

export interface ProxyConfig {
  wsPort: number;
  defaultHost: string;
  defaultPort: number;
  debug: boolean;
  compress: boolean;
  allowedOrigins: string[];
  maxConnections: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
  pingIntervalMs: number;
  pongTimeoutMs: number;
  reconnectAttempts: number;
  reconnectDelayMs: number;
  rateLimitPerIp: number;
  rateLimitWindowMs: number;
  enableLegacyRouting: boolean;
  routes: Record<string, MudRoute>;
  tls: {
    enabled: boolean;
    certPath?: string;
    keyPath?: string;
  };
  chat: {
    enabled: boolean;
    maxLogSize: number;
  };
  ttype: {
    enabled: boolean;
    portal: string[];
  };
  gmcp: {
    enabled: boolean;
    portal: string[];
  };
}

export interface ClientMessage {
  mud?: string;
  host?: string;
  port?: number;
  connect?: 1;
  ttype?: string;
  name?: string;
  client?: string;
  mccp?: number;
  utf8?: number;
  debug?: number;
  chat?: 1;
  channel?: string;
  msg?: string;
  bin?: number[];
  msdp?: { key: string; val: string | string[] };
}

export interface TelnetOptionHandler {
  readonly option: number;
  negotiated: boolean;
  timeoutMs: number;
  handleIAC(verb: number, connection: ConnectionState): void;
  handleSB(data: Buffer, connection: ConnectionState): void;
  startTimeout(): void;
  clearTimeout(): void;
}

export interface ConnectionState {
  remoteAddress: string;
  name?: string;
  client?: string;
  mudId?: string;
  mccp: boolean;
  utf8: boolean;
  compressed: boolean;
  passwordMode: boolean;
  debugEnabled: boolean;
  ttype: string[];
  ws: WebSocket;
  tcp: Socket | null;
  writeTcp(data: Buffer | string): void;
  sendToClient(data: Buffer): void;
}

export interface ChatEntry {
  timestamp: Date;
  channel?: string;
  name?: string;
  msg?: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
