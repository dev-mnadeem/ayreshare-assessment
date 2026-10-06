import { describe, expect, it } from 'vitest';

import { centsToUsd, hasAtMostTwoDecimals, usdToCents } from '../../src/lib/money.js';

describe('money', () => {
  it.each([0, 1, 20, 19.99, 0.1, 0.29, 1.15, 4.35, 1234567.89])(
    'accepts %s as having at most 2 decimals',
    (amount) => {
      expect(hasAtMostTwoDecimals(amount)).toBe(true);
    },
  );

  it.each([10.001, 0.005, 19.999, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (amount) => {
    expect(hasAtMostTwoDecimals(amount)).toBe(false);
  });

  it.each([
    [19.99, 1999],
    [0.29, 29],
    [1.15, 115],
    [4.35, 435],
    [20, 2000],
  ])('converts %s USD to %s cents exactly', (usd, cents) => {
    expect(usdToCents(usd)).toBe(cents);
  });

  it('converts cents back to USD', () => {
    expect(centsToUsd(1999)).toBe(19.99);
  });
});
