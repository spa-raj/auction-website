import { Emitter } from '@socket.io/redis-emitter';
import { createClient } from 'redis';
import { contextFromCarrier, failed, outcome, withSpan, type TraceCarrier } from '../../shared/tracing.js';
import type { NotificationEvents } from '../../shared/notifications.js';

export function createNotificationSignal() {
  const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:56379',
    disableOfflineQueue: true, socket: { connectTimeout: 1000 } });
  redis.on('error', error => console.error('Notification Redis connection error', error));
  const publish = redis.publish.bind(redis);
  return { redis, async changed(userId: number, carrier?: TraceCarrier | null, role?: 'seller' | 'winner', notificationId?: string) {
    await withSpan('auction.notification.signal', { 'recipient.id': userId, 'participant.role': role,
      'notification.id': notificationId, 'signal.attempted': redis.isReady }, async () => {
      if (!redis.isReady) { outcome('unavailable'); failed('delivery_failed'); return; }
      let delivery: Promise<unknown> = Promise.resolve();
      // The official emitter does not await publication. Capture its promise to
      // measure this attempt; a publish success is still not browser receipt.
      const emitter = new Emitter<NotificationEvents>({ publish: (...args: Parameters<typeof publish>) => {
        const result = publish(...args).catch(error => { outcome('unavailable'); failed('delivery_failed'); console.error('Notification signal failed', error); return 0; });
        delivery = result; return result;
      } }, { key: process.env.REDIS_CHANNEL_PREFIX ?? 'auction-part-8:socket.io' });
      outcome('signal_attempted'); emitter.to(`user:${userId}`).emit('notifications:changed', { userId });
      await delivery;
    }, contextFromCarrier(carrier));
  } };
}
