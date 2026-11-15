import './otel.js';

const { buildApp } = await import('./app.js');
const app = buildApp();
const port = Number(process.env.API_PORT ?? 3107);

try {
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
