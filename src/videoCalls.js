import { randomUUID } from 'node:crypto';
import User from './models/User.js';

export function attachVideoCalls(io) {
  // shortcut: one API process; share call state and rooms before running multiple instances.
  const endpoints = new Map();
  const calls = new Map();
  const busy = new Map();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const alive = (endpoint) => endpoint &&
    io.sockets.sockets.get(endpoint.socketId)?.data.expiresAt > Date.now();

  function finish(call, reason) {
    if (!call || calls.get(call.id) !== call) return;
    calls.delete(call.id);
    clearTimeout(call.timer);
    for (const person of [call.caller, call.recipient]) {
      if (busy.get(person.userId) === call.id) busy.delete(person.userId);
      io.to(person.socketId).emit('call:ended', { callId: call.id, reason });
    }
  }

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    let windowStart = Date.now();
    let attempts = 0;

    function unready(peerId) {
      const endpoint = endpoints.get(userId);
      if (endpoint?.socketId !== socket.id || (peerId && endpoint.peerId !== peerId)) return;
      endpoints.delete(userId);
      finish(calls.get(busy.get(userId)), 'La llamada terminó.');
    }

    function handle(event, action) {
      socket.on(event, async (payload, ack = () => {}) => {
        if (typeof ack !== 'function') return;
        if (Date.now() >= socket.data.expiresAt) return ack({ error: 'Tu sesión expiró.' });
        try { ack(await action(payload)); }
        catch (error) {
          console.error('Video call failed:', error);
          ack({ error: 'No se pudo completar la solicitud.' });
        }
      });
    }

    function ownedCall(payload, recipientOnly = false) {
      const call = typeof payload?.callId === 'string' ? calls.get(payload.callId) : null;
      if (!call) return null;
      if (recipientOnly ? call.recipient.socketId !== socket.id :
          ![call.caller.socketId, call.recipient.socketId].includes(socket.id)) return null;
      return call;
    }

    handle('call:register', async () => {
      if (busy.has(userId)) return { error: 'Ya tienes una llamada.' };
      const user = await User.findByPk(userId, { attributes: ['id', 'email'] });
      if (!user || Date.now() >= socket.data.expiresAt) return { error: 'Inicia sesión de nuevo.' };
      if (busy.has(userId)) return { error: 'Ya tienes una llamada.' };
      const existing = endpoints.get(userId);
      if (existing && alive(existing) && existing.socketId !== socket.id) {
        return { error: 'Las llamadas están abiertas en otra pestaña.' };
      }
      unready();
      socket.data.callPeerId = randomUUID();
      socket.data.callEmail = user.email;
      return { peerId: socket.data.callPeerId };
    });

    handle('call:ready', (payload) => {
      if (!socket.data.callPeerId || payload?.peerId !== socket.data.callPeerId) {
        return { error: 'Identidad de llamada inválida.' };
      }
      const existing = endpoints.get(userId);
      if (existing && alive(existing) && existing.socketId !== socket.id) {
        return { error: 'Las llamadas están abiertas en otra pestaña.' };
      }
      endpoints.set(userId, { userId, socketId: socket.id,
        peerId: socket.data.callPeerId, email: socket.data.callEmail });
      return { ok: true };
    });

    handle('call:unready', (payload) => {
      if (typeof payload?.peerId !== 'string') return { error: 'Identidad de llamada inválida.' };
      unready(payload.peerId);
      return { ok: true };
    });

    handle('call:invite', (payload) => {
      if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); attempts = 0; }
      if (++attempts > 5) return { error: 'Espera un minuto antes de volver a llamar.' };
      const { callId, recipientId } = payload || {};
      if (typeof callId !== 'string' || !uuid.test(callId) || !Number.isSafeInteger(recipientId) ||
          recipientId < 1 || recipientId === userId || calls.has(callId)) {
        return { error: 'Solicitud de llamada inválida.' };
      }
      const caller = endpoints.get(userId);
      const recipient = endpoints.get(recipientId);
      if (caller?.socketId !== socket.id || !alive(caller)) return { error: 'Las llamadas no están listas.' };
      if (!alive(recipient)) return { error: 'La persona no está disponible.' };
      if (busy.has(userId) || busy.has(recipientId)) return { error: 'La persona está en otra llamada.' };
      const call = { id: callId, caller, recipient, status: 'ringing', connected: new Set() };
      calls.set(callId, call);
      busy.set(userId, callId);
      busy.set(recipientId, callId);
      call.timer = setTimeout(() => finish(call, 'La persona no respondió.'), 30_000);
      io.to(recipient.socketId).emit('call:incoming', {
        callId, caller: { id: userId, email: caller.email }, callerPeerId: caller.peerId,
      });
      return { callId };
    });

    handle('call:accept', (payload) => {
      const call = ownedCall(payload, true);
      if (!call || call.status !== 'ringing') return { error: 'La llamada ya no está disponible.' };
      if (!alive(call.caller) || !alive(call.recipient)) {
        finish(call, 'La llamada terminó.');
        return { error: 'La persona no está disponible.' };
      }
      call.status = 'connecting';
      clearTimeout(call.timer);
      call.timer = setTimeout(() => finish(call, 'No se pudo conectar la llamada.'), 30_000);
      io.to(call.caller.socketId).emit('call:accepted', {
        callId: call.id, recipientPeerId: call.recipient.peerId,
      });
      return { ok: true };
    });

    handle('call:connected', (payload) => {
      const call = ownedCall(payload);
      if (!call || call.status === 'ringing') return { error: 'Llamada inválida.' };
      call.connected.add(socket.id);
      if (call.connected.size === 2) { clearTimeout(call.timer); call.status = 'active'; }
      return { ok: true };
    });

    handle('call:reject', (payload) => {
      const call = ownedCall(payload, true);
      if (!call || call.status !== 'ringing') return { error: 'Llamada inválida.' };
      finish(call, 'La llamada fue rechazada.');
      return { ok: true };
    });

    handle('call:end', (payload) => {
      const call = ownedCall(payload);
      if (!call) return { error: 'La llamada ya terminó o no te pertenece.' };
      finish(call, 'La llamada terminó.');
      return { ok: true };
    });
    socket.on('disconnect', () => unready());
  });
}
