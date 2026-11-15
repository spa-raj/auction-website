import './otel.js';
import { fileURLToPath } from 'node:url';

const { buildStripeApp } = await import('./app.js');

const port = Number(process.env.STRIPE_PORT ?? 7107);
const app = buildStripeApp({
  stateFile: process.env.STRIPE_STATE_FILE ?? fileURLToPath(new URL('../.data/sessions.json', import.meta.url)),
  baseUrl: process.env.STRIPE_PUBLIC_URL ?? `http://127.0.0.1:${port}`,
  webhookUrl: process.env.AUCTION_WEBHOOK_URL ?? 'http://127.0.0.1:3107/api/webhooks/stripe',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_local_part_7',
});

try {
  await app.listen({ port, host: process.env.STRIPE_HOST ?? '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
