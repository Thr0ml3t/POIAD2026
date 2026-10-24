import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { io as connect } from 'socket.io-client';
import app from '../src/app.js';
import { attachChat } from '../src/chat.js';
import { attachVideoCalls } from '../src/videoCalls.js';
import User from '../src/models/User.js';

test('video invitations require authentication, consent and exact participant sockets', { timeout: 10_000 }, async (t) => {
  process.env.JWT_SECRET = 'a-test-secret-with-at-least-thirty-two-characters';
  t.mock.method(User, 'findByPk', async (id) => [1, 2, 3].includes(id) ? { id, email: `user${id}@example.com` } : null);
  const server = createServer(app);
  const io = attachChat(server);
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => io.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  async function client(userId) {
    const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const socket = connect(url, { auth: { token }, forceNew: true, reconnection: false, autoConnect: false });
    clients.push(socket);
    const connected = new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    socket.connect();
    await connected;
    return socket;
  }
  const request = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
  const alice = await client(1);
  const bob = await client(2);
  const charlie = await client(3);
  const otherAliceTab = await client(1);
  const outsiderEvents = [];
  charlie.on('call:incoming', (event) => outsiderEvents.push(event));
  charlie.on('call:accepted', (event) => outsiderEvents.push(event));
  charlie.on('call:ended', (event) => outsiderEvents.push(event));
  const aliceIdentity = await request(alice, 'call:register');
  const bobIdentity = await request(bob, 'call:register');
  assert.ok((await request(alice, 'call:ready', { peerId: 'forged' })).error);
  assert.deepEqual(await request(alice, 'call:ready', aliceIdentity), { ok: true });
  assert.deepEqual(await request(bob, 'call:ready', bobIdentity), { ok: true });
  assert.ok((await request(otherAliceTab, 'call:register')).error);
  assert.ok((await request(alice, 'call:invite', { callId: randomUUID(), recipientId: 1 })).error);
  assert.ok((await request(alice, 'call:invite', { callId: 'invalid', recipientId: 2 })).error);

  const callId = randomUUID();
  const invitation = once(bob, 'call:incoming');
  assert.deepEqual(await request(alice, 'call:invite', { callId, recipientId: 2, callerPeerId: 'forged' }), { callId });
  assert.deepEqual((await invitation)[0], { callId, caller: { id: 1, email: 'user1@example.com' }, callerPeerId: aliceIdentity.peerId });
  for (const event of ['call:accept', 'call:reject', 'call:end']) assert.ok((await request(charlie, event, { callId })).error);
  assert.ok((await request(alice, 'call:accept', { callId })).error);
  assert.ok((await request(alice, 'call:connected', { callId })).error);
  assert.ok((await request(alice, 'call:register')).error);
  assert.ok((await request(otherAliceTab, 'call:end', { callId })).error);
  assert.ok((await request(bob, 'call:invite', { callId: randomUUID(), recipientId: 1 })).error);
  const accepted = once(alice, 'call:accepted');
  assert.deepEqual(await request(bob, 'call:accept', { callId }), { ok: true });
  assert.deepEqual((await accepted)[0], { callId, recipientPeerId: bobIdentity.peerId });
  assert.deepEqual(await request(alice, 'call:connected', { callId }), { ok: true });
  assert.deepEqual(await request(bob, 'call:connected', { callId }), { ok: true });
  const bobEnded = once(bob, 'call:ended');
  assert.deepEqual(await request(alice, 'call:end', { callId }), { ok: true });
  assert.equal((await bobEnded)[0].callId, callId);
  assert.ok((await request(alice, 'call:end', { callId })).error);

  const rejectedId = randomUUID();
  await request(alice, 'call:invite', { callId: rejectedId, recipientId: 2 });
  assert.deepEqual(await request(bob, 'call:reject', { callId: rejectedId }), { ok: true });
  const disconnectedId = randomUUID();
  await request(bob, 'call:invite', { callId: disconnectedId, recipientId: 1 });
  const aliceEnded = once(alice, 'call:ended');
  bob.disconnect();
  assert.equal((await aliceEnded)[0].callId, disconnectedId);
  assert.ok((await request(alice, 'call:invite', { callId: randomUUID(), recipientId: 2 })).error);
  assert.match((await request(alice, 'call:invite', { callId: randomUUID(), recipientId: 2 })).error, /Espera un minuto/);
  assert.equal(outsiderEvents.length, 0);
});

test('video timeouts release busy users and active calls survive the connection deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(User, 'findByPk', async (id) => ({ id, email: `user${id}@example.com` }));
  const io = new EventEmitter();
  io.sockets = { sockets: new Map() };
  const events = [];
  io.to = (socketId) => ({ emit: (event, payload) => events.push({ socketId, event, ...payload }) });
  attachVideoCalls(io);
  const request = (socket, event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));
  const sockets = [1, 2].map((userId) => {
    const socket = new EventEmitter();
    socket.id = `socket-${userId}`;
    socket.data = { userId, expiresAt: Date.now() + 3600_000 };
    io.sockets.sockets.set(socket.id, socket);
    io.emit('connection', socket);
    return socket;
  });
  const [alice, bob] = sockets;
  for (const socket of sockets) {
    const identity = await request(socket, 'call:register');
    assert.deepEqual(await request(socket, 'call:ready', identity), { ok: true });
  }
  async function invite() {
    const callId = randomUUID();
    assert.deepEqual(await request(alice, 'call:invite', { callId, recipientId: 2 }), { callId });
    return callId;
  }
  const unanswered = await invite();
  t.mock.timers.tick(30_000);
  assert.equal(events.filter((event) => event.callId === unanswered && event.event === 'call:ended').length, 2);
  assert.ok((await request(bob, 'call:accept', { callId: unanswered })).error);
  const connecting = await invite();
  await request(bob, 'call:accept', { callId: connecting });
  await request(alice, 'call:connected', { callId: connecting });
  t.mock.timers.tick(30_000);
  assert.equal(events.filter((event) => event.callId === connecting && event.event === 'call:ended').length, 2);
  const active = await invite();
  await request(bob, 'call:accept', { callId: active });
  for (const socket of sockets) await request(socket, 'call:connected', { callId: active });
  t.mock.timers.tick(60_000);
  assert.equal(events.filter((event) => event.callId === active && event.event === 'call:ended').length, 0);
  await request(bob, 'call:unready', { peerId: bob.data.callPeerId });
  assert.equal(events.filter((event) => event.callId === active && event.event === 'call:ended').length, 2);
  bob.data.expiresAt = Date.now() - 1;
  assert.match((await request(bob, 'call:register')).error, /sesión expiró/);
});
