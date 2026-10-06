/**
 * USD amounts arrive as JSON numbers (e.g. 19.99) but are held as integer cents internally.
 * Binary floats can't represent most decimals exactly (19.99 * 100 === 1998.9999999999998),
 * so comparisons use a tolerance far below one cent and conversion rounds.
 */
const CENT_TOLERANCE = 1e-6;

export function hasAtMostTwoDecimals(amount: number): boolean {
  if (!Number.isFinite(amount)) return false;
  const cents = amount * 100;
  return Math.abs(cents - Math.round(cents)) < CENT_TOLERANCE;
}

/** Converts a USD amount to integer cents. Callers must validate with hasAtMostTwoDecimals first. */
export function usdToCents(amount: number): number {
  return Math.round(amount * 100);
}

export function centsToUsd(cents: number): number {
  return cents / 100;
}
