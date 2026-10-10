import { Server } from 'socket.io';
import User from './models/User.js';
import Message from './models/Message.js';
import { verifyToken } from './utils/token.js';

export function attachChat(server) {
  const io = new Server(server, {
    cors: { origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' },
    maxHttpBufferSize: 16 * 1024,
  });

  io.use(async (socket, next) => {
    let session;
    try {
      session = verifyToken(socket.handshake.auth.token);
    } catch {
      return next(new Error('Invalid or expired token'));
    }
    try {
      if (!(await User.findByPk(session.userId, { attributes: ['id'] }))) return next(new Error('Invalid or expired token'));
      socket.data = session;
      return next();
    } catch (error) {
      console.error('Unable to authenticate chat account:', error);
      return next(new Error('Chat unavailable. Try again.'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, expiresAt } = socket.data;
    socket.join(`user:${userId}`);
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, expiresAt - Date.now()));
    // ponytail: per-socket rate limit; shared per-user limiter if deploying multiple API instances.
    let windowStart = Date.now();
    let count = 0;
    socket.on('disconnect', () => clearTimeout(expiry));
    socket.on('message:send', async (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (Date.now() >= expiresAt) return ack({ error: 'Session expired. Sign in again.' });
      if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); count = 0; }
      if (++count > 30) return ack({ error: 'Too many messages. Wait a minute.' });
      const recipientId = payload?.recipientId;
      const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
      if (!Number.isSafeInteger(recipientId) || recipientId < 1 || recipientId === userId || !body || body.length > 2000) {
        return ack({ error: 'Choose another user and enter 1 to 2000 characters.' });
      }
      try {
        if (!(await User.findByPk(recipientId, { attributes: ['id'] }))) return ack({ error: 'User not found' });
        const message = (await Message.create({ senderId: userId, recipientId, body })).toJSON();
        io.to([`user:${userId}`, `user:${recipientId}`]).emit('message:new', message);
        ack({ message });
      } catch (error) {
        console.error('Unable to save chat message:', error);
        ack({ error: 'Message could not be saved. Try again.' });
      }
    });
  });
  return io;
}
