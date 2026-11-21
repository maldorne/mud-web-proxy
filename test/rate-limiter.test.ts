import { expect } from 'chai';
import sinon from 'sinon';
import { RateLimiter } from '../src/rate-limiter.js';

describe('RateLimiter', () => {
  let clock: sinon.SinonFakeTimers;
  let limiter: RateLimiter;

  beforeEach(() => {
    process.env.LOG_LEVEL = 'silent';
    clock = sinon.useFakeTimers({ now: 1_000_000 });
    limiter = new RateLimiter(3, 60_000);
  });

  afterEach(() => {
    limiter.destroy();
    clock.restore();
  });

  it('should allow up to maxPerWindow requests', () => {
    expect(limiter.allow('1.2.3.4')).to.be.true;
    expect(limiter.allow('1.2.3.4')).to.be.true;
    expect(limiter.allow('1.2.3.4')).to.be.true;
  });

  it('should reject requests over the limit within the window', () => {
    for (let i = 0; i < 3; i++) limiter.allow('1.2.3.4');
    expect(limiter.allow('1.2.3.4')).to.be.false;
    expect(limiter.allow('1.2.3.4')).to.be.false;
  });

  it('should track each IP independently', () => {
    for (let i = 0; i < 3; i++) limiter.allow('1.2.3.4');
    expect(limiter.allow('1.2.3.4')).to.be.false;
    expect(limiter.allow('5.6.7.8')).to.be.true;
  });

  it('should allow again once the window has passed', () => {
    for (let i = 0; i < 4; i++) limiter.allow('1.2.3.4');
    expect(limiter.allow('1.2.3.4')).to.be.false;

    clock.tick(60_000);
    expect(limiter.allow('1.2.3.4')).to.be.true;
  });

  it('should not extend the window while rejecting', () => {
    for (let i = 0; i < 3; i++) limiter.allow('1.2.3.4');
    clock.tick(59_999);
    expect(limiter.allow('1.2.3.4')).to.be.false;
    clock.tick(1);
    expect(limiter.allow('1.2.3.4')).to.be.true;
  });

  it('should drop expired entries on periodic cleanup', () => {
    limiter.allow('1.2.3.4');
    limiter.allow('5.6.7.8');
    const limits = (limiter as unknown as { limits: Map<string, unknown> })
      .limits;
    expect(limits.size).to.equal(2);

    clock.tick(60_000);
    expect(limits.size).to.equal(0);
  });

  it('should keep entries that are still inside their window', () => {
    clock.tick(30_000);
    limiter.allow('1.2.3.4');
    clock.tick(30_000); // cleanup runs; entry expires at 90s
    const limits = (limiter as unknown as { limits: Map<string, unknown> })
      .limits;
    expect(limits.has('1.2.3.4')).to.be.true;
  });

  it('should stop the cleanup timer and clear state on destroy', () => {
    limiter.allow('1.2.3.4');
    limiter.destroy();
    expect(clock.countTimers()).to.equal(0);
  });
});
