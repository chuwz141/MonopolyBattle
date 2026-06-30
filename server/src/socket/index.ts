import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { SOCKET_EVENTS } from '@monopoly/shared';
import type {
  GamePhase,
  Decision,
  LeaderboardEntry,
  GameStateSyncPayload,
} from '@monopoly/shared';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getDatabase } from '../config/database.js';
import { GameRepository } from '../repositories/game.repository.js';
import { handleConnection } from './connection.handler.js';
import { registerHostHandlers } from './host-event.handler.js';
import { registerGameEventHandlers } from './game-event.handler.js';

/**
 * Interface representing all events emitted by the server to the client.
 */
export interface ServerToClientEvents {
  [SOCKET_EVENTS.GAME_STATE_SYNC]: (payload: GameStateSyncPayload) => void;
  [SOCKET_EVENTS.GAME_PHASE_CHANGE]: (payload: { phase: GamePhase; roundNumber: number; data?: unknown }) => void;
  [SOCKET_EVENTS.GAME_COUNTDOWN]: (payload: { seconds: number }) => void;
  [SOCKET_EVENTS.ROUND_START]: (payload: { roundNumber: number; decisions: Decision[]; timeLimit: number }) => void;
  [SOCKET_EVENTS.ROUND_TICK]: (payload: { timeLeft: number }) => void;
  [SOCKET_EVENTS.ROUND_DECISION_RECEIVED]: (payload: { teamId: string; confirmed: boolean }) => void;
  [SOCKET_EVENTS.ROUND_RESULTS]: (payload: { teamResults: unknown[]; marketState: unknown }) => void;
  [SOCKET_EVENTS.EVENT_TRIGGERED]: (payload: { eventType: string; title: string; description: string; effects: unknown }) => void;
  [SOCKET_EVENTS.NARRATOR_MESSAGE]: (payload: { text: string; type: 'info' | 'warning' | 'education'; relatedConcept?: string }) => void;
  [SOCKET_EVENTS.QUIZ_START]: (payload: { question: string; options: string[]; timeLimit: number }) => void;
  [SOCKET_EVENTS.QUIZ_RESULTS]: (payload: { correctAnswer: number; teamScores: unknown[]; explanation: string }) => void;
  [SOCKET_EVENTS.TEAM_JOINED]: (payload: { teamId: string; teamName: string; teamCount: number }) => void;
  [SOCKET_EVENTS.TEAM_READY]: (payload: { teamId: string; readyCount: number; totalCount: number }) => void;
  [SOCKET_EVENTS.TEAM_STATS_UPDATE]: (payload: { money: number; marketShare: number; technology: number; reputation: number; monopolyRisk: number }) => void;
  [SOCKET_EVENTS.MONOPOLY_DETECTED]: (payload: { teamId: string; teamName: string; explanation: string }) => void;
  [SOCKET_EVENTS.GAME_OVER]: (payload: { finalLeaderboard: LeaderboardEntry[]; gameStats: unknown }) => void;
  [SOCKET_EVENTS.ERROR]: (payload: { code: string; message: string }) => void;
}

/**
 * Interface representing all events received by the server from the client.
 * Using unknown for payloads as handlers are not yet implemented.
 */
export interface ClientToServerEvents {
  [SOCKET_EVENTS.PLAYER_JOIN]: (payload: unknown) => void;
  [SOCKET_EVENTS.PLAYER_READY]: (payload: unknown) => void;
  [SOCKET_EVENTS.PLAYER_DECISION]: (payload: unknown) => void;
  [SOCKET_EVENTS.PLAYER_QUIZ_ANSWER]: (payload: unknown) => void;
  [SOCKET_EVENTS.HOST_CREATE_GAME]: (payload: unknown) => void;
  [SOCKET_EVENTS.HOST_START_GAME]: (payload: unknown) => void;
  [SOCKET_EVENTS.HOST_NEXT_PHASE]: (payload: unknown) => void;
  [SOCKET_EVENTS.HOST_TRIGGER_EVENT]: (payload: unknown) => void;
  [SOCKET_EVENTS.HOST_PAUSE]: (payload: unknown) => void;
  [SOCKET_EVENTS.HOST_RESUME]: (payload: unknown) => void;
  [SOCKET_EVENTS.HOST_KICK_TEAM]: (payload: unknown) => void;
  [SOCKET_EVENTS.PROJECTOR_JOIN]: (payload: unknown) => void;
}

