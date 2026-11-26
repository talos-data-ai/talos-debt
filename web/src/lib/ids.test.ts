import { describe, expect, it } from 'vitest';
import { ibanOk, saudiIdOk, vatOk } from './ids';

describe('setup number checks (same as the API)', () => {
  it('ID numbers pass their check digit', () => {
    expect(saudiIdOk('2000000105')).toBe(true);
    expect(saudiIdOk('2000000100')).toBe(false);
    expect(saudiIdOk('3000000105')).toBe(false);
  });
  it('IBANs pass the mod 97 check', () => {
    expect(ibanOk('SA0380000000608010167519')).toBe(true);
    expect(ibanOk('SA0380000000608010167518')).toBe(false);
    expect(ibanOk('SA038000000060801016751')).toBe(false);
  });
  it('VAT numbers have 15 digits and start and end with 3', () => {
    expect(vatOk('300000000000003')).toBe(true);
    expect(vatOk('100000000000003')).toBe(false);
  });
});
