import { telemetry } from './otel.js';

const { buildApp } = await import('./app.js');
const app = buildApp();
const port = Number(process.env.API_PORT ?? 3108);

try {
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  try { await app.close(); } finally { await telemetry.shutdown(); }
  process.exitCode = 1;
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  if (stopping) return;
  stopping = true;
  void (async () => {
    // close() drains requests and mock background work before the SDK flush.
    try { await app.close(); } finally { await telemetry.shutdown(); }
  })().catch(error => { app.log.error({ err: error }, 'Graceful shutdown failed'); process.exitCode = 1; });
});
