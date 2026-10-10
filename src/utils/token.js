import jwt from 'jsonwebtoken';

export function verifyToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  const userId = Number(payload.sub);
  if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isFinite(payload.exp)) {
    throw new Error('Invalid token');
  }
  return { userId, expiresAt: payload.exp * 1000 };
}
