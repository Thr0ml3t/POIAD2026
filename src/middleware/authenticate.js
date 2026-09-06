import jwt from 'jsonwebtoken';

export default function authenticate(req, res, next) {
  const [scheme, token] = (req.get('Authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Authentication required' });

  try {
    req.userId = Number(jwt.verify(token, process.env.JWT_SECRET).sub);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
