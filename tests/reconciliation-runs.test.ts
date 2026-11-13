import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { UUID_V4, useApp } from './helpers';

/**
 * Two agreements:
 * - SA: 29900 SAR, start 2026-09-20, due_day 1. Invoice 1 on 2026-09-20 (12607), invoice 2 on 2026-10-01 (34385).
 * - AE: 24900 AED + 9900 fee, start 2026-09-05, due_day 20. Invoice 1 on 2026-09-05 (23045),
 *   invoice 2 on 2026-09-20 (26145), invoice 3 on 2026-10-20 (26145).
 */
async function seed(app: FastifyInstance) {
  const post = async (url: string, payload: object) => (await app.inject({ method: 'POST', url, payload })).json();
  const saMember = await post('/members', { name: 'Noura', country: 'SA', phone: '0551234567' });
  const aeMember = await post('/members', { name: 'Omar', country: 'AE', phone: '0501234567' });
  await post('/plans', { id: 'anytime-sa', country: 'SA', monthly: 29900, joining_fee: 0 });
  await post('/plans', { id: 'flex-ae', country: 'AE', monthly: 24900, joining_fee: 9900 });
  const sa = await post('/agreements', { member_id: saMember.id, plan_id: 'anytime-sa', start_date: '2026-09-20', due_day: 1 });
  const ae = await post('/agreements', { member_id: aeMember.id, plan_id: 'flex-ae', start_date: '2026-09-05', due_day: 20 });
  return { sa: sa.id as string, ae: ae.id as string };
}

const settled = (gateway_txn_id: string, agreement_id: string, amount: number, currency: string, attempted_on: string) => ({
  gateway_txn_id,
  agreement_id,
  amount,
  currency,
  status: 'SETTLED',
  attempted_on,
});

