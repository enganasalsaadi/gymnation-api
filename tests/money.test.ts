import { describe, expect, it } from 'vitest';
import { roundHalfUp } from '../src/domain/money';

describe('roundHalfUp', () => {
  it.each([
    [0n, 30n, 0n],
    [4n, 10n, 0n],
    [5n, 10n, 1n],
    [14n, 10n, 1n],
    [15n, 10n, 2n],
    [25n, 10n, 3n],
    [30n, 30n, 1n],
    // Golden SA proration: 29900 * 11 / 30 = 10963.33
    [29900n * 11n, 30n, 10963n],
    // Golden SA VAT: 10963 * 15 / 100 = 1644.45
    [10963n * 15n, 100n, 1644n],
    // Golden AE proration: 24900 * 15 / 31 = 12048.39
    [24900n * 15n, 31n, 12048n],
    // Golden AE VAT: 21948 * 5 / 100 = 1097.4
    [21948n * 5n, 100n, 1097n],
  ])('round_half_up(%i / %i) = %i', (num, den, expected) => {
    expect(roundHalfUp(num, den)).toBe(expected);
  });
});