/**
 * Interface for typed socket data stored in Socket.IO session context.
 */
export interface CustomSocketData {
  role: 'host' | 'player' | 'projector';
  gameId: string;
  teamId?: string | undefined;
  userId?: string | undefined;
}

// Define explicit types for custom Socket and Server instances
export type MonopolySocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, CustomSocketData>;
export type MonopolyServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, CustomSocketData>;

// Initialize the Socket.IO server instance. It will be bound to the HTTP server via io.attach().
export const io: MonopolyServer = new Server({
  cors: {
    origin: config.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// Configure JWT Authentication middleware for Socket.IO
io.use((socket: MonopolySocket, next: (err?: Error) => void) => {
  const token = socket.handshake.auth.token;
  const role = socket.handshake.auth.role;
  const roomCode = socket.handshake.auth.roomCode;

  // Bypass token verification for projectors using valid room codes
  if (role === 'projector' && typeof roomCode === 'string' && roomCode.length === 6) {
    try {
      const activeDb = getDatabase();
      const gameRepo = new GameRepository(activeDb);
      const game = gameRepo.findByRoomCode(roomCode.toUpperCase());
      if (game) {
        socket.data = {
          role: 'projector',
          gameId: game.id,
        };
        logger.info(
          { socketId: socket.id, gameId: game.id, role: 'projector' },
          'Projector connection authenticated by room code'
        );
        return next();
      } else {
        logger.warn(
          { socketId: socket.id, roomCode },
          'Projector connection rejected: Room code not found'
        );
        return next(new Error('Authentication error: Room code not found'));
      }
    } catch (error) {
      logger.error({ socketId: socket.id, err: error }, 'Projector database lookup failed');
      return next(new Error('Authentication error: Database error'));
    }
  }

  if (!token || typeof token !== 'string') {
    logger.warn({ socketId: socket.id }, 'Socket connection rejected: No auth token provided');
    return next(new Error('Authentication error: Token is required'));
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as {
      role: 'host' | 'player' | 'projector';
      gameId: string;
      teamId?: string;
      userId?: string;
    };

    if (!decoded.role || !decoded.gameId) {
      logger.warn({ socketId: socket.id }, 'Socket connection rejected: Invalid token payload format');
      return next(new Error('Authentication error: Invalid token payload'));
    }

    // Attach strongly typed credentials to socket.data context
    socket.data = {
      role: decoded.role,
      gameId: decoded.gameId,
      teamId: decoded.teamId,
      userId: decoded.userId,
    };

    logger.debug(
      { socketId: socket.id, gameId: decoded.gameId, role: decoded.role },
      'Socket authentication successful'
    );
    next();
  } catch (error) {
    logger.warn({ socketId: socket.id, err: error }, 'Socket connection rejected: Token validation failed');
    return next(new Error('Authentication error: Invalid or expired token'));
  }
});

// Register connections and configure handlers
io.on('connection', (socket: MonopolySocket) => {
  // Delegate connection lifecycle, database updates, and player listeners
  handleConnection(socket);

  // Register host command listeners
  registerHostHandlers(socket);

  // Register player gameplay listeners (e.g. decision submits)
  registerGameEventHandlers(socket);
});

/**
 * Type-safe helper function to emit messages to a specific Socket.IO room.
 */
export function emitToRoom<Ev extends keyof ServerToClientEvents>(
  room: string,
  event: Ev,
  payload: Parameters<ServerToClientEvents[Ev]>[0]
): void {
  const operator = io.to(room);
  const emitter = operator.emit.bind(operator) as unknown as (
    ev: Ev,
    arg: Parameters<ServerToClientEvents[Ev]>[0]
  ) => boolean;
  emitter(event, payload);
}

/**
 * Type-safe helper function to emit messages directly to a specific socket connection.
 */
export function emitToSocket<Ev extends keyof ServerToClientEvents>(
  socketId: string,
  event: Ev,
  payload: Parameters<ServerToClientEvents[Ev]>[0]
): void {
  const operator = io.to(socketId);
  const emitter = operator.emit.bind(operator) as unknown as (
    ev: Ev,
    arg: Parameters<ServerToClientEvents[Ev]>[0]
  ) => boolean;
  emitter(event, payload);
}
