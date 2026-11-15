import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStripeApp } from './app.js';

const apps: ReturnType<typeof buildStripeApp>[] = [];
const directories: string[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const payload = () => ({ mode: 'payment', client_reference_id: crypto.randomUUID(),
  line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Recovery GPU' }, unit_amount: 22000 }, quantity: 1 }],
  success_url: 'http://market.test/paid?session={CHECKOUT_SESSION_ID}', cancel_url: 'http://market.test/cancel' });
const pay = (app: ReturnType<typeof buildStripeApp>, id: string) => app.inject({ method: 'POST', url: `/v1/checkout/sessions/${id}/attempt`, payload: { cardNumber: '4242424242424242', expiry: '12 / 39', cvc: '123' } });

describe('durable autonomous mock confirmation recovery', () => {
  it('recovers open and completed sessions and retries the original event after restart without a browser', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'part8-stripe-test-')); directories.push(directory);
    const stateFile = join(directory, 'sessions.json');
    const bodies: string[] = [];
    const first = buildStripeApp({ logger: false, stateFile, retryMs: 20, deliverWebhook: async body => { bodies.push(body); return false; } });
    const input = payload();
    const session = (await first.inject({ method: 'POST', url: '/v1/checkout/sessions', payload: input })).json();
    const secondInput = payload();
    const open = (await first.inject({ method: 'POST', url: '/v1/checkout/sessions', payload: secondInput })).json();
    expect((await pay(first, session.id)).statusCode).toBe(502);
    await first.close();
    expect(await readFile(stateFile, 'utf8')).not.toContain('4242424242424242');
    const restarted = buildStripeApp({ logger: false, stateFile, retryMs: 20, deliverWebhook: async body => { bodies.push(body); return true; } }); apps.push(restarted);
    expect((await restarted.inject(`/v1/checkout/sessions/${session.id}`)).json()).toMatchObject({ status: 'complete', payment_status: 'paid' });
    expect((await restarted.inject({ method: 'POST', url: '/v1/checkout/sessions', payload: input })).json().id).toBe(session.id);
    expect((await restarted.inject({ method: 'POST', url: '/v1/checkout/sessions', payload: secondInput })).json().id).toBe(open.id);
    await expect.poll(() => bodies.length).toBeGreaterThanOrEqual(2);
    expect(new Set(bodies).size).toBe(1);
    await expect.poll(async () => JSON.parse(await readFile(stateFile, 'utf8')).find((row: { id: string }) => row.id === session.id).completion.delivered).toBe(true);
    const count = bodies.length;
    expect((await pay(restarted, session.id)).statusCode).toBe(200);
    expect(bodies).toHaveLength(count);
  });
  it('bounds hung HTTP deliveries and recovers automatically when the receiver returns', async () => {
    let healthy = false; let deliveries = 0;
    const receiver = createServer((_request, response) => { deliveries++; if (healthy) { response.writeHead(200); response.end('{}'); } });
    await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
    const address = receiver.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
    const app = buildStripeApp({ logger: false, webhookUrl: `http://127.0.0.1:${address.port}/hook`, webhookTimeoutMs: 50, retryMs: 20 }); apps.push(app);
    try {
      const session = (await app.inject({ method: 'POST', url: '/v1/checkout/sessions', payload: payload() })).json();
      const start = Date.now();
      expect((await pay(app, session.id)).statusCode).toBe(502);
      expect(Date.now() - start).toBeLessThan(2000);
      healthy = true;
      await expect.poll(() => deliveries).toBeGreaterThanOrEqual(2);
      expect((await pay(app, session.id)).statusCode).toBe(200);
    } finally { receiver.closeAllConnections(); await new Promise<void>(resolve => receiver.close(() => resolve())); }
  });
});
