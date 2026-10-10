import express from 'express';
import cors from 'cors';
import { UniqueConstraintError, ValidationError } from 'sequelize';
import authRoutes from './routes/authRoutes.js';
import movieRoutes from './routes/movieRoutes.js';
import chatRoutes from './routes/chatRoutes.js';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '10kb' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/movies', movieRoutes);
app.use('/api/chat', chatRoutes);

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

app.use((error, req, res, next) => {
  if (error instanceof UniqueConstraintError) return res.status(409).json({ error: 'Email is already registered' });
  if (error instanceof ValidationError) return res.status(400).json({ error: error.errors[0].message });
  if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Invalid JSON' });
  if (error.status === 413) return res.status(413).json({ error: 'Request body is too large' });

  console.error(error);
  return res.status(500).json({ error: 'Internal server error' });
});

export default app;
