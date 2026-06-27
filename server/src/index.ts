process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmetModule from 'helmet';
import rateLimitModule from 'express-rate-limit';
import { GAME_CONSTANTS } from '@monopoly/shared';

import { config } from './config/index.js';
import { initDatabase, getDatabase } from './config/database.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/error.middleware.js';

const helmet = helmetModule as any;
const rateLimit = rateLimitModule as any;

const app = express();
const httpServer = createServer(app);

// Configure helmet with default security policies
app.use(helmet());

// Configure CORS to match client domain
app.use(
  cors({
    origin: config.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  })
);

// Parse JSON bodies
app.use(express.json());

// API Rate limiter (max 100 requests per minute per IP)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Quá nhiều yêu cầu từ địa chỉ IP này, vui lòng thử lại sau.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// GET /api/health endpoint
app.get('/api/health', (req, res, next) => {
  try {
    const db = getDatabase();
    // Verify database responsiveness with a simple query
    const result = db.prepare('SELECT 1 as val').get() as { val: number } | undefined;
    
    if (!result || result.val !== 1) {
      throw new Error('Database check failed: SELECT 1 did not return 1');
    }

    res.json({
      status: 'ok',
      message: 'MonopolyBattle Server Scaffold Initialized',
      database: 'connected',
      constants: {
        startingMoney: GAME_CONSTANTS.STARTING_MONEY,
        defaultDuration: GAME_CONSTANTS.DEFAULT_ROUND_DURATION_SEC,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Attach global error middleware
app.use(errorHandler);

// Socket.IO server initialization
const io = new Server(httpServer, {
  cors: {
    origin: config.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// Socket.IO connection event placeholder (handlers to be wired in Day 2)
io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'New client connected via Socket.IO');

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'Client disconnected from Socket.IO');
  });
});

// Initialize database and start listening
try {
  initDatabase();
  httpServer.listen(config.PORT, () => {
    logger.info(`[Server] Bootstrap completed. Server running on port ${config.PORT}`);
  });
} catch (error) {
  logger.fatal({ err: error }, 'Failed to start server');
  process.exit(1);
}
