import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

export default sequelize.define('User', {
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { isEmail: true },
  },
  passwordHash: {
    type: DataTypes.STRING,
    allowNull: false,
  },
});
