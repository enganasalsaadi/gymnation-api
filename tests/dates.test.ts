import { describe, expect, it } from 'vitest';
import { daysBetween, daysInMonth, dueDateIn, formatDate, monthBounds, parseDate, parseMonth } from '../src/domain/dates';

describe('parseDate', () => {
  it.each(['2026-09-20', '2028-02-29', '2026-12-31', '2026-01-01', '2000-02-29'])('accepts %s', (text) => {
    const date = parseDate(text);
    expect(date).not.toBeNull();
    expect(formatDate(date!)).toBe(text);
  });

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-1-01',
    '2026-01-1',
    '26-01-01',
    ' 2026-01-01',
    '2026-01-01 ',
    '2026-01-01T00:00:00Z',
    '2026/01/01',
    '',
  ])('rejects %j', (text) => {
    expect(parseDate(text)).toBeNull();
  });
});

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2028, 2, 29],
    [1900, 2, 28],
    [2000, 2, 29],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i has %i days', (year, month, days) => {
    expect(daysInMonth(year, month)).toBe(days);
  });
});

describe('dueDateIn', () => {
  it('clamps due_day 31 to the month length and keeps the anchor', () => {
    expect([1, 2, 3, 4].map((m) => formatDate(dueDateIn(2027, m, 31)))).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
    expect(formatDate(dueDateIn(2028, 2, 31))).toBe('2028-02-29');
  });
});

describe('daysBetween', () => {
  it('counts calendar days across months, years and leap days', () => {
    const d = (text: string) => parseDate(text)!;
    expect(daysBetween(d('2026-09-20'), d('2026-10-01'))).toBe(11);
    expect(daysBetween(d('2026-08-20'), d('2026-09-20'))).toBe(31);
    expect(daysBetween(d('2028-02-28'), d('2028-03-01'))).toBe(2);
    expect(daysBetween(d('2026-12-31'), d('2027-01-01'))).toBe(1);
    expect(daysBetween(d('2026-01-01'), d('2027-01-02'))).toBe(366);
    expect(daysBetween(d('2026-10-01'), d('2026-09-20'))).toBe(-11);
  });
});

describe('parseMonth', () => {
  it.each(['2026-10', '2028-02', '0001-01', '9999-12'])('accepts %s', (text) => {
    expect(parseMonth(text)).not.toBeNull();
  });

  it.each(['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', '2026/10', ' 2026-10', '2026-10 ', ''])('rejects %j', (text) => {
    expect(parseMonth(text)).toBeNull();
  });

  it('gives the first and last day of a month, leap years included', () => {
    expect(monthBounds({ year: 2028, month: 2 })).toEqual({ first: { year: 2028, month: 2, day: 1 }, last: { year: 2028, month: 2, day: 29 } });
    expect(monthBounds({ year: 2026, month: 4 }).last.day).toBe(30);
  });
});
