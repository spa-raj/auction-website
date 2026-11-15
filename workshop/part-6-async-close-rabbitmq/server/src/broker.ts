import amqp, { type ConfirmChannel } from 'amqplib';
import type { AuctionClosed } from '../../shared/auction-closed.js';

export const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://auction:auction@127.0.0.1:56726/auction_part_6?heartbeat=5';
export const exchange = 'auction.events';
export const notificationQueue = 'auction.notifications';
export async function openBroker(url = rabbitUrl) {
  const connection = await amqp.connect(url, { timeout: 5000 });
  connection.on('error', error => console.error('RabbitMQ connection error', error));
  try {
    const channel = await connection.createConfirmChannel();
    channel.on('error', error => console.error('RabbitMQ channel error', error));
    await channel.assertExchange(exchange, 'direct', { durable: true });
    await channel.assertQueue(notificationQueue, { durable: true, arguments: { 'x-queue-type': 'classic' } });
    await channel.bindQueue(notificationQueue, exchange, 'auction.closed');
    return { connection, channel };
  } catch (error) { await connection.close().catch(() => {}); throw error; }
}

/** A mandatory return, nack, close or timeout never counts as publication. */
export function publishConfirmed(channel: ConfirmChannel, event: AuctionClosed): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('RabbitMQ publisher confirmation timed out')), 5000);
    const returned = () => finish(new Error('RabbitMQ returned an unroutable close event'));
    const closed = () => finish(new Error('RabbitMQ channel closed before confirmation'));
    let settled = false;
    function finish(error?: Error | null) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      channel.off('return', returned); channel.off('close', closed);
      if (error) reject(error); else resolve();
    }
    // This publisher sends sequentially: at most one outstanding message here.
    channel.once('return', returned); channel.once('close', closed);
    try {
      channel.publish(exchange, 'auction.closed', Buffer.from(JSON.stringify(event)), {
        persistent: true, mandatory: true, contentType: 'application/json',
        messageId: event.eventId, type: event.type, appId: 'auction-part-6',
      }, (error: Error | null) => finish(error));
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
