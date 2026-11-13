import { describe, expect, it } from 'vitest';
import { useApp } from './helpers';

describe('POST /plans', () => {
  const app = useApp();
  const create = (payload: unknown) => app().inject({ method: 'POST', url: '/plans', payload: payload as object });

  it('creates a plan and derives the currency from the country', async () => {
    const res = await create({ id: 'anytime-sa', country: 'SA', monthly: 29900, joining_fee: 0 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 'anytime-sa', country: 'SA', currency: 'SAR', monthly: 29900, joining_fee: 0 });
  });

  it.each([
    ['AE', 'AED'],
    ['SA', 'SAR'],
    ['BH', 'BHD'],
  ])('country %s has currency %s', async (country, currency) => {
    const res = await create({ id: `p-${country}`, country, monthly: 1, joining_fee: 0 });
    expect(res.json().currency).toBe(currency);
  });

  it('stores the caller id byte for byte', async () => {
    const id = '  Anytime/SA ✓ 01 ';
    const res = await create({ id, country: 'SA', monthly: 100, joining_fee: 0 });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(id);
  });

  it('returns 409 PLAN_EXISTS for a duplicate id', async () => {
    await create({ id: 'gold', country: 'AE', monthly: 100, joining_fee: 0 });
    const res = await create({ id: 'gold', country: 'SA', monthly: 200, joining_fee: 0 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'PLAN_EXISTS', message: expect.any(String) } });
  });

  it('lets exactly one of several concurrent creates with the same id win', async () => {
    const results = await Promise.all(
      [100, 200, 300].map((monthly) => create({ id: 'race', country: 'AE', monthly, joining_fee: 0 })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
  });

  it('treats ids as case-sensitive', async () => {
    await create({ id: 'gold', country: 'AE', monthly: 100, joining_fee: 0 });
    const res = await create({ id: 'GOLD', country: 'AE', monthly: 100, joining_fee: 0 });
    expect(res.statusCode).toBe(201);
  });

  it('accepts amounts up to the point where a total would pass Number.MAX_SAFE_INTEGER', async () => {
    // Worst invoice net is monthly + joining_fee. For AE, net 8578285004515229 gives total 9007199254740990,
    // and one more minor unit gives 9007199254740992, which is past the limit.
    const ok = await create({ id: 'max', country: 'AE', monthly: 1, joining_fee: 8578285004515228 });
    expect(ok.statusCode).toBe(201);
    const tooBig = await create({ id: 'max+1', country: 'AE', monthly: 2, joining_fee: 8578285004515228 });
    expect(tooBig.statusCode).toBe(422);
    expect(tooBig.json().error.code).toBe('VALIDATION');
  });

  const valid = { id: 'p', country: 'AE', monthly: 100, joining_fee: 0 };
  it.each([
    ['missing id', { ...valid, id: undefined }],
    ['empty id', { ...valid, id: '' }],
    ['id as number', { ...valid, id: 7 }],
    ['missing country', { ...valid, country: undefined }],
    ['unknown country', { ...valid, country: 'EG' }],
    ['lowercase country', { ...valid, country: 'ae' }],
    ['missing monthly', { ...valid, monthly: undefined }],
    ['monthly 0', { ...valid, monthly: 0 }],
    ['monthly negative', { ...valid, monthly: -1 }],
    ['monthly decimal', { ...valid, monthly: 299.5 }],
    ['monthly as string', { ...valid, monthly: '29900' }],
    ['missing joining_fee', { ...valid, joining_fee: undefined }],
    ['joining_fee negative', { ...valid, joining_fee: -1 }],
    ['joining_fee decimal', { ...valid, joining_fee: 0.5 }],
    ['joining_fee null', { ...valid, joining_fee: null }],
    ['monthly beyond safe integers', { ...valid, monthly: 2 ** 60 }],
    ['first invoice total beyond safe integers', { ...valid, monthly: 2 ** 52, joining_fee: 2 ** 52 }],
  ])('returns VALIDATION for %s', async (_label, payload) => {
    const res = await create(payload);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: { code: 'VALIDATION', message: expect.any(String) } });
  });

  it('returns VALIDATION for a number JSON parses to Infinity', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/plans',
      headers: { 'content-type': 'application/json' },
      payload: '{"id":"inf","country":"AE","monthly":1e400,"joining_fee":0}',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('checks VALIDATION before PLAN_EXISTS', async () => {
    await create(valid);
    const res = await create({ ...valid, monthly: 0 });
    expect(res.json().error.code).toBe('VALIDATION');
  });
});
