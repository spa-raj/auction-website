const base = process.env.RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15676';
const user = process.env.RABBITMQ_USER ?? 'auction';
const password = process.env.RABBITMQ_PASSWORD ?? 'auction';
for (const vhost of ['auction_part_8', 'auction_part_8_test']) {
  for (const [path, body] of [
    [`/api/vhosts/${vhost}`, {}],
    [`/api/permissions/${vhost}/${encodeURIComponent(user)}`, { configure: '.*', write: '.*', read: '.*' }],
  ] as const) {
    const response = await fetch(`${base}${path}`, { method: 'PUT', headers: {
      authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, 'content-type': 'application/json',
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`RabbitMQ setup failed (${response.status}) for ${vhost}`);
  }
  console.info(`RabbitMQ virtual host ready: ${vhost}`);
}
