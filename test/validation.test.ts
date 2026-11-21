import { expect } from 'chai';
import { clientMessageSchema } from '../src/validation.js';

const ok = (msg: unknown) => clientMessageSchema.safeParse(msg).success;

describe('clientMessageSchema', () => {
  it('should accept a typical connect message', () => {
    expect(
      ok({
        connect: 1,
        mud: 'maldorne',
        utf8: 1,
        mccp: 0,
        ttype: 'maldorne.org',
        name: 'guest',
        client: 'mud-web-client',
      }),
    ).to.be.true;
  });

  it('should accept a legacy host/port connect message', () => {
    expect(ok({ connect: 1, host: 'muds.example.com', port: 5010 })).to.be
      .true;
  });

  it('should accept an empty object', () => {
    expect(ok({})).to.be.true;
  });

  it('should keep unknown keys (passthrough)', () => {
    const result = clientMessageSchema.safeParse({ extra: 'x' });
    expect(result.success).to.be.true;
    expect(result.data).to.have.property('extra', 'x');
  });

  describe('field types', () => {
    it('should reject connect values other than 1', () => {
      expect(ok({ connect: 0 })).to.be.false;
      expect(ok({ connect: '1' })).to.be.false;
    });

    it('should reject non-numeric or fractional ports', () => {
      expect(ok({ port: '5010' })).to.be.false;
      expect(ok({ port: 50.5 })).to.be.false;
    });

    it('should reject out-of-range ports', () => {
      expect(ok({ port: 0 })).to.be.false;
      expect(ok({ port: 65536 })).to.be.false;
      expect(ok({ port: 1 })).to.be.true;
      expect(ok({ port: 65535 })).to.be.true;
    });

    it('should reject flags outside 0/1', () => {
      for (const key of ['mccp', 'utf8', 'debug']) {
        expect(ok({ [key]: 2 }), key).to.be.false;
        expect(ok({ [key]: -1 }), key).to.be.false;
        expect(ok({ [key]: true }), key).to.be.false;
      }
    });

    it('should reject non-string text fields', () => {
      for (const key of ['mud', 'host', 'ttype', 'name', 'gmcp', 'msg']) {
        expect(ok({ [key]: 42 }), key).to.be.false;
      }
    });
  });

  describe('size limits', () => {
    const cases: [string, number][] = [
      ['mud', 64],
      ['host', 255],
      ['ttype', 64],
      ['name', 64],
      ['client', 128],
      ['encoding', 32],
      ['channel', 32],
      ['msg', 4096],
      ['gmcp', 4096],
    ];

    for (const [key, max] of cases) {
      it(`should cap ${key} at ${max} characters`, () => {
        expect(ok({ [key]: 'a'.repeat(max) })).to.be.true;
        expect(ok({ [key]: 'a'.repeat(max + 1) })).to.be.false;
      });
    }
  });

  describe('bin', () => {
    it('should accept byte arrays', () => {
      expect(ok({ bin: [0, 255, 13, 10] })).to.be.true;
    });

    it('should reject values outside 0-255 or non-integers', () => {
      expect(ok({ bin: [256] })).to.be.false;
      expect(ok({ bin: [-1] })).to.be.false;
      expect(ok({ bin: [1.5] })).to.be.false;
      expect(ok({ bin: ['a'] })).to.be.false;
    });

    it('should cap the array at 4096 entries', () => {
      expect(ok({ bin: new Array(4096).fill(0) })).to.be.true;
      expect(ok({ bin: new Array(4097).fill(0) })).to.be.false;
    });

    it('should reject an oversized array quickly', () => {
      // Regression guard for GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6): oversized
      // constrained collections were fully validated before the max check.
      const start = Date.now();
      expect(ok({ bin: new Array(1_000_000).fill(0) })).to.be.false;
      expect(Date.now() - start).to.be.below(500);
    });
  });

  describe('msdp', () => {
    it('should accept a string value', () => {
      expect(ok({ msdp: { key: 'SEND', val: 'HEALTH' } })).to.be.true;
    });

    it('should accept an array value', () => {
      expect(ok({ msdp: { key: 'REPORT', val: ['HEALTH', 'MANA'] } })).to.be
        .true;
    });

    it('should require key and val', () => {
      expect(ok({ msdp: { key: 'SEND' } })).to.be.false;
      expect(ok({ msdp: { val: 'HEALTH' } })).to.be.false;
    });

    it('should cap key and value lengths', () => {
      expect(ok({ msdp: { key: 'a'.repeat(129), val: 'x' } })).to.be.false;
      expect(ok({ msdp: { key: 'k', val: 'a'.repeat(1025) } })).to.be.false;
      expect(ok({ msdp: { key: 'k', val: ['a'.repeat(1025)] } })).to.be.false;
    });

    it('should cap the number of array values at 256', () => {
      expect(ok({ msdp: { key: 'k', val: new Array(256).fill('v') } })).to.be
        .true;
      expect(ok({ msdp: { key: 'k', val: new Array(257).fill('v') } })).to.be
        .false;
    });
  });
});
