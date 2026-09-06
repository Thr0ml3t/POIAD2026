import { promisify } from 'node:util';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const deriveKey = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await deriveKey(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, storedPassword) {
  const [salt, storedHash] = storedPassword.split(':');
  if (!salt || !storedHash) return false;

  const hash = await deriveKey(password, salt, 64);
  const expected = Buffer.from(storedHash, 'hex');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

