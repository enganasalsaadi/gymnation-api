import { describe, expect, it } from 'vitest';
import { type ExpectedInvoice, type GatewayRow, reconcile, rowErrors } from '../src/domain/reconciliation';

const row = (overrides: Partial<GatewayRow>): GatewayRow => ({
  gateway_txn_id: 'T-1',
  agreement_id: 'a1',
  amount: 1000,
  currency: 'SAR',
  status: 'SETTLED',
  attempted_on: '2026-10-05',
  ...overrides,
});

// a1 has two invoices in October with the same total, so the tie-break matters.
const expected: ExpectedInvoice[] = [
  { agreement_id: 'a1', invoice_no: 1, due_date: '2026-10-05', total: 1000, currency: 'SAR' },
  { agreement_id: 'a1', invoice_no: 2, due_date: '2026-10-20', total: 1000, currency: 'SAR' },
  { agreement_id: 'b2', invoice_no: 4, due_date: '2026-10-01', total: 5000, currency: 'AED' },
];

describe('rowErrors', () => {
  const currencies: Record<string, string> = { a1: 'SAR', b2: 'AED' };
  const currencyOf = (id: string) => currencies[id];

  it('returns no errors for a clean batch', () => {
    expect(rowErrors('2026-10', [row({})], currencyOf)).toEqual([]);
  });

  it('adds DUPLICATE_TXN for every row with a repeated id', () => {
    const rows = [row({ gateway_txn_id: 'T-9' }), row({ gateway_txn_id: 'T-1' }), row({ gateway_txn_id: 'T-9' }), row({ gateway_txn_id: 'T-9' })];
    expect(rowErrors('2026-10', rows, currencyOf)).toEqual([
      { gateway_txn_id: 'T-9', code: 'DUPLICATE_TXN' },
      { gateway_txn_id: 'T-9', code: 'DUPLICATE_TXN' },
      { gateway_txn_id: 'T-9', code: 'DUPLICATE_TXN' },
    ]);
  });

  it('treats ids as case-sensitive when finding duplicates', () => {
    expect(rowErrors('2026-10', [row({ gateway_txn_id: 't-1' }), row({ gateway_txn_id: 'T-1' })], currencyOf)).toEqual([]);
  });

  it.each(['2026-09-30', '2026-11-01', '2025-10-05'])('adds ROW_OUTSIDE_MONTH for %s in 2026-10', (attempted_on) => {
    expect(rowErrors('2026-10', [row({ attempted_on })], currencyOf)).toEqual([{ gateway_txn_id: 'T-1', code: 'ROW_OUTSIDE_MONTH' }]);
  });

  it('accepts the first and last day of the month', () => {
    const rows = [row({ gateway_txn_id: 'A', attempted_on: '2026-10-01' }), row({ gateway_txn_id: 'B', attempted_on: '2026-10-31' })];
    expect(rowErrors('2026-10', rows, currencyOf)).toEqual([]);
  });

  it('adds CURRENCY_MISMATCH when a known agreement has another currency', () => {
    expect(rowErrors('2026-10', [row({ currency: 'AED' })], currencyOf)).toEqual([{ gateway_txn_id: 'T-1', code: 'CURRENCY_MISMATCH' }]);
  });

  it('skips the currency check for an unknown agreement', () => {
    expect(rowErrors('2026-10', [row({ agreement_id: 'zz', currency: 'USD' })], currencyOf)).toEqual([]);
  });

  it('checks declined rows too', () => {
    expect(rowErrors('2026-10', [row({ status: 'DECLINED', currency: 'BHD' })], currencyOf)).toEqual([
      { gateway_txn_id: 'T-1', code: 'CURRENCY_MISMATCH' },
    ]);
  });

  it('lists every problem in row order, and each row in code order', () => {
    const rows = [
      row({ gateway_txn_id: 'X', attempted_on: '2026-11-01' }),
      row({ gateway_txn_id: 'D', attempted_on: '2026-09-01', currency: 'AED' }),
      row({ gateway_txn_id: 'D' }),
    ];
    expect(rowErrors('2026-10', rows, currencyOf)).toEqual([
      { gateway_txn_id: 'X', code: 'ROW_OUTSIDE_MONTH' },
      { gateway_txn_id: 'D', code: 'DUPLICATE_TXN' },
      { gateway_txn_id: 'D', code: 'ROW_OUTSIDE_MONTH' },
      { gateway_txn_id: 'D', code: 'CURRENCY_MISMATCH' },
      { gateway_txn_id: 'D', code: 'DUPLICATE_TXN' },
    ]);
  });
});

