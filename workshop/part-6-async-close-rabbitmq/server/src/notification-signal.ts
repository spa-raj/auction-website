import { Emitter } from '@socket.io/redis-emitter';
import { createClient } from 'redis';
import type { NotificationEvents } from '../../shared/notifications.js';

export function createNotificationSignal() {
  const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:56379',
    disableOfflineQueue: true, socket: { connectTimeout: 1000 } });
  redis.on('error', error => console.error('Notification Redis connection error', error));
  const publish = redis.publish.bind(redis);
  // The official emitter does not await publication; HTTP recovers missed signals.
  const emitter = new Emitter<NotificationEvents>({ publish: (...args: Parameters<typeof publish>) =>
    publish(...args).catch(error => { console.error('Notification signal failed', error); return 0; }) },
  { key: process.env.REDIS_CHANNEL_PREFIX ?? 'auction-part-6:socket.io' });
  return { redis, changed(userId: number) {
    if (redis.isReady) emitter.to(`user:${userId}`).emit('notifications:changed', { userId });
  } };
}
