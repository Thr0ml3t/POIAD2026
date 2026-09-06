import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

function tokenFor(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

export async function register(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;

  if (!email || email.length > 254 || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'A valid email and password of 8 to 128 characters are required' });
  }

  const user = await User.create({ email, passwordHash: await hashPassword(password) });
  return res.status(201).json({ token: tokenFor(user), user: { id: user.id, email: user.email } });
}

export async function login(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  const user = email && typeof password === 'string' ? await User.findOne({ where: { email } }) : null;

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  return res.json({ token: tokenFor(user), user: { id: user.id, email: user.email } });
}
