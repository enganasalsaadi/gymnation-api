import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { UUID_V4, useApp } from './helpers';

async function seed(app: FastifyInstance) {
  const sa = await app.inject({ method: 'POST', url: '/members', payload: { name: 'Noura', country: 'SA', phone: '0551234567' } });
  const ae = await app.inject({ method: 'POST', url: '/members', payload: { name: 'Omar', country: 'AE', phone: '0501234567' } });
  await app.inject({ method: 'POST', url: '/plans', payload: { id: 'anytime-sa', country: 'SA', monthly: 29900, joining_fee: 0 } });
  await app.inject({ method: 'POST', url: '/plans', payload: { id: 'flex-ae', country: 'AE', monthly: 24900, joining_fee: 9900 } });
  return { saMember: sa.json().id as string, aeMember: ae.json().id as string };
}

describe('POST /agreements', () => {
  const app = useApp();
  const create = (payload: unknown) => app().inject({ method: 'POST', url: '/agreements', payload: payload as object });

  it('creates an agreement and echoes its fields', async () => {
    const { saMember } = await seed(app());
    const res = await create({ member_id: saMember, plan_id: 'anytime-sa', start_date: '2026-09-20', due_day: 1 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: expect.stringMatching(UUID_V4),
      member_id: saMember,
      plan_id: 'anytime-sa',
      start_date: '2026-09-20',
      due_day: 1,
    });
  });

  it('lets a member hold several agreements', async () => {
    const { saMember } = await seed(app());
    const payload = { member_id: saMember, plan_id: 'anytime-sa', start_date: '2026-09-20', due_day: 1 };
    const first = await create(payload);
    const second = await create(payload);
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    expect(first.json().id).not.toBe(second.json().id);
  });

  it.each([1, 31])('accepts due_day %i', async (dueDay) => {
    const { saMember } = await seed(app());
    const res = await create({ member_id: saMember, plan_id: 'anytime-sa', start_date: '2026-09-20', due_day: dueDay });
    expect(res.statusCode).toBe(201);
  });

  it('accepts a leap day start date', async () => {
    const { saMember } = await seed(app());
    const res = await create({ member_id: saMember, plan_id: 'anytime-sa', start_date: '2028-02-29', due_day: 1 });
    expect(res.statusCode).toBe(201);
  });

  it('returns UNKNOWN_MEMBER', async () => {
    await seed(app());
    const res = await create({ member_id: 'nope', plan_id: 'anytime-sa', start_date: '2026-09-20', due_day: 1 });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: { code: 'UNKNOWN_MEMBER', message: expect.any(String) } });
  });

  it('returns UNKNOWN_PLAN', async () => {
    const { saMember } = await seed(app());
    const res = await create({ member_id: saMember, plan_id: 'nope', start_date: '2026-09-20', due_day: 1 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('UNKNOWN_PLAN');
  });

  it('returns PLAN_COUNTRY_MISMATCH when member and plan countries differ', async () => {
    const { aeMember } = await seed(app());
    const res = await create({ member_id: aeMember, plan_id: 'anytime-sa', start_date: '2026-09-20', due_day: 1 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('PLAN_COUNTRY_MISMATCH');
  });

  it('checks UNKNOWN_MEMBER before UNKNOWN_PLAN', async () => {
    const res = await create({ member_id: 'nope', plan_id: 'nope', start_date: '2026-09-20', due_day: 1 });
    expect(res.json().error.code).toBe('UNKNOWN_MEMBER');
  });

  it('checks VALIDATION before UNKNOWN_MEMBER', async () => {
    const res = await create({ member_id: 'nope', plan_id: 'nope', start_date: '2026-02-29', due_day: 1 });
    expect(res.json().error.code).toBe('VALIDATION');
  });

  const valid = { member_id: 'm', plan_id: 'p', start_date: '2026-09-20', due_day: 1 };
  it.each([
    ['due_day 0', { ...valid, due_day: 0 }],
    ['due_day 32', { ...valid, due_day: 32 }],
    ['due_day 1.5', { ...valid, due_day: 1.5 }],
    ['due_day as string', { ...valid, due_day: '1' }],
    ['missing due_day', { ...valid, due_day: undefined }],
    ['missing member_id', { ...valid, member_id: undefined }],
    ['member_id as number', { ...valid, member_id: 1 }],
    ['missing plan_id', { ...valid, plan_id: undefined }],
    ['missing start_date', { ...valid, start_date: undefined }],
    ['start_date not a real day', { ...valid, start_date: '2026-02-29' }],
    ['start_date 31 April', { ...valid, start_date: '2026-04-31' }],
    ['start_date without padding', { ...valid, start_date: '2026-9-20' }],
    ['start_date with time', { ...valid, start_date: '2026-09-20T00:00:00Z' }],
    ['start_date as number', { ...valid, start_date: 20260920 }],
  ])('returns VALIDATION for %s', async (_label, payload) => {
    const res = await create(payload);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: { code: 'VALIDATION', message: expect.any(String) } });
  });
});

