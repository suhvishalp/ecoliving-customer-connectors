import { describe, expect, it } from 'vitest';
import { decide, formatCustomerNumber } from '../src/services/customer-number.service.js';

describe('the customer number format', () => {
  it('is the prefix plus six zero-padded digits', () => {
    expect(formatCustomerNumber('EL-', 42)).toBe('EL-000042');
    expect(formatCustomerNumber('EL-', 1234567)).toBe('EL-1234567');
  });
});

describe('the rule — fill a gap, never overwrite', () => {
  it('assigns the allocated number when the draft has none', () => {
    expect(decide({}, 'EL-000042')).toEqual({
      actions: [{ action: 'setCustomerNumber', customerNumber: 'EL-000042' }],
      summary: 'assigned EL-000042',
    });
  });

  it('keeps a number the caller supplied — an import or a Merchant Center user', () => {
    const r = decide({ customerNumber: 'LEGACY-7' }, 'EL-000042');
    expect(r.actions).toEqual([]);
    expect(r.summary).toContain('keeps LEGACY-7');
  });

  it('approves without a number when none could be allocated (fail open)', () => {
    const r = decide({}, null);
    expect(r.actions).toEqual([]);
    expect(r.summary).toContain('approved without one');
  });
});
