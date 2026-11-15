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
  const io = new Server<Record<string, never>, AuctionEvents>(app.server, {
    transports: ['websocket'], serveClient: false, maxHttpBufferSize: 4096,
  });
  io.use((socket, next) => {
    const parsed = auctionChangeSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) return next(new Error('Invalid auction identifier.'));
    socket.data.slug = parsed.data.slug;
    next();
  });
  io.on('connection', socket => {
    const slug = String(socket.data.slug);
    // A socket watches one auction for its entire lifetime. Navigation disconnects it.
    void Promise.resolve(socket.join(`auction:${slug}`)).then(() => {
      if (socket.connected) socket.emit('auction:watching', { slug });
    }).catch(error => { app.log.error({ err: error }, 'Auction subscription failed'); socket.disconnect(true); });
  });
  const destroy = () => { for (const client of [pub, sub]) if (client.isOpen) client.destroy(); };
  app.addHook('onReady', async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([pub.connect(), sub.connect()]),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Redis must be available before startup (5s timeout).')), 5000); }),
      ]);
      io.adapter(createAdapter(publisher, sub, { key: 'auction-part-5:socket.io' }));
    } catch (error) { destroy(); throw error; }
    finally { clearTimeout(timer); }
  });
  app.addHook('preClose', async () => { io.local.disconnectSockets(true); await new Promise<void>(resolve => io.close(() => resolve())); });
  app.addHook('onClose', async () => {
    await Promise.all([pub, sub].map(async client => { if (client.isOpen) await client.close(); }));
  });
  return {
    ready: () => pub.isReady && sub.isReady,
    changed(slug: string) {
      // Delivery is best effort: Redis failure cannot undo a committed bid.
      if (!pub.isReady || !sub.isReady) app.log.warn({ slug }, 'Redis unavailable; remote notification may be missed');
      if (pub.isReady && sub.isReady) io.to(`auction:${slug}`).emit('auction:changed', { slug });
      else io.local.to(`auction:${slug}`).emit('auction:changed', { slug });
    },
  };
}