describe('GET /agreements/:id/invoices', () => {
  const app = useApp();
  const invoices = (id: string, query: Record<string, string>) =>
    app().inject({ method: 'GET', url: `/agreements/${encodeURIComponent(id)}/invoices`, query });

  async function agreement(planId: 'anytime-sa' | 'flex-ae', startDate: string, dueDay: number): Promise<string> {
    const { saMember, aeMember } = await seed(app());
    const res = await app().inject({
      method: 'POST',
      url: '/agreements',
      payload: { member_id: planId === 'anytime-sa' ? saMember : aeMember, plan_id: planId, start_date: startDate, due_day: dueDay },
    });
    return res.json().id;
  }

  it('returns the SA golden schedule', async () => {
    const id = await agreement('anytime-sa', '2026-09-20', 1);
    const res = await invoices(id, { from: '2026-09-01', to: '2026-12-31' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(4);
    expect(body[0]).toEqual({
      invoice_no: 1,
      due_date: '2026-09-20',
      kind: 'FIRST',
      proration: { days: 11, cycle_days: 30 },
      net: 10963,
      vat: 1644,
      total: 12607,
      currency: 'SAR',
    });
    expect(body[1]).toEqual({
      invoice_no: 2,
      due_date: '2026-10-01',
      kind: 'MONTHLY',
      proration: null,
      net: 29900,
      vat: 4485,
      total: 34385,
      currency: 'SAR',
    });
  });

  it('returns the AE golden first invoice and invoice 2 on 2026-09-20', async () => {
    const id = await agreement('flex-ae', '2026-09-05', 20);
    const body = (await invoices(id, { from: '2026-09-05', to: '2026-09-20' })).json();
    expect(body.map((i: { invoice_no: number; due_date: string; total: number }) => [i.invoice_no, i.due_date, i.total])).toEqual([
      [1, '2026-09-05', 23045],
      [2, '2026-09-20', 26145],
    ]);
    expect(body[0]).toMatchObject({ net: 21948, vat: 1097, proration: { days: 15, cycle_days: 31 }, currency: 'AED' });
  });

  it('keeps invoice_no from the start for a window in mid-history', async () => {
    const id = await agreement('anytime-sa', '2026-09-20', 1);
    const body = (await invoices(id, { from: '2027-03-01', to: '2027-03-31' })).json();
    expect(body).toEqual([expect.objectContaining({ invoice_no: 7, due_date: '2027-03-01', kind: 'MONTHLY' })]);
  });

  it('returns [] for a window before the start date', async () => {
    const id = await agreement('anytime-sa', '2026-09-20', 1);
    const res = await invoices(id, { from: '2026-01-01', to: '2026-09-19' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('accepts to == from', async () => {
    const id = await agreement('anytime-sa', '2026-09-20', 1);
    const res = await invoices(id, { from: '2026-10-01', to: '2026-10-01' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('accepts a 366-day range and rejects 367 days with INVALID_RANGE', async () => {
    const id = await agreement('anytime-sa', '2026-09-20', 1);
    const ok = await invoices(id, { from: '2026-01-01', to: '2027-01-02' });
    expect(ok.statusCode).toBe(200);
    const tooLong = await invoices(id, { from: '2026-01-01', to: '2027-01-03' });
    expect(tooLong.statusCode).toBe(422);
    expect(tooLong.json()).toEqual({ error: { code: 'INVALID_RANGE', message: expect.any(String) } });
  });

  it('returns INVALID_RANGE when to is before from', async () => {
    const id = await agreement('anytime-sa', '2026-09-20', 1);
    const res = await invoices(id, { from: '2026-10-02', to: '2026-10-01' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_RANGE');
  });

  it('returns 404 NOT_FOUND for an unknown agreement', async () => {
    const res = await invoices('nope', { from: '2026-09-01', to: '2026-09-30' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it.each([
    ['missing from', { to: '2026-09-30' }],
    ['missing to', { from: '2026-09-01' }],
    ['from not a real day', { from: '2026-02-29', to: '2026-03-31' }],
    ['to malformed', { from: '2026-09-01', to: '2026-9-30' }],
    ['from is a month', { from: '2026-09', to: '2026-09-30' }],
  ])('returns VALIDATION for %s', async (_label, query) => {
    const id = await agreement('anytime-sa', '2026-09-20', 1);
    const res = await invoices(id, query);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('returns VALIDATION when from is given twice', async () => {
    const id = await agreement('anytime-sa', '2026-09-20', 1);
    const res = await app().inject({ method: 'GET', url: `/agreements/${id}/invoices?from=2026-09-01&from=2026-09-02&to=2026-09-30` });
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('checks VALIDATION before NOT_FOUND', async () => {
    const res = await invoices('nope', { from: 'bad', to: '2026-09-30' });
    expect(res.json().error.code).toBe('VALIDATION');
  });
});
