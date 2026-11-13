import type { FastifyInstance } from 'fastify';
import { COUNTRIES, COUNTRY_CODES, type CountryCode } from '../domain/countries';
import { totalsStaySafe } from '../domain/money';
import type { Plan, Store } from '../store';
import { AppError, validationError } from './errors';

interface CreatePlanBody {
  id: string;
  country: CountryCode;
  monthly: number;
  joining_fee: number;
}

/** Integer minor units. The maximum also rejects 1e400, which JSON parses to Infinity. */
const minorUnits = (minimum: number) => ({ type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER });

export function planRoutes(app: FastifyInstance, store: Store): void {
  app.post<{ Body: CreatePlanBody }>(
    '/plans',
    {
      schema: {
        body: {
          type: 'object',
          required: ['id', 'country', 'monthly', 'joining_fee'],
          properties: {
            id: { type: 'string', minLength: 1 },
            country: { type: 'string', enum: [...COUNTRY_CODES] },
            monthly: minorUnits(1),
            joining_fee: minorUnits(0),
          },
        },
      },
    },
    async (request, reply) => {
      const { id, country, monthly, joining_fee } = request.body;
      if (!totalsStaySafe(monthly, joining_fee, country)) {
        throw validationError('monthly + joining_fee is too large: invoice totals would pass Number.MAX_SAFE_INTEGER');
      }

      const plan: Plan = { id, country, currency: COUNTRIES[country].currency, monthly, joining_fee };
      if (!store.addPlan(plan)) throw new AppError(409, 'PLAN_EXISTS', `Plan ${id} already exists`);
      return reply.code(201).send(plan);
    },
  );
}
