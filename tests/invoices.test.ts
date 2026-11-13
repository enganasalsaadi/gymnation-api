import { describe, expect, it } from 'vitest';
import type { CountryCode } from '../src/domain/countries';
import { parseDate } from '../src/domain/dates';
import { invoicesBetween, type Schedule } from '../src/domain/invoices';

function schedule(country: CountryCode, monthly: number, joiningFee: number, start: string, dueDay: number): Schedule {
  return { country, monthly, joiningFee, startDate: parseDate(start)!, dueDay };
}

const between = (s: Schedule, from: string, to: string) => invoicesBetween(s, parseDate(from)!, parseDate(to)!);

describe('golden examples from the brief', () => {
  it('SA 29900, start 2026-09-20, due_day 1', () => {
    const invoices = between(schedule('SA', 29900, 0, '2026-09-20', 1), '2026-09-01', '2026-12-31');
    expect(invoices).toEqual([
      {
        invoice_no: 1,
        due_date: '2026-09-20',
        kind: 'FIRST',
        proration: { days: 11, cycle_days: 30 },
        net: 10963,
        vat: 1644,
        total: 12607,
        currency: 'SAR',
      },
      { invoice_no: 2, due_date: '2026-10-01', kind: 'MONTHLY', proration: null, net: 29900, vat: 4485, total: 34385, currency: 'SAR' },
      { invoice_no: 3, due_date: '2026-11-01', kind: 'MONTHLY', proration: null, net: 29900, vat: 4485, total: 34385, currency: 'SAR' },
      { invoice_no: 4, due_date: '2026-12-01', kind: 'MONTHLY', proration: null, net: 29900, vat: 4485, total: 34385, currency: 'SAR' },
    ]);
  });

  it('AE 24900 + 9900 joining fee, start 2026-09-05, due_day 20', () => {
    const invoices = between(schedule('AE', 24900, 9900, '2026-09-05', 20), '2026-09-01', '2026-09-30');
    expect(invoices).toEqual([
      {
        invoice_no: 1,
        due_date: '2026-09-05',
        kind: 'FIRST',
        proration: { days: 15, cycle_days: 31 },
        net: 21948,
        vat: 1097,
        total: 23045,
        currency: 'AED',
      },
      { invoice_no: 2, due_date: '2026-09-20', kind: 'MONTHLY', proration: null, net: 24900, vat: 1245, total: 26145, currency: 'AED' },
    ]);
  });
});

describe('first invoice', () => {
  it('charges the full price when start_date is itself a due date', () => {
    const [first, second] = between(schedule('SA', 29900, 0, '2026-09-01', 1), '2026-09-01', '2026-10-01');
    expect(first).toMatchObject({ proration: { days: 30, cycle_days: 30 }, net: 29900, vat: 4485, total: 34385 });
    expect(second).toMatchObject({ invoice_no: 2, due_date: '2026-10-01' });
  });

  it('charges the full price when start_date is a clamped due date (28 Feb, due_day 31)', () => {
    const [first, second] = between(schedule('AE', 10000, 0, '2027-02-28', 31), '2027-02-01', '2027-03-31');
    expect(first).toMatchObject({ due_date: '2027-02-28', proration: { days: 31, cycle_days: 31 }, net: 10000 });
    expect(second).toMatchObject({ invoice_no: 2, due_date: '2027-03-31' });
  });

  it('computes P from the anchor, not from N day number (due_day 31, N = 31 Mar)', () => {
    const [first] = between(schedule('AE', 2800, 0, '2027-03-15', 31), '2027-03-01', '2027-03-31');
    // N = 2027-03-31, P = 2027-02-28: D = 16, C = 31.
    expect(first).toMatchObject({ proration: { days: 16, cycle_days: 31 } });
  });

  it('rounds the proration half up (101 * 15 / 30 = 50.5 -> 51)', () => {
    const [first] = between(schedule('SA', 101, 0, '2026-09-16', 1), '2026-09-16', '2026-09-16');
    // VAT: 51 * 15 / 100 = 7.65 -> 8
    expect(first).toMatchObject({ proration: { days: 15, cycle_days: 30 }, net: 51, vat: 8, total: 59 });
  });

  it('puts the joining fee in the VAT base and only on the first invoice', () => {
    const [first, second] = between(schedule('SA', 10000, 5000, '2026-09-01', 1), '2026-09-01', '2026-10-01');
    expect(first).toMatchObject({ net: 15000, vat: 2250, total: 17250 });
    expect(second).toMatchObject({ net: 10000, vat: 1500, total: 11500 });
  });
});

describe('due date clamping', () => {
  it('due_day 31 across a non-leap year', () => {
    const dates = between(schedule('AE', 1000, 0, '2027-01-31', 31), '2027-01-01', '2027-04-30').map((i) => i.due_date);
    expect(dates).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });

  it('due_day 31 in a leap year lands on 29 Feb', () => {
    const dates = between(schedule('AE', 1000, 0, '2028-01-31', 31), '2028-01-01', '2028-03-31').map((i) => i.due_date);
    expect(dates).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('due_day 30 clamps in February and returns to 30', () => {
    const dates = between(schedule('AE', 1000, 0, '2027-01-30', 30), '2027-01-01', '2027-03-31').map((i) => i.due_date);
    expect(dates).toEqual(['2027-01-30', '2027-02-28', '2027-03-30']);
  });
});

describe('query window', () => {
  const s = schedule('SA', 29900, 0, '2026-01-15', 1);

  it('keeps invoice_no from the start of the schedule for a window in mid-history', () => {
    const invoices = between(s, '2026-06-01', '2026-07-31');
    expect(invoices.map((i) => [i.invoice_no, i.due_date])).toEqual([
      [6, '2026-06-01'],
      [7, '2026-07-01'],
    ]);
  });

  it('includes both endpoints', () => {
    expect(between(s, '2026-06-01', '2026-06-01').map((i) => i.invoice_no)).toEqual([6]);
    expect(between(s, '2026-01-15', '2026-01-15').map((i) => i.kind)).toEqual(['FIRST']);
  });

  it('returns nothing for a window entirely before the start date', () => {
    expect(between(s, '2025-01-01', '2026-01-14')).toEqual([]);
  });

  it('returns nothing for a window between two due dates', () => {
    expect(between(s, '2026-06-02', '2026-06-30')).toEqual([]);
  });

  it('never ends: invoices exist decades later', () => {
    const [invoice] = between(s, '2046-01-01', '2046-01-31');
    expect(invoice).toMatchObject({ invoice_no: 241, due_date: '2046-01-01', kind: 'MONTHLY' });
  });
});

describe('currencies', () => {
  it('BH uses fils (1000 per dinar) and rounds VAT half up', () => {
    const [first, second] = between(schedule('BH', 12345, 0, '2026-09-01', 1), '2026-09-01', '2026-10-01');
    // 12345 * 10 / 100 = 1234.5 -> 1235
    expect(first).toMatchObject({ net: 12345, vat: 1235, total: 13580, currency: 'BHD' });
    expect(second).toMatchObject({ net: 12345, vat: 1235, total: 13580, currency: 'BHD' });
  });
});
