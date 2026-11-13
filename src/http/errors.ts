import type { FastifyError, FastifyInstance } from 'fastify';

/** A business error with the exact HTTP status and code the brief requires. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /** Extra fields placed inside `error`, e.g. `existing_member_id`. */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const validationError = (message: string) => new AppError(422, 'VALIDATION', message);
export const notFound = (message: string) => new AppError(404, 'NOT_FOUND', message);

function envelope(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, ...extra } };
}

/**
 * Every response that is not a success goes through here so the envelope is
 * always `{ error: { code, message } }`.
 * Fastify itself answers bad JSON, wrong content types and schema failures with
 * 400/415; the brief wants those as 422 VALIDATION.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(envelope(error.code, error.message, error.extra));
    }
    const status = error.statusCode ?? 500;
    if (error.validation || (status >= 400 && status < 500)) {
      return reply.code(422).send(envelope('VALIDATION', error.message));
    }
    request.log.error({ err: error }, 'unexpected error');
    return reply.code(500).send(envelope('INTERNAL', 'Internal server error'));
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send(envelope('NOT_FOUND', `Route ${request.method} ${request.url} not found`));
  });
}
