import { expect } from 'chai';
import { Router } from '../src/router.js';
import { loadConfig } from '../src/config.js';
import type { ProxyConfig } from '../src/types.js';

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  const base = loadConfig();
  return { ...base, ...overrides };
}

describe('Router', () => {
  it('should resolve a MUD name to internal route', () => {
    const config = makeConfig({
      routes: {
        iluminado: { host: 'iluminado', port: 5000 },
      },
    });
    const router = new Router(config);
    const route = router.resolve({ mud: 'iluminado' });
    expect(route).to.deep.equal({ host: 'iluminado', port: 5000 });
  });

  it('should throw for unknown MUD name', () => {
    const config = makeConfig({
      routes: {
        iluminado: { host: 'iluminado', port: 5000 },
      },
    });
    const router = new Router(config);
    expect(() => router.resolve({ mud: 'unknown' })).to.throw(/Unknown MUD "unknown"/);
  });

  it('should use legacy routing when enabled and no mud field', () => {
    const config = makeConfig({
      enableLegacyRouting: true,
      defaultHost: 'default.example.com',
      defaultPort: 9999,
    });
    const router = new Router(config);

    const route = router.resolve({ host: 'custom.example.com', port: 7000 });
    expect(route).to.deep.equal({ host: 'custom.example.com', port: 7000 });
  });

  it('should use defaults for legacy routing when host/port not provided', () => {
    const config = makeConfig({
      enableLegacyRouting: true,
      defaultHost: 'default.example.com',
      defaultPort: 9999,
    });
    const router = new Router(config);

    const route = router.resolve({});
    expect(route).to.deep.equal({ host: 'default.example.com', port: 9999 });
  });

  it('should reject when no mud field and legacy routing disabled', () => {
    const config = makeConfig({ enableLegacyRouting: false });
    const router = new Router(config);
    expect(() => router.resolve({})).to.throw(/legacy routing is disabled/);
  });

  it('should prefer mud field over host/port', () => {
    const config = makeConfig({
      enableLegacyRouting: true,
      routes: {
        iluminado: { host: 'iluminado', port: 5000 },
      },
    });
    const router = new Router(config);
    const route = router.resolve({
      mud: 'iluminado',
      host: 'should-be-ignored',
      port: 9999,
    });
    expect(route).to.deep.equal({ host: 'iluminado', port: 5000 });
  });
});