describe('POST /reconciliation/runs', () => {
  const app = useApp();
  const run = (payload: unknown) => app().inject({ method: 'POST', url: '/reconciliation/runs', payload: payload as object });

  it('returns 201 with the full run', async () => {
    const { sa, ae } = await seed(app());
    const res = await run({ month: '2026-10', rows: [settled('T-88121', sa, 34385, 'SAR', '2026-10-01')] });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: expect.stringMatching(UUID_V4),
      month: '2026-10',
      summary: { MATCHED: 1, DUE_DAY_DRIFT: 0, DOUBLE_CHARGE_RISK: 0, MISSING_FROM_LEDGER: 0, DECLINED: 0 },
      rows: [{ gateway_txn_id: 'T-88121', verdict: 'MATCHED', invoice: { agreement_id: sa, invoice_no: 2 } }],
      unmatched_invoices: [{ agreement_id: ae, invoice_no: 3, due_date: '2026-10-20', total: 26145, currency: 'AED' }],
    });
    expect(Object.keys(res.json())).toEqual(['id', 'month', 'summary', 'rows', 'unmatched_invoices']);
  });

  it('accepts an empty batch and lists every expected invoice as unmatched', async () => {
    const { sa, ae } = await seed(app());
    const res = await run({ month: '2026-10', rows: [] });
    expect(res.statusCode).toBe(201);
    expect(res.json().summary).toEqual({ MATCHED: 0, DUE_DAY_DRIFT: 0, DOUBLE_CHARGE_RISK: 0, MISSING_FROM_LEDGER: 0, DECLINED: 0 });
    expect(res.json().unmatched_invoices.map((i: { agreement_id: string; invoice_no: number }) => [i.agreement_id, i.invoice_no])).toEqual([
      [sa, 2],
      [ae, 3],
    ]);
  });

  it('works with no agreements at all', async () => {
    const res = await run({ month: '2026-10', rows: [settled('T-1', 'agr_1', 100, 'SAR', '2026-10-01')] });
    expect(res.statusCode).toBe(201);
    expect(res.json().rows).toEqual([{ gateway_txn_id: 'T-1', verdict: 'MISSING_FROM_LEDGER', invoice: null }]);
    expect(res.json().unmatched_invoices).toEqual([]);
  });

  it('expects both the FIRST invoice and invoice 2 when they fall in the same month', async () => {
    const { sa, ae } = await seed(app());
    const res = await run({ month: '2026-09', rows: [settled('T-1', ae, 23045, 'AED', '2026-09-05')] });
    expect(res.json().rows[0]).toEqual({ gateway_txn_id: 'T-1', verdict: 'MATCHED', invoice: { agreement_id: ae, invoice_no: 1 } });
    expect(res.json().unmatched_invoices).toEqual([
      { agreement_id: ae, invoice_no: 2, due_date: '2026-09-20', total: 26145, currency: 'AED' },
      { agreement_id: sa, invoice_no: 1, due_date: '2026-09-20', total: 12607, currency: 'SAR' },
    ].sort((a, b) => (a.agreement_id < b.agreement_id ? -1 : 1)));
  });

  it('matches a difference of 1 minor unit and not 2', async () => {
    const { sa } = await seed(app());
    const res = await run({
      month: '2026-10',
      rows: [settled('T-1', sa, 34386, 'SAR', '2026-10-01'), settled('T-2', sa, 34387, 'SAR', '2026-10-01')],
    });
    expect(res.json().rows.map((r: { verdict: string }) => r.verdict)).toEqual(['MATCHED', 'MISSING_FROM_LEDGER']);
  });

  it('gives DUE_DAY_DRIFT for a payment on another day of the month', async () => {
    const { sa } = await seed(app());
    const res = await run({ month: '2026-10', rows: [settled('T-1', sa, 34385, 'SAR', '2026-10-03')] });
    expect(res.json().rows[0]).toMatchObject({ verdict: 'DUE_DAY_DRIFT', invoice: { agreement_id: sa, invoice_no: 2 } });
  });

  it('gives DOUBLE_CHARGE_RISK to both settled rows on one invoice', async () => {
    const { sa } = await seed(app());
    const res = await run({
      month: '2026-10',
      rows: [settled('T-1', sa, 34385, 'SAR', '2026-10-01'), settled('T-2', sa, 34385, 'SAR', '2026-10-02')],
    });
    expect(res.json().rows.map((r: { verdict: string }) => r.verdict)).toEqual(['DOUBLE_CHARGE_RISK', 'DOUBLE_CHARGE_RISK']);
    expect(res.json().summary.DOUBLE_CHARGE_RISK).toBe(2);
  });

  it('lists a declined-only invoice as unmatched', async () => {
    const { sa, ae } = await seed(app());
    const res = await run({
      month: '2026-10',
      rows: [
        { ...settled('T-1', sa, 34385, 'SAR', '2026-10-01'), status: 'DECLINED' },
        settled('T-2', ae, 26145, 'AED', '2026-10-20'),
      ],
    });
    expect(res.json().rows).toEqual([
      { gateway_txn_id: 'T-1', verdict: 'DECLINED', invoice: null },
      { gateway_txn_id: 'T-2', verdict: 'MATCHED', invoice: { agreement_id: ae, invoice_no: 3 } },
    ]);
    expect(res.json().unmatched_invoices).toEqual([
      { agreement_id: sa, invoice_no: 2, due_date: '2026-10-01', total: 34385, currency: 'SAR' },
    ]);
  });

  it('gives the same verdicts when the rows are shuffled', async () => {
    const { sa, ae } = await seed(app());
    const rows = [
      settled('A', sa, 34385, 'SAR', '2026-10-01'),
      settled('B', sa, 34384, 'SAR', '2026-10-09'),
      settled('C', ae, 26145, 'AED', '2026-10-21'),
      settled('D', 'agr_x', 500, 'SAR', '2026-10-01'),
      { ...settled('E', ae, 26145, 'AED', '2026-10-20'), status: 'DECLINED' },
    ];
    const verdicts = async (batch: object[]) => {
      const body = (await run({ month: '2026-10', rows: batch })).json();
      return { rows: Object.fromEntries(body.rows.map((r: { gateway_txn_id: string }) => [r.gateway_txn_id, r])), summary: body.summary, unmatched: body.unmatched_invoices };
    };
    const baseline = await verdicts(rows);
    expect(await verdicts([...rows].reverse())).toEqual(baseline);
    expect(await verdicts([rows[2], rows[4], rows[0], rows[3], rows[1]] as object[])).toEqual(baseline);
  });

  it('returns INVALID_ROWS with every error and stores nothing', async () => {
    const { sa } = await seed(app());
    const res = await run({
      month: '2026-10',
      rows: [
        settled('T-1', sa, 34385, 'SAR', '2026-10-01'),
        settled('T-1', sa, 34385, 'SAR', '2026-10-01'),
        settled('T-2', sa, 34385, 'AED', '2026-10-01'),
        settled('T-1', 'agr_unknown', 100, 'USD', '2026-11-01'),
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: {
        code: 'INVALID_ROWS',
        message: 'One or more gateway rows failed validation',
        errors: [
          { gateway_txn_id: 'T-1', code: 'DUPLICATE_TXN' },
          { gateway_txn_id: 'T-1', code: 'DUPLICATE_TXN' },
          { gateway_txn_id: 'T-2', code: 'CURRENCY_MISMATCH' },
          { gateway_txn_id: 'T-1', code: 'DUPLICATE_TXN' },
          { gateway_txn_id: 'T-1', code: 'ROW_OUTSIDE_MONTH' },
        ],
      },
    });
  });

  it('skips the currency check for an unknown agreement', async () => {
    await seed(app());
    const res = await run({ month: '2026-10', rows: [settled('T-1', 'agr_unknown', 100, 'USD', '2026-10-01')] });
    expect(res.statusCode).toBe(201);
    expect(res.json().rows[0].verdict).toBe('MISSING_FROM_LEDGER');
  });

  it('checks the currency of declined rows too', async () => {
    const { sa } = await seed(app());
    const res = await run({ month: '2026-10', rows: [{ ...settled('T-1', sa, 34385, 'AED', '2026-10-01'), status: 'DECLINED' }] });
    expect(res.json().error.errors).toEqual([{ gateway_txn_id: 'T-1', code: 'CURRENCY_MISMATCH' }]);
  });

  it('never changes agreements or their invoices', async () => {
    const { sa } = await seed(app());
    const invoices = async () => (await app().inject({ method: 'GET', url: `/agreements/${sa}/invoices?from=2026-09-01&to=2026-12-31` })).json();
    const before = await invoices();
    await run({ month: '2026-10', rows: [settled('T-1', sa, 34385, 'SAR', '2026-10-01'), settled('T-2', sa, 34385, 'SAR', '2026-10-01')] });
    expect(await invoices()).toEqual(before);
  });

  const row = settled('T-1', 'agr_1', 100, 'SAR', '2026-10-01');
  it.each([
    ['missing month', { rows: [] }],
    ['missing rows', { month: '2026-10' }],
    ['rows not an array', { month: '2026-10', rows: {} }],
    ['month 13', { month: '2026-13', rows: [] }],
    ['month without padding', { month: '2026-1', rows: [] }],
    ['month as a date', { month: '2026-10-01', rows: [] }],
    ['month as number', { month: 202610, rows: [] }],
    ['row null', { month: '2026-10', rows: [null] }],
    ['amount 0', { month: '2026-10', rows: [{ ...row, amount: 0 }] }],
    ['amount negative', { month: '2026-10', rows: [{ ...row, amount: -5 }] }],
    ['amount decimal', { month: '2026-10', rows: [{ ...row, amount: 100.5 }] }],
    ['amount as string', { month: '2026-10', rows: [{ ...row, amount: '100' }] }],
    ['amount beyond safe integers', { month: '2026-10', rows: [{ ...row, amount: 2 ** 60 }] }],
    ['status PENDING', { month: '2026-10', rows: [{ ...row, status: 'PENDING' }] }],
    ['status lowercase', { month: '2026-10', rows: [{ ...row, status: 'settled' }] }],
    ['attempted_on not a real day', { month: '2026-02', rows: [{ ...row, attempted_on: '2026-02-30' }] }],
    ['attempted_on malformed', { month: '2026-10', rows: [{ ...row, attempted_on: '2026-10-1' }] }],
    ['missing gateway_txn_id', { month: '2026-10', rows: [{ ...row, gateway_txn_id: undefined }] }],
    ['missing agreement_id', { month: '2026-10', rows: [{ ...row, agreement_id: undefined }] }],
    ['missing currency', { month: '2026-10', rows: [{ ...row, currency: undefined }] }],
    ['missing attempted_on', { month: '2026-10', rows: [{ ...row, attempted_on: undefined }] }],
  ])('returns VALIDATION for %s', async (_label, payload) => {
    const res = await run(payload);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: { code: 'VALIDATION', message: expect.any(String) } });
  });

  it('checks VALIDATION before INVALID_ROWS', async () => {
    const res = await run({ month: '2026-10', rows: [row, row, { ...row, gateway_txn_id: 'T-2', attempted_on: 'bad' }] });
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('GET /reconciliation/runs/:id', () => {
  const app = useApp();

  it('returns the identical body', async () => {
    const { sa } = await seed(app());
    const created = await app().inject({
      method: 'POST',
      url: '/reconciliation/runs',
      payload: { month: '2026-10', rows: [settled('T-1', sa, 34385, 'SAR', '2026-10-02')] },
    });
    const res = await app().inject({ method: 'GET', url: `/reconciliation/runs/${created.json().id}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(created.body);
  });

  it('keeps the stored snapshot when agreements are added later', async () => {
    const created = await app().inject({ method: 'POST', url: '/reconciliation/runs', payload: { month: '2026-10', rows: [] } });
    await seed(app());
    const res = await app().inject({ method: 'GET', url: `/reconciliation/runs/${created.json().id}` });
    expect(res.json().unmatched_invoices).toEqual([]);
    expect(res.body).toBe(created.body);
  });

  it('returns 404 NOT_FOUND for an unknown run', async () => {
    const res = await app().inject({ method: 'GET', url: '/reconciliation/runs/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});
