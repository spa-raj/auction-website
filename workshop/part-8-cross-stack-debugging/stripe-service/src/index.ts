import { telemetry } from './otel.js';
import { fileURLToPath } from 'node:url';

const { buildStripeApp } = await import('./app.js');

const port = Number(process.env.STRIPE_PORT ?? 7108);
const app = buildStripeApp({
  stateFile: process.env.STRIPE_STATE_FILE ?? fileURLToPath(new URL('../.data/sessions.json', import.meta.url)),
  baseUrl: process.env.STRIPE_PUBLIC_URL ?? `http://127.0.0.1:${port}`,
  webhookUrl: process.env.AUCTION_WEBHOOK_URL ?? 'http://127.0.0.1:3108/api/webhooks/stripe',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_local_part_8',
});


try {
  await app.listen({ port, host: process.env.STRIPE_HOST ?? '127.0.0.1' });
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
