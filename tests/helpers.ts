import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach } from 'vitest';
import { buildApp } from '../src/http/app';

/** Gives each test a fresh app with empty state, closed after the test. */
export function useApp(): () => FastifyInstance {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });
  return () => app;
}

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
