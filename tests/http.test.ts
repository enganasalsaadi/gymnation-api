import { describe, expect, it } from 'vitest';
import { useApp } from './helpers';

describe('HTTP basics', () => {
  const app = useApp();

  it('GET /health returns ok', async () => {
    const res = await app().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('unknown route returns the 404 envelope', async () => {
    const res = await app().inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('malformed JSON body returns 422 VALIDATION, not 400', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/members',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": "Noura",',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('empty JSON body returns 422 VALIDATION', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/members',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('JSON null body returns 422 VALIDATION', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/members',
      headers: { 'content-type': 'application/json' },
      payload: 'null',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('non-JSON content type returns 422 VALIDATION', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/members',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});
