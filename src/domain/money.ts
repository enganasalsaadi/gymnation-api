import { COUNTRIES, type CountryCode } from './countries';

/**
 * Money is integer minor units. Intermediate products use BigInt so nothing
 * loses precision, and nothing is ever a float.
 */

/** num / den rounded half up, for num >= 0 and den > 0. */
export function roundHalfUp(num: bigint, den: bigint): bigint {
  const quotient = num / den;
  const remainder = num % den;
  return quotient + (2n * remainder >= den ? 1n : 0n);
}

/** VAT on a net amount, rounded half up once. */
export function vatOn(net: bigint, country: CountryCode): bigint {
  const { num, den } = COUNTRIES[country].vat;
  return roundHalfUp(net * BigInt(num), BigInt(den));
}

/**
 * True when every invoice of a plan has a total that is a safe JS integer.
 * The largest net any invoice can have is monthly + joining_fee (the first
 * invoice with a full cycle), and VAT only grows with the net.
 */
export function totalsStaySafe(monthly: number, joiningFee: number, country: CountryCode): boolean {
  const worstNet = BigInt(monthly) + BigInt(joiningFee);
  return worstNet + vatOn(worstNet, country) <= BigInt(Number.MAX_SAFE_INTEGER);
}
