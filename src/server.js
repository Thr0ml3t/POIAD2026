import app from './app.js';
import sequelize from './config/database.js';
import { createServer } from 'node:http';
import { attachChat } from './chat.js';

async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }

  await sequelize.authenticate();
  await sequelize.sync();

  const port = Number(process.env.PORT) || 3000;
  const server = createServer(app);
  attachChat(server);
  server.listen(port, () => console.log(`API listening on http://localhost:${port}`));
}

start().catch((error) => {
  console.error('Unable to start API:', error.message);
  process.exitCode = 1;
});