describe('reconcile', () => {
  const verdictOf = (rows: GatewayRow[], expectedInvoices = expected) => reconcile(rows, expectedInvoices).rows;

  it('MATCHED when one settled row pays on the due date', () => {
    expect(verdictOf([row({ amount: 5000, agreement_id: 'b2', attempted_on: '2026-10-01' })])).toEqual([
      { gateway_txn_id: 'T-1', verdict: 'MATCHED', invoice: { agreement_id: 'b2', invoice_no: 4 } },
    ]);
  });

  it('DUE_DAY_DRIFT when one settled row pays on another day', () => {
    expect(verdictOf([row({ amount: 5000, agreement_id: 'b2', attempted_on: '2026-10-03' })])[0]).toMatchObject({
      verdict: 'DUE_DAY_DRIFT',
      invoice: { agreement_id: 'b2', invoice_no: 4 },
    });
  });

  it.each([
    [4999, 'MATCHED'],
    [5001, 'MATCHED'],
    [4998, 'MISSING_FROM_LEDGER'],
    [5002, 'MISSING_FROM_LEDGER'],
  ])('amount %i against total 5000 gives %s', (amount, verdict) => {
    expect(verdictOf([row({ amount, agreement_id: 'b2', attempted_on: '2026-10-01' })])[0]!.verdict).toBe(verdict);
  });

  it('MISSING_FROM_LEDGER with invoice null for an unknown agreement', () => {
    expect(verdictOf([row({ agreement_id: 'zz' })])).toEqual([{ gateway_txn_id: 'T-1', verdict: 'MISSING_FROM_LEDGER', invoice: null }]);
  });

  it('only matches invoices of the same agreement', () => {
    expect(verdictOf([row({ agreement_id: 'a1', amount: 5000, attempted_on: '2026-10-01' })])[0]!.verdict).toBe('MISSING_FROM_LEDGER');
  });

  it('DECLINED rows get invoice null and leave the invoice unmatched', () => {
    const result = reconcile([row({ status: 'DECLINED', amount: 5000, agreement_id: 'b2', attempted_on: '2026-10-01' })], expected);
    expect(result.rows).toEqual([{ gateway_txn_id: 'T-1', verdict: 'DECLINED', invoice: null }]);
    expect(result.unmatched_invoices.map((i) => i.invoice_no)).toEqual([4, 1, 2]);
  });

  it('a declined row does not turn a single settled row into a double charge', () => {
    const rows = [
      row({ gateway_txn_id: 'D', status: 'DECLINED', amount: 5000, agreement_id: 'b2', attempted_on: '2026-10-01' }),
      row({ gateway_txn_id: 'S', amount: 5000, agreement_id: 'b2', attempted_on: '2026-10-01' }),
    ];
    expect(verdictOf(rows).map((r) => r.verdict)).toEqual(['DECLINED', 'MATCHED']);
  });

  it('breaks a tie between candidates by the earliest due date', () => {
    expect(verdictOf([row({ attempted_on: '2026-10-20' })])[0]).toMatchObject({
      verdict: 'DUE_DAY_DRIFT',
      invoice: { agreement_id: 'a1', invoice_no: 1 },
    });
  });

  it('gives DOUBLE_CHARGE_RISK to every settled row linked to the same invoice', () => {
    const rows = [
      row({ gateway_txn_id: 'A', attempted_on: '2026-10-05' }),
      row({ gateway_txn_id: 'B', attempted_on: '2026-10-20' }),
      row({ gateway_txn_id: 'C', attempted_on: '2026-10-21', amount: 1001 }),
    ];
    const result = reconcile(rows, expected);
    expect(result.rows.map((r) => [r.gateway_txn_id, r.verdict, r.invoice?.invoice_no])).toEqual([
      ['A', 'DOUBLE_CHARGE_RISK', 1],
      ['B', 'DOUBLE_CHARGE_RISK', 1],
      ['C', 'DOUBLE_CHARGE_RISK', 1],
    ]);
    expect(result.summary.DOUBLE_CHARGE_RISK).toBe(3);
    expect(result.unmatched_invoices.map((i) => [i.agreement_id, i.invoice_no])).toEqual([
      ['b2', 4],
      ['a1', 2],
    ]);
  });

  it('returns every summary key, with zeros, for an empty batch', () => {
    const result = reconcile([], []);
    expect(result).toEqual({
      summary: { MATCHED: 0, DUE_DAY_DRIFT: 0, DOUBLE_CHARGE_RISK: 0, MISSING_FROM_LEDGER: 0, DECLINED: 0 },
      rows: [],
      unmatched_invoices: [],
    });
  });

  it('counts each verdict in the summary', () => {
    const rows = [
      row({ gateway_txn_id: 'M', amount: 5000, agreement_id: 'b2', attempted_on: '2026-10-01' }),
      row({ gateway_txn_id: 'R', attempted_on: '2026-10-06' }),
      row({ gateway_txn_id: 'L', agreement_id: 'zz' }),
      row({ gateway_txn_id: 'X', status: 'DECLINED' }),
    ];
    expect(reconcile(rows, expected).summary).toEqual({
      MATCHED: 1,
      DUE_DAY_DRIFT: 1,
      DOUBLE_CHARGE_RISK: 0,
      MISSING_FROM_LEDGER: 1,
      DECLINED: 1,
    });
  });

  it('sorts unmatched invoices by due_date, then agreement_id, then invoice_no', () => {
    const invoices: ExpectedInvoice[] = [
      { agreement_id: 'b', invoice_no: 2, due_date: '2026-10-05', total: 1, currency: 'AED' },
      { agreement_id: 'a', invoice_no: 9, due_date: '2026-10-05', total: 1, currency: 'AED' },
      { agreement_id: 'a', invoice_no: 3, due_date: '2026-10-05', total: 1, currency: 'AED' },
      { agreement_id: 'z', invoice_no: 1, due_date: '2026-10-01', total: 1, currency: 'AED' },
      { agreement_id: 'B', invoice_no: 1, due_date: '2026-10-05', total: 1, currency: 'AED' },
      { agreement_id: 'a', invoice_no: 10, due_date: '2026-10-05', total: 1, currency: 'AED' },
    ];
    expect(reconcile([], invoices).unmatched_invoices.map((i) => `${i.due_date} ${i.agreement_id} ${i.invoice_no}`)).toEqual([
      '2026-10-01 z 1',
      '2026-10-05 B 1',
      '2026-10-05 a 3',
      '2026-10-05 a 9',
      '2026-10-05 a 10',
      '2026-10-05 b 2',
    ]);
  });

  it('gives the same verdicts whatever the row order', () => {
    const rows = [
      row({ gateway_txn_id: 'A', attempted_on: '2026-10-20' }),
      row({ gateway_txn_id: 'B', attempted_on: '2026-10-05' }),
      row({ gateway_txn_id: 'C', amount: 5000, agreement_id: 'b2', attempted_on: '2026-10-02' }),
      row({ gateway_txn_id: 'D', agreement_id: 'zz' }),
      row({ gateway_txn_id: 'E', status: 'DECLINED', amount: 5000, agreement_id: 'b2' }),
    ];
    const byId = (rs: GatewayRow[]) => {
      const result = reconcile(rs, expected);
      return {
        rows: Object.fromEntries(result.rows.map((r) => [r.gateway_txn_id, r])),
        summary: result.summary,
        unmatched: result.unmatched_invoices,
      };
    };
    const baseline = byId(rows);
    for (const order of [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 4, 0, 3, 2]]) {
      expect(byId(order.map((i) => rows[i]!))).toEqual(baseline);
    }
  });

  it('keeps the rows in request order', () => {
    const rows = [row({ gateway_txn_id: 'Z' }), row({ gateway_txn_id: 'A', agreement_id: 'zz' }), row({ gateway_txn_id: 'M', status: 'DECLINED' })];
    expect(verdictOf(rows).map((r) => r.gateway_txn_id)).toEqual(['Z', 'A', 'M']);
  });
});
