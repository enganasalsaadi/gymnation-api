import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { type CalendarDate, daysBetween, parseDate } from '../domain/dates';
import { invoicesBetween, type Schedule } from '../domain/invoices';
import type { Agreement, Plan, Store } from '../store';
import { AppError, notFound, validationError } from './errors';

/** Longest allowed invoice query: `to - from` may be at most this many days. */
const MAX_RANGE_DAYS = 366;

interface CreateAgreementBody {
  member_id: string;
  plan_id: string;
  start_date: string;
  due_day: number;
}

interface InvoicesQuery {
  from: string;
  to: string;
}

function dateField(value: string, field: string): CalendarDate {
  const date = parseDate(value);
  if (date === null) throw validationError(`${field} must be a real calendar date in YYYY-MM-DD form`);
  return date;
}

/** The inputs the invoice calculator needs, taken from an agreement and its plan. */
export function scheduleOf(agreement: Agreement, plan: Plan): Schedule {
  return {
    country: plan.country,
    monthly: plan.monthly,
    joiningFee: plan.joining_fee,
    // Validated when the agreement was created.
    startDate: parseDate(agreement.start_date)!,
    dueDay: agreement.due_day,
  };
}

export function agreementRoutes(app: FastifyInstance, store: Store): void {
  app.post<{ Body: CreateAgreementBody }>(
    '/agreements',
    {
      schema: {
        body: {
          type: 'object',
          required: ['member_id', 'plan_id', 'start_date', 'due_day'],
          properties: {
            member_id: { type: 'string' },
            plan_id: { type: 'string' },
            start_date: { type: 'string' },
            due_day: { type: 'integer', minimum: 1, maximum: 31 },
          },
        },
      },
    },
    async (request, reply) => {
      const { member_id, plan_id, start_date, due_day } = request.body;
      dateField(start_date, 'start_date');

      const member = store.members.get(member_id);
      if (member === undefined) throw new AppError(422, 'UNKNOWN_MEMBER', `Member ${member_id} does not exist`);
      const plan = store.plans.get(plan_id);
      if (plan === undefined) throw new AppError(422, 'UNKNOWN_PLAN', `Plan ${plan_id} does not exist`);
      if (member.country !== plan.country) {
        throw new AppError(422, 'PLAN_COUNTRY_MISMATCH', `Member is in ${member.country} but plan is for ${plan.country}`);
      }

      const agreement: Agreement = { id: randomUUID(), member_id, plan_id, start_date, due_day };
      store.addAgreement(agreement);
      return reply.code(201).send(agreement);
    },
  );

  app.get<{ Params: { id: string }; Querystring: InvoicesQuery }>(
    '/agreements/:id/invoices',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['from', 'to'],
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const from = dateField(request.query.from, 'from');
      const to = dateField(request.query.to, 'to');

      const agreement = store.agreements.get(request.params.id);
      if (agreement === undefined) throw notFound(`Agreement ${request.params.id} not found`);

      const days = daysBetween(from, to);
      if (days < 0 || days > MAX_RANGE_DAYS) {
        throw new AppError(422, 'INVALID_RANGE', `to must be on or after from, and at most ${MAX_RANGE_DAYS} days later`);
      }

      // Plans cannot be deleted, so the plan of a stored agreement always exists.
      const plan = store.plans.get(agreement.plan_id)!;
      return invoicesBetween(scheduleOf(agreement, plan), from, to);
    },
  );
}
