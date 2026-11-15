import { recipientSchema, type NotificationEvents } from '../../shared/notifications.js';
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { auctionChangeSchema, type AuctionEvents } from '../../shared/realtime.js';

export function attachRealtime(app: FastifyInstance, redisUrl: string) {
  const pub = createClient({ url: redisUrl, disableOfflineQueue: true, socket: { connectTimeout: 1000 } });
  const sub = pub.duplicate();
  // The adapter does not await publish promises. Consume failures here so a
  // lost Redis connection cannot become an unhandled rejection after COMMIT.
  const publish = pub.publish.bind(pub);
  const publisher = {
    pSubscribe: pub.pSubscribe,
    on: pub.on.bind(pub),
    publish: (...args: Parameters<typeof publish>) => publish(...args).catch(error => {
      app.log.error({ err: error }, 'Redis notification publication failed');
      return 0;
    }),
  };
  for (const client of [pub, sub]) client.on('error', error => app.log.error({ err: error }, 'Redis realtime connection error'));
  const io = new Server<Record<string, never>, AuctionEvents & NotificationEvents>(app.server, {
    transports: ['websocket'], serveClient: false, maxHttpBufferSize: 4096,
  });
  io.use((socket, next) => {
    const auction = auctionChangeSchema.strict().safeParse(socket.handshake.auth);
    const recipient = recipientSchema.strict().safeParse(socket.handshake.auth);
    if (auction.success) socket.data.slug = auction.data.slug;
    else if (recipient.success) socket.data.userId = recipient.data.userId;
    else return next(new Error('Invalid auction or demo recipient.'));
    next();
  });
  io.on('connection', socket => {
    const userId = socket.data.userId as number | undefined;
    const slug = socket.data.slug as string | undefined;
    const room = userId !== undefined ? `user:${userId}` : `auction:${slug}`;
    // Demo-selected recipient rooms are routing, not authentication.
    void Promise.resolve(socket.join(room)).then(() => {
      if (!socket.connected) return;
      if (userId !== undefined) socket.emit('notifications:watching', { userId });
      else socket.emit('auction:watching', { slug: slug! });
    }).catch(error => { app.log.error({ err: error }, 'Realtime subscription failed'); socket.disconnect(true); });
  });
  const destroy = () => { for (const client of [pub, sub]) if (client.isOpen) client.destroy(); };
  app.addHook('onReady', async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([pub.connect(), sub.connect()]),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Redis must be available before startup (5s timeout).')), 5000); }),
      ]);
      io.adapter(createAdapter(publisher, sub, { key: process.env.REDIS_CHANNEL_PREFIX ?? 'auction-part-8:socket.io' }));
    } catch (error) { destroy(); throw error; }
    finally { clearTimeout(timer); }
  });
  app.addHook('preClose', async () => { io.local.disconnectSockets(true); await new Promise<void>(resolve => io.close(() => resolve())); });
  app.addHook('onClose', async () => {
    await Promise.all([pub, sub].map(async client => { if (client.isOpen) await client.close(); }));
  });
  return {
    ready: () => pub.isReady && sub.isReady,
    notificationsChanged(userId: number) {
      if (pub.isReady && sub.isReady) io.to(`user:${userId}`).emit('notifications:changed', { userId });
      else io.local.to(`user:${userId}`).emit('notifications:changed', { userId });
    },
    changed(slug: string) {
      // Delivery is best effort: Redis failure cannot undo a committed bid.
      if (!pub.isReady || !sub.isReady) app.log.warn({ slug }, 'Redis unavailable; remote notification may be missed');
      if (pub.isReady && sub.isReady) io.to(`auction:${slug}`).emit('auction:changed', { slug });
      else io.local.to(`auction:${slug}`).emit('auction:changed', { slug });
    },
  };
}
