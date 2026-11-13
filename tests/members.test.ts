import { describe, expect, it } from 'vitest';
import { UUID_V4, useApp } from './helpers';

describe('POST /members', () => {
  const app = useApp();
  const create = (payload: unknown) => app().inject({ method: 'POST', url: '/members', payload: payload as object });

  it('creates a member and returns E.164', async () => {
    const res = await create({ name: '  Noura Al Harbi  ', country: 'SA', phone: '055 123 4567' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ id: expect.stringMatching(UUID_V4), name: 'Noura Al Harbi', country: 'SA', phone: '+966551234567' });
  });

  it.each([
    ['AE', '0501234567', '+971501234567'],
    ['AE', '+971501234567', '+971501234567'],
    ['AE', '971501234567', '+971501234567'],
    ['BH', '3123 4567', '+97331234567'],
    ['BH', '+973 3123 4567', '+97331234567'],
  ])('country %s phone %s is stored as %s', async (country, phone, expected) => {
    const res = await create({ name: 'A', country, phone });
    expect(res.statusCode).toBe(201);
    expect(res.json().phone).toBe(expected);
  });

  it('accepts an AE member with an SA SIM and stores +966', async () => {
    const res = await create({ name: 'Expat', country: 'AE', phone: '+966551234567' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ country: 'AE', phone: '+966551234567' });
  });

  it('reads a national number in the member country: BH member with 05 number is INVALID_PHONE', async () => {
    const res = await create({ name: 'A', country: 'BH', phone: '0501234567' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_PHONE');
  });

  it.each([
    '00971501234567',
    '+9710501234567',
    '+9715012345',
    '9715012345678',
    '050-123.4567',
    '05O1234567',
    '971+501234567',
    '',
    '+97141234567',
  ])('rejects phone %j with INVALID_PHONE', async (phone) => {
    const res = await create({ name: 'A', country: 'AE', phone });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: { code: 'INVALID_PHONE', message: expect.any(String) } });
  });

  it.each([
    ['missing name', { country: 'AE', phone: '0501234567' }],
    ['blank name', { name: '   ', country: 'AE', phone: '0501234567' }],
    ['name too long', { name: 'a'.repeat(121), country: 'AE', phone: '0501234567' }],
    ['name not a string', { name: 42, country: 'AE', phone: '0501234567' }],
    ['missing country', { name: 'A', phone: '0501234567' }],
    ['unknown country', { name: 'A', country: 'EG', phone: '0501234567' }],
    ['lowercase country', { name: 'A', country: 'ae', phone: '0501234567' }],
    ['missing phone', { name: 'A', country: 'AE' }],
    ['phone as number', { name: 'A', country: 'AE', phone: 501234567 }],
    ['body is an array', []],
  ])('returns VALIDATION for %s', async (_label, payload) => {
    const res = await create(payload);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: { code: 'VALIDATION', message: expect.any(String) } });
  });

  it('accepts a name of exactly 120 characters after trimming', async () => {
    const res = await create({ name: `  ${'a'.repeat(120)}  `, country: 'AE', phone: '0501234567' });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toHaveLength(120);
  });

  it('ignores unknown extra fields', async () => {
    const res = await create({ name: 'A', country: 'AE', phone: '0501234567', vip: true });
    expect(res.statusCode).toBe(201);
    expect(res.json()).not.toHaveProperty('vip');
  });

  it('returns 409 PHONE_TAKEN with the winner id for a duplicate in another spelling', async () => {
    const first = await create({ name: 'A', country: 'AE', phone: '0501234567' });
    const second = await create({ name: 'B', country: 'SA', phone: '+971 50 123 4567' });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      error: { code: 'PHONE_TAKEN', message: expect.any(String), existing_member_id: first.json().id },
    });
  });

  it('lets exactly one of three concurrent spellings win', async () => {
    const results = await Promise.all([
      create({ name: 'A', country: 'AE', phone: '+971501234567' }),
      create({ name: 'B', country: 'AE', phone: '971501234567' }),
      create({ name: 'C', country: 'AE', phone: '050 123 4567' }),
    ]);
    const winners = results.filter((r) => r.statusCode === 201);
    const losers = results.filter((r) => r.statusCode === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(2);
    const winnerId = winners[0]!.json().id;
    for (const loser of losers) {
      expect(loser.json().error).toMatchObject({ code: 'PHONE_TAKEN', existing_member_id: winnerId });
    }
  });

  it('checks VALIDATION before INVALID_PHONE', async () => {
    const res = await create({ name: '', country: 'AE', phone: 'garbage' });
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('GET /members/lookup', () => {
  const app = useApp();
  const lookup = (query: { phone?: string; country?: string }) =>
    app().inject({ method: 'GET', url: '/members/lookup', query: query as Record<string, string> });

  async function seedMember() {
    const res = await app().inject({
      method: 'POST',
      url: '/members',
      payload: { name: 'Noura', country: 'SA', phone: '0551234567' },
    });
    return res.json();
  }

  it('finds a member by any spelling', async () => {
    const member = await seedMember();
    for (const query of [
      { phone: '+966551234567' },
      { phone: '966551234567' },
      { phone: '+966 55 123 4567', country: 'SA' },
      { phone: '055 123 4567', country: 'SA' },
    ]) {
      const res = await lookup(query);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(member);
    }
  });

  it('returns PHONE_NEEDS_COUNTRY for a national number without country', async () => {
    for (const phone of ['0551234567', '31234567']) {
      const res = await lookup({ phone });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('PHONE_NEEDS_COUNTRY');
    }
  });

  it('returns PHONE_COUNTRY_MISMATCH when dial code and country disagree', async () => {
    await seedMember();
    const res = await lookup({ phone: '+966551234567', country: 'AE' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('PHONE_COUNTRY_MISMATCH');
  });

  it('returns INVALID_PHONE for a national number that is not a mobile of the given country', async () => {
    const res = await lookup({ phone: '0551234567', country: 'BH' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_PHONE');
  });

  it('returns INVALID_PHONE for garbage, with or without country', async () => {
    for (const query of [{ phone: '12' }, { phone: '00966551234567', country: 'SA' }]) {
      const res = await lookup(query);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('INVALID_PHONE');
    }
  });

  it('returns 404 NOT_FOUND when no member has the phone', async () => {
    const res = await lookup({ phone: '+971501234567' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it.each([
    ['missing phone', {}],
    ['unknown country', { phone: '0551234567', country: 'XX' }],
    ['lowercase country', { phone: '0551234567', country: 'sa' }],
  ])('returns VALIDATION for %s', async (_label, query) => {
    const res = await lookup(query);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('returns VALIDATION when phone is given twice', async () => {
    const res = await app().inject({ method: 'GET', url: '/members/lookup?phone=1&phone=2' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});
