import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import { io as connect } from 'socket.io-client';
import app from '../src/app.js';
import { attachChat } from '../src/chat.js';
import User from '../src/models/User.js';
import Message from '../src/models/Message.js';

test('direct chat authenticates, persists, paginates and isolates participants', async (t) => {
  process.env.JWT_SECRET = 'a-test-secret-with-at-least-thirty-two-characters';
  const users = [1, 2, 3].map((id) => ({ id, email: `person${id}@example.com` }));
  const stored = [];
  t.mock.method(User, 'findByPk', async (id) => users.find((user) => user.id === Number(id)) ?? null);
  t.mock.method(User, 'findAll', async ({ attributes, where }) => {
    assert.deepEqual(attributes, ['id', 'email']);
    return users.filter((user) => user.id !== where.id[Op.ne]);
  });
  t.mock.method(Message, 'create', async (data) => {
    const message = { id: stored.length + 1, ...data, createdAt: new Date().toISOString() };
    stored.push(message);
    return { toJSON: () => message };
  });
  t.mock.method(Message, 'findAll', async ({ where, order, limit }) => {
    assert.deepEqual(order, [['id', 'DESC']]);
    assert.equal(limit, 51);
    return stored.filter((message) => where[Op.or].some((pair) => message.senderId === pair.senderId && message.recipientId === pair.recipientId))
      .filter((message) => !where.id || message.id < where.id[Op.lt]).sort((a, b) => b.id - a.id).slice(0, limit);
  });
  const server = createServer(app);
  const io = attachChat(server);
  const clients = [];
  t.after(async () => { clients.forEach((client) => client.disconnect()); await new Promise((resolve) => io.close(resolve)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const token = (id, expiresIn = '1h') => jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn });
  async function client(authToken, transports) {
    const socket = connect(url, { auth: { token: authToken }, transports, forceNew: true, reconnection: false, autoConnect: false });
    clients.push(socket);
    const ready = new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    socket.connect();
    await ready;
    return socket;
  }
  const get = (path, id = 1) => fetch(`${url}/api/chat/${path}`, { headers: { Authorization: `Bearer ${token(id)}` } });
  const send = (socket, payload) => socket.timeout(2000).emitWithAck('message:send', payload);

  assert.equal((await fetch(`${url}/api/chat/users`)).status, 401);
  await assert.rejects(client('invalid'), /Invalid or expired token/);
  await assert.rejects(client(token(1, -1)), /Invalid or expired token/);
  await assert.rejects(client(token(999)), /Invalid or expired token/);
  await assert.rejects(client(token('not-an-id')), /Invalid or expired token/);
  const findUser = User.findByPk;
  t.mock.method(console, 'error', () => {});
  User.findByPk = async () => { throw new Error('database unavailable'); };
  await assert.rejects(client(token(1)), /Chat unavailable/);
  User.findByPk = findUser;
  assert.deepEqual(await (await get('me')).json(), users[0]);
  assert.deepEqual(await (await get('users')).json(), users.slice(1));
  assert.equal((await get('me', 999)).status, 401);

  const alice = await client(token(1));
  const aliceTab = await client(token(1), ['websocket']);
  const bob = await client(token(2), ['websocket']);
  const outsider = await client(token(3));
  const outsiderMessages = [];
  outsider.on('message:new', (message) => outsiderMessages.push(message));
  const bobReceived = once(bob, 'message:new');
  const aliceReceived = once(aliceTab, 'message:new');
  const result = await send(alice, { senderId: 3, recipientId: 2, body: '  hello Bob  ' });
  assert.equal(result.message.senderId, 1);
  assert.equal(result.message.body, 'hello Bob');
  assert.deepEqual((await bobReceived)[0], result.message);
  assert.deepEqual((await aliceReceived)[0], result.message);
  assert.equal(stored.length, 1);

  for (const payload of [null, { recipientId: 1, body: 'self' }, { recipientId: 2, body: '   ' },
    { recipientId: '2', body: 'wrong type' }, { recipientId: 2, body: 'x'.repeat(2001) }, { recipientId: 999, body: 'missing' }]) {
    assert.ok((await send(alice, payload)).error);
  }
  assert.equal(stored.length, 1);
  assert.equal((await get('messages/nope')).status, 400);
  assert.equal((await get('messages/1')).status, 400);
  assert.equal((await get('messages/2?before=bad')).status, 400);
  assert.equal((await get('messages/999')).status, 404);
  assert.deepEqual(await (await get('messages/1', 3)).json(), { messages: [], nextCursor: null });
  assert.deepEqual((await (await get('messages/1', 2)).json()).messages, [result.message]);

  bob.disconnect();
  assert.ok((await send(alice, { recipientId: 2, body: 'saved while offline' })).message);
  const reconnected = await client(token(2));
  assert.equal((await (await get('messages/1', 2)).json()).messages.length, 2);
  assert.ok((await send(reconnected, { recipientId: 1, body: 'back online' })).message);
  for (let i = 0; i < 52; i++) await Message.create({ senderId: 1, recipientId: 2, body: `history ${i}` });
  const page = await (await get('messages/2')).json();
  assert.equal(page.messages.length, 50);
  assert.equal(page.nextCursor, 6);
  const older = await (await get(`messages/2?before=${page.nextCursor}`)).json();
  assert.equal(older.messages.length, 5);
  assert.equal(older.nextCursor, null);
  assert.equal(new Set([...older.messages, ...page.messages].map((message) => message.id)).size, 55);
  assert.equal((await (await get('messages/2', 3)).json()).messages.length, 0);

  const create = Message.create;
  Message.create = async () => { throw new Error('database unavailable'); };
  assert.match((await send(alice, { recipientId: 2, body: 'must not broadcast' })).error, /could not be saved/);
  Message.create = create;
  assert.equal(stored.length, 55);
  for (let i = 0; i < 30; i++) await send(alice, { recipientId: 2, body: '' });
  assert.match((await send(alice, { recipientId: 2, body: 'limited' })).error, /Too many/);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(outsiderMessages.length, 0);

  const expires = await client(token(1, 1));
  const disconnected = await once(expires, 'disconnect');
  assert.equal(disconnected[0], 'io server disconnect');
});
