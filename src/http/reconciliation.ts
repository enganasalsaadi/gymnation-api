import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { type CalendarMonth, monthBounds, parseDate, parseMonth } from '../domain/dates';
import { invoicesBetween } from '../domain/invoices';
import { type ExpectedInvoice, type GatewayRow, reconcile, rowErrors } from '../domain/reconciliation';
import type { ReconciliationRun, Store } from '../store';
import { scheduleOf } from './agreements';
import { AppError, notFound, validationError } from './errors';

interface CreateRunBody {
  month: string;
  rows: GatewayRow[];
}

/** Every invoice of every stored agreement whose due_date falls in the month. */
function expectedInvoices(store: Store, month: CalendarMonth): ExpectedInvoice[] {
  const { first, last } = monthBounds(month);
  const expected: ExpectedInvoice[] = [];
  for (const agreement of store.agreements.values()) {
    const plan = store.plans.get(agreement.plan_id)!;
    for (const invoice of invoicesBetween(scheduleOf(agreement, plan), first, last)) {
      expected.push({
        agreement_id: agreement.id,
        invoice_no: invoice.invoice_no,
        due_date: invoice.due_date,
        total: invoice.total,
        currency: invoice.currency,
      });
    }
  }
  return expected;
}

export function reconciliationRoutes(app: FastifyInstance, store: Store): void {
  app.post<{ Body: CreateRunBody }>(
    '/reconciliation/runs',
    {
      schema: {
        body: {
          type: 'object',
          required: ['month', 'rows'],
          properties: {
            month: { type: 'string' },
            rows: {
              type: 'array',
              items: {
                type: 'object',
                required: ['gateway_txn_id', 'agreement_id', 'amount', 'currency', 'status', 'attempted_on'],
                properties: {
                  gateway_txn_id: { type: 'string' },
                  agreement_id: { type: 'string' },
                  amount: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
                  currency: { type: 'string' },
                  status: { type: 'string', enum: ['SETTLED', 'DECLINED'] },
                  attempted_on: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { month, rows } = request.body;
      const parsedMonth = parseMonth(month);
      if (parsedMonth === null) throw validationError('month must be a real month in YYYY-MM form');
      rows.forEach((row, index) => {
        if (parseDate(row.attempted_on) === null) {
          throw validationError(`rows[${index}].attempted_on must be a real calendar date in YYYY-MM-DD form`);
        }
      });

      const errors = rowErrors(month, rows, (agreementId) => {
        const agreement = store.agreements.get(agreementId);
        return agreement === undefined ? undefined : store.plans.get(agreement.plan_id)!.currency;
      });
      if (errors.length > 0) {
        throw new AppError(422, 'INVALID_ROWS', 'One or more gateway rows failed validation', { errors });
      }

      // Built from scratch from the store and never written back to it.
      const run: ReconciliationRun = {
        id: randomUUID(),
        month,
        ...reconcile(rows, expectedInvoices(store, parsedMonth)),
      };
      store.addRun(run);
      return reply.code(201).send(run);
    },
  );

  app.get<{ Params: { id: string } }>('/reconciliation/runs/:id', async (request) => {
    const run = store.runs.get(request.params.id);
    if (run === undefined) throw notFound(`Reconciliation run ${request.params.id} not found`);
    return run;
  });
}
