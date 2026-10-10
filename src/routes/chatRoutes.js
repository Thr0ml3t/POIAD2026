import { Router } from 'express';
import { Op } from 'sequelize';
import authenticate from '../middleware/authenticate.js';
import User from '../models/User.js';
import Message from '../models/Message.js';

const router = Router();
router.use(authenticate);

router.get('/me', async (req, res) => {
  const user = await User.findByPk(req.userId, { attributes: ['id', 'email'] });
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  return res.json(user);
});

router.get('/users', async (req, res) => {
  return res.json(await User.findAll({
    attributes: ['id', 'email'],
    where: { id: { [Op.ne]: req.userId } },
    order: [['email', 'ASC']],
  }));
});

router.get('/messages/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  const before = req.query.before === undefined ? undefined : Number(req.query.before);
  if (!Number.isSafeInteger(userId) || userId < 1 || userId === req.userId ||
      (before !== undefined && (!Number.isSafeInteger(before) || before < 1))) {
    return res.status(400).json({ error: 'Invalid user or message cursor' });
  }
  if (!(await User.findByPk(userId, { attributes: ['id'] }))) {
    return res.status(404).json({ error: 'User not found' });
  }
  const rows = await Message.findAll({
    where: {
      [Op.or]: [{ senderId: req.userId, recipientId: userId }, { senderId: userId, recipientId: req.userId }],
      ...(before === undefined ? {} : { id: { [Op.lt]: before } }),
    },
    order: [['id', 'DESC']],
    limit: 51,
  });
  const hasMore = rows.length > 50;
  const messages = rows.slice(0, 50).reverse();
  return res.json({ messages, nextCursor: hasMore ? messages[0].id : null });
});

export default router;
