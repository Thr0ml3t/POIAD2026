import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

export default sequelize.define('Movie', {
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { notEmpty: true },
  },
});
