import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

export default sequelize.define('Message', {
  senderId: { type: DataTypes.INTEGER, allowNull: false, references: { model: User, key: 'id' } },
  recipientId: { type: DataTypes.INTEGER, allowNull: false, references: { model: User, key: 'id' } },
  body: { type: DataTypes.STRING(2000), allowNull: false, validate: { len: [1, 2000] } },
}, {
  updatedAt: false,
  indexes: [{ fields: ['senderId', 'recipientId', 'id'] }, { fields: ['recipientId', 'senderId', 'id'] }],
});
