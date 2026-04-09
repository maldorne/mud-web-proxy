import { expect } from 'chai';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return defaults when no env vars are set', () => {
    const config = loadConfig();
    expect(config.wsPort).to.equal(6200);
    expect(config.defaultHost).to.equal('muds.maldorne.org');
    expect(config.defaultPort).to.equal(5010);
    expect(config.debug).to.be.false;
    expect(config.compress).to.be.true;
    expect(config.enableLegacyRouting).to.be.true;
    expect(config.maxConnections).to.equal(500);
    expect(config.tls.enabled).to.be.false;
    expect(config.chat.enabled).to.be.true;
    expect(config.allowedOrigins).to.deep.equal(['*']);
    expect(config.routes).to.deep.equal({});
  });

  it('should parse env vars correctly', () => {
    process.env.WS_PORT = '8080';
    process.env.DEFAULT_HOST = 'test.example.com';
    process.env.DEFAULT_PORT = '9000';
    process.env.DEBUG = 'true';
    process.env.COMPRESS = 'false';
    process.env.ENABLE_LEGACY_ROUTING = 'false';
    process.env.MAX_CONNECTIONS = '100';
    process.env.ALLOWED_ORIGINS = 'https://a.com,https://b.com';

    const config = loadConfig();
    expect(config.wsPort).to.equal(8080);
    expect(config.defaultHost).to.equal('test.example.com');
    expect(config.defaultPort).to.equal(9000);
    expect(config.debug).to.be.true;
    expect(config.compress).to.be.false;
    expect(config.enableLegacyRouting).to.be.false;
    expect(config.maxConnections).to.equal(100);
    expect(config.allowedOrigins).to.deep.equal([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('should parse MUD_ROUTES from JSON', () => {
    process.env.MUD_ROUTES = JSON.stringify({
      iluminado: { host: 'iluminado', port: 5000 },
      'hexagon-en': { host: 'hexagon-en', port: 5000 },
    });

    const config = loadConfig();
    expect(config.routes).to.have.property('iluminado');
    expect(config.routes.iluminado).to.deep.equal({
      host: 'iluminado',
      port: 5000,
    });
    expect(config.routes['hexagon-en']).to.deep.equal({
      host: 'hexagon-en',
      port: 5000,
    });
  });

  it('should handle invalid MUD_ROUTES gracefully', () => {
    process.env.MUD_ROUTES = 'not json';
    const config = loadConfig();
    expect(config.routes).to.deep.equal({});
  });

  it('should handle invalid port numbers with defaults', () => {
    process.env.WS_PORT = 'abc';
    const config = loadConfig();
    expect(config.wsPort).to.equal(6200);
  });
});
