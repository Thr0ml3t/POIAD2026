import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import app from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

test('passwords are salted and verified', async () => {
  const first = await hashPassword('correct horse');
  const second = await hashPassword('correct horse');

  assert.notEqual(first, second);
  assert.equal(await verifyPassword('correct horse', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(await verifyPassword('anything', 'malformed'), false);
});

test('health is public and movies require authentication', async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  await once(server, 'listening');

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${baseUrl}/health`);
  const movies = await fetch(`${baseUrl}/api/movies`);

  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(movies.status, 401);
});
