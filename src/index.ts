import express from 'express';
import cors from 'cors';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import mealRoutes from './routes/meals';
import setRoutes from './routes/sets';
import routineRoutes from './routes/routine';
import chatRoutes from './routes/chat';
import { mcpRouter } from './mcp/server';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);
app.use('/meals', mealRoutes);
app.use('/sets', setRoutes);
app.use('/routine', routineRoutes);
app.use('/chat', chatRoutes);
app.use('/mcp', mcpRouter);

// Error handler
app.use(errorHandler);

// Start server (only when not in test)
if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    logger.info(`Tally API running on port ${config.port}`);
  });
}

export default app;
