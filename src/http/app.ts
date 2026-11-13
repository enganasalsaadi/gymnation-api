import Fastify, { type FastifyInstance } from 'fastify';
import { Store } from '../store';
import { agreementRoutes } from './agreements';
import { registerErrorHandling } from './errors';
import { memberRoutes } from './members';
import { planRoutes } from './plans';

export interface AppOptions {
  logger?: boolean;
}

/** Builds a fresh app with its own empty in-memory store. */
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: {
      customOptions: {
        // Fastify coerces "100" to 100 by default; the brief wants wrong JSON types rejected.
        coerceTypes: false,
        allErrors: false,
      },
    },
  });
  const store = new Store();

  registerErrorHandling(app);

  app.get('/health', async () => ({ status: 'ok' }));
  memberRoutes(app, store);
  planRoutes(app, store);
  agreementRoutes(app, store);

  return app;
}
