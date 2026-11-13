import { buildApp } from './http/app';

const PORT = 8080;
const HOST = '0.0.0.0';

async function main(): Promise<void> {
  const app = buildApp({ logger: true });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }

  await app.listen({ port: PORT, host: HOST });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
