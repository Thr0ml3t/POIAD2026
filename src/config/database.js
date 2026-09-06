import { Sequelize } from 'sequelize';

export default new Sequelize(
  process.env.DB_NAME || 'movies_api',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
  },
);
