/**
 * Simple Prometheus-compatible metrics collector.
 * No external dependencies — just counters and gauges exposed as text.
 */

class Metrics {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, () => number> = new Map();
  private labels: Map<string, string> = new Map();

  counter(name: string, help: string): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, 0);
      this.labels.set(name, help);
    }
  }

  gauge(name: string, help: string, fn: () => number): void {
    this.gauges.set(name, fn);
    this.labels.set(name, help);
  }

  inc(name: string, value = 1): void {
    const current = this.counters.get(name) ?? 0;
    this.counters.set(name, current + value);
  }

  get(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  serialize(): string {
    const lines: string[] = [];

    for (const [name, value] of this.counters) {
      const help = this.labels.get(name);
      if (help) lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }

    for (const [name, fn] of this.gauges) {
      const help = this.labels.get(name);
      if (help) lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${fn()}`);
    }

    return lines.join('\n') + '\n';
  }
}

export const metrics = new Metrics();

// Define all metrics
metrics.counter(
  'proxy_connections_total',
  'Total WebSocket connections accepted',
);
metrics.counter(
  'proxy_connections_rejected_total',
  'Total WebSocket connections rejected (max capacity or origin)',
);
metrics.counter(
  'proxy_tcp_connections_total',
  'Total TCP connections opened to MUD servers',
);
metrics.counter('proxy_tcp_errors_total', 'Total TCP connection errors');
metrics.counter(
  'proxy_messages_from_client_total',
  'Total messages received from WebSocket clients',
);
metrics.counter(
  'proxy_messages_from_mud_total',
  'Total messages received from MUD servers',
);
metrics.counter(
  'proxy_bytes_from_client_total',
  'Total bytes received from WebSocket clients',
);
metrics.counter(
  'proxy_bytes_from_mud_total',
  'Total bytes received from MUD servers',
);
metrics.counter(
  'proxy_rate_limited_total',
  'Total connections rejected by rate limiter',
);
metrics.counter(
  'proxy_reconnect_attempts_total',
  'Total automatic reconnection attempts',
);
metrics.counter(
  'proxy_reconnect_successes_total',
  'Total successful automatic reconnections',
);
