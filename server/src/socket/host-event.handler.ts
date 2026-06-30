import { SOCKET_EVENTS } from '@monopoly/shared';
import type { GamePhase, Decision, LeaderboardEntry } from '@monopoly/shared';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { getDatabase } from '../config/database.js';
import { GameRepository } from '../repositories/game.repository.js';
import { TeamRepository } from '../repositories/team.repository.js';
import { RoundRepository } from '../repositories/round.repository.js';
import { logger } from '../utils/logger.js';
import { viErrors } from '../utils/errors.js';
import { MonopolySocket, emitToRoom } from './index.js';
import { ServerGameState, InMemoryTeamState } from '../engine/game.engine.js';
import { registerEngine, getEngine, removeEngine } from '../engine/game-engine.registry.js';

// Module-level map to track active countdown timers (protects against duplicate starts)
const countdownIntervals = new Map<string, NodeJS.Timeout>();

// Zod schema for host:trigger-event
const hostTriggerEventSchema = z.object({
  eventType: z.string().min(1, 'Loại sự kiện không hợp lệ'),
});

// Default round decisions matching shared types Schema structure
const DEFAULT_DECISIONS: Decision[] = [
  {
    id: 'dec_1',
    type: 'invest_tech',
    nameVi: 'Đầu tư công nghệ',
    descriptionVi: 'Đầu tư vào nghiên cứu và phát triển để nâng cao trình độ công nghệ.',
    cost: 2000,
    effects: {
      money: -2000,
      marketShare: 1.0,
      technology: 15,
      reputation: 5,
      monopolyRisk: 2,
    },
  },
  {
    id: 'dec_2',
    type: 'acquire',
    nameVi: 'Thâu tóm đối thủ',
    descriptionVi: 'Thâu tóm một doanh nghiệp đối thủ nhỏ để nhanh chóng gia tăng thị phần.',
    cost: 5000,
    effects: {
      money: -5000,
      marketShare: 8.0,
      technology: 3,
      reputation: -10,
      monopolyRisk: 20,
    },
  },
];

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

/**
 * Registers events triggered by host actions during lobby or gameplay phases.
 */
export function registerHostHandlers(socket: MonopolySocket): void {
  const { role, gameId } = socket.data;

  // ---------------------------------------------------------------------------
  // 1. host:start-game
  // ---------------------------------------------------------------------------
  socket.on(SOCKET_EVENTS.HOST_START_GAME, () => {
    if (role !== 'host' || !gameId) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'FORBIDDEN', message: viErrors.forbidden });
      return;
    }

    const db = getDatabase();
    const gameRepo = new GameRepository(db);
    const teamRepo = new TeamRepository(db);

    const game = gameRepo.findById(gameId);
    if (!game) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'GAME_NOT_FOUND', message: viErrors.gameNotFound });
      return;
    }

    if (game.status !== 'lobby') {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'INVALID_STATE', message: 'Trò chơi đã bắt đầu hoặc đã kết thúc.' });
      return;
    }

    // Verify at least 2 teams are marked 'ready'
    const teams = teamRepo.findByGameId(gameId);
    const readyTeams = teams.filter((t) => t.status === 'ready');
    if (readyTeams.length < 2) {
      socket.emit(SOCKET_EVENTS.ERROR, {
        code: 'MINIMUM_TEAMS_REQUIRED',
        message: 'Cần tối thiểu 2 đội sẵn sàng để bắt đầu trò chơi.',
      });
      return;
    }

    // Safely clear any previously running countdown for this session
    const existingInterval = countdownIntervals.get(gameId);
    if (existingInterval) {
      clearInterval(existingInterval);
      countdownIntervals.delete(gameId);
    }

    // Broadcast transition to countdown phase
    emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_PHASE_CHANGE, {
      phase: 'countdown',
      roundNumber: 0,
    });

    let secondsLeft = 5;
    logger.info({ gameId }, 'Host initiated game start. Starting 5-second countdown.');

    emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_COUNTDOWN, { seconds: secondsLeft });

    const interval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
        emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_COUNTDOWN, { seconds: secondsLeft });
      } else {
        clearInterval(interval);
        countdownIntervals.delete(gameId);

        try {
          // Transition DB status to 'playing' and increment round to 1
          gameRepo.update(gameId, { status: 'playing', currentRound: 1 });

          // Seed round 1 info
          const roundRepo = new RoundRepository(db);
          roundRepo.create({
            id: uuid(),
            gameId,
            roundNumber: 1,
            phase: 'decision',
            availableDecisionsJson: JSON.stringify(DEFAULT_DECISIONS),
            eventId: null,
            narrationText: null,
          });

          logger.info({ gameId }, 'Countdown complete. Game session initialized to Round 1 (playing).');

          // Build and register the in-memory game engine
          const freshTeams = teamRepo.findByGameId(gameId);
          const engine = new ServerGameState(
            gameId,
            game.id, // use game.id as deterministic seed (no separate seed column in schema)
            {
              onRoundStart: (roundNumber, decisions, duration) => {
                emitToRoom(`room:${gameId}`, SOCKET_EVENTS.ROUND_START, {
                  roundNumber,
                  decisions,
                  timeLimit: duration,
                });
              },
              onRoundTick: (secondsLeft) => {
                emitToRoom(`room:${gameId}`, SOCKET_EVENTS.ROUND_TICK, { timeLeft: secondsLeft });
              },
              onPhaseChange: (phase, roundNumber, data) => {
                emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_PHASE_CHANGE, {
                  phase,
                  roundNumber,
                  ...(data !== undefined ? { data } : {}),
                });
              },
              onGameOver: (leaderboard) => {
                logger.info({ gameId, leaderboard: leaderboard.map((e) => e.teamName) }, 'onGameOver callback fired.');
              },
            },
            db
          );

          // Register teams in engine
          for (const t of freshTeams) {
            const teamState: InMemoryTeamState = {
              id: t.id,
              name: t.name,
              teamNumber: t.teamNumber,
              money: t.money,
              marketShare: t.marketShare,
              technology: t.technology,
              reputation: t.reputation,
              monopolyRisk: t.monopolyRisk,
              status: t.status,
              totalScore: t.totalScore,
              quizScore: t.quizScore,
            };
            engine.registerTeam(teamState);
          }

          // Register in global registry so other handlers can look it up
          registerEngine(gameId, engine);

          // Kick off round 1 via engine
          engine.startRound(1);

          logger.info({ gameId }, 'Game engine registered and Round 1 started.');
        } catch (err) {
          logger.error({ gameId, err }, 'Failed to transition game to playing state after countdown.');
          socket.emit(SOCKET_EVENTS.ERROR, { code: 'SERVER_ERROR', message: viErrors.serverError });
        }
      }
    }, 1000);

    countdownIntervals.set(gameId, interval);
  });

  // ---------------------------------------------------------------------------
  // 2. host:pause
  // ---------------------------------------------------------------------------
  socket.on(SOCKET_EVENTS.HOST_PAUSE, () => {
    if (role !== 'host' || !gameId) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'FORBIDDEN', message: viErrors.forbidden });
      return;
    }

    const db = getDatabase();
    const gameRepo = new GameRepository(db);
    const game = gameRepo.findById(gameId);
    if (!game) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'GAME_NOT_FOUND', message: viErrors.gameNotFound });
      return;
    }

    if (game.status !== 'playing') {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'INVALID_STATE', message: 'Trò chơi phải đang chạy để tạm dừng.' });
      return;
    }

    try {
      gameRepo.update(gameId, { status: 'paused' });
      logger.info({ gameId }, 'Host paused the game.');

      const roundRepo = new RoundRepository(db);
      const round = roundRepo.findByGameIdAndRoundNumber(gameId, game.currentRound);
      const currentPhase = round?.phase ?? 'decision';

      emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_PHASE_CHANGE, {
        phase: currentPhase,
        roundNumber: game.currentRound,
        data: { paused: true },
      });
    } catch (err) {
      logger.error({ gameId, err }, 'Failed to update game status to paused.');
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'SERVER_ERROR', message: viErrors.serverError });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. host:resume
  // ---------------------------------------------------------------------------
  socket.on(SOCKET_EVENTS.HOST_RESUME, () => {
    if (role !== 'host' || !gameId) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'FORBIDDEN', message: viErrors.forbidden });
      return;
    }

    const db = getDatabase();
    const gameRepo = new GameRepository(db);
    const game = gameRepo.findById(gameId);
    if (!game) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'GAME_NOT_FOUND', message: viErrors.gameNotFound });
      return;
    }

    if (game.status !== 'paused') {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'INVALID_STATE', message: 'Trò chơi phải đang tạm dừng để tiếp tục.' });
      return;
    }

    try {
      gameRepo.update(gameId, { status: 'playing' });
      logger.info({ gameId }, 'Host resumed the game.');

      const roundRepo = new RoundRepository(db);
      const round = roundRepo.findByGameIdAndRoundNumber(gameId, game.currentRound);
      const currentPhase = round?.phase ?? 'decision';

      emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_PHASE_CHANGE, {
        phase: currentPhase,
        roundNumber: game.currentRound,
        data: { paused: false },
      });
    } catch (err) {
      logger.error({ gameId, err }, 'Failed to update game status to playing.');
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'SERVER_ERROR', message: viErrors.serverError });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. host:next-phase
  // ---------------------------------------------------------------------------
  socket.on(SOCKET_EVENTS.HOST_NEXT_PHASE, () => {
    if (role !== 'host' || !gameId) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'FORBIDDEN', message: viErrors.forbidden });
      return;
    }

    const db = getDatabase();
    const gameRepo = new GameRepository(db);
    const game = gameRepo.findById(gameId);
    if (!game) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'GAME_NOT_FOUND', message: viErrors.gameNotFound });
      return;
    }

    if (game.status !== 'playing') {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'INVALID_STATE', message: 'Trò chơi phải đang hoạt động để chuyển phase.' });
      return;
    }

    const engine = getEngine(gameId);
    if (engine) {
      try {
        engine.advancePhase();
        return;
      } catch (err) {
        logger.error({ gameId, err }, 'Failed to advance phase on GameEngine.');
        socket.emit(SOCKET_EVENTS.ERROR, { code: 'SERVER_ERROR', message: viErrors.serverError });
        return;
      }
    }

    const roundRepo = new RoundRepository(db);
    const round = roundRepo.findByGameIdAndRoundNumber(gameId, game.currentRound);
    if (!round) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'ROUND_NOT_FOUND', message: 'Không tìm thấy thông tin vòng chơi hiện tại.' });
      return;
    }

    try {
      let nextPhase: GamePhase;
      let nextRoundNumber = game.currentRound;
      let isGameOver = false;

      if (round.phase === 'decision') {
        nextPhase = 'event';
      } else if (round.phase === 'event') {
        nextPhase = 'narration';
      } else if (round.phase === 'narration') {
        const hasQuiz = game.currentRound === 3 || game.currentRound === 5 || game.currentRound === 7;
        nextPhase = hasQuiz ? 'quiz' : 'results';
      } else if (round.phase === 'quiz') {
        nextPhase = 'results';
      } else if (round.phase === 'results') {
        if (game.currentRound < game.totalRounds) {
          nextRoundNumber = game.currentRound + 1;
          nextPhase = 'decision';
        } else {
          nextPhase = 'finished';
          isGameOver = true;
        }
      } else {
        socket.emit(SOCKET_EVENTS.ERROR, { code: 'INVALID_STATE', message: 'Vòng chơi hiện tại đang ở trạng thái không xác định.' });
        return;
      }

      logger.info({ gameId, fromPhase: round.phase, nextPhase, nextRoundNumber }, 'Advancing game phase.');

      if (isGameOver) {
        gameRepo.update(gameId, { status: 'finished' });

        emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_PHASE_CHANGE, {
          phase: 'finished',
          roundNumber: game.currentRound,
        });

        const teamRepo = new TeamRepository(db);
        const dbTeams = teamRepo.findByGameId(gameId);
        const sortedTeams = [...dbTeams].sort((a, b) => b.totalScore - a.totalScore);
        const finalLeaderboard: LeaderboardEntry[] = sortedTeams.map((t, idx) => ({
          rank: idx + 1,
          teamId: t.id,
          teamName: t.name,
          teamNumber: t.teamNumber,
          totalScore: t.totalScore,
          marketShare: t.marketShare,
          monopolyRisk: t.monopolyRisk,
          rankChange: 'same',
        }));

        emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_OVER, {
          finalLeaderboard,
          gameStats: { totalTeams: dbTeams.length, roundsPlayed: game.totalRounds },
        });
      } else if (nextPhase === 'decision') {
        gameRepo.update(gameId, { currentRound: nextRoundNumber });
        roundRepo.create({
          id: uuid(),
          gameId,
          roundNumber: nextRoundNumber,
          phase: 'decision',
          availableDecisionsJson: JSON.stringify(DEFAULT_DECISIONS),
          eventId: null,
          narrationText: null,
        });

        emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_PHASE_CHANGE, {
          phase: 'decision',
          roundNumber: nextRoundNumber,
        });

        emitToRoom(`room:${gameId}`, SOCKET_EVENTS.ROUND_START, {
          roundNumber: nextRoundNumber,
          decisions: DEFAULT_DECISIONS,
          timeLimit: game.roundDurationSec,
        });
      } else {
        roundRepo.update(round.id, { phase: nextPhase as 'decision' | 'event' | 'quiz' | 'narration' | 'results' });

        emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_PHASE_CHANGE, {
          phase: nextPhase,
          roundNumber: game.currentRound,
        });
      }
    } catch (err) {
      logger.error({ gameId, err }, 'Failed to advance game phase.');
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'SERVER_ERROR', message: viErrors.serverError });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. host:trigger-event
  // ---------------------------------------------------------------------------
  socket.on(SOCKET_EVENTS.HOST_TRIGGER_EVENT, (payload: unknown) => {
    if (role !== 'host' || !gameId) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'FORBIDDEN', message: viErrors.forbidden });
      return;
    }

    const parsed = hostTriggerEventSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(SOCKET_EVENTS.ERROR, {
        code: 'INVALID_PAYLOAD',
        message: parsed.error.issues[0]?.message ?? viErrors.invalidInput,
      });
      return;
    }

    const { eventType } = parsed.data;

    const db = getDatabase();
    const gameRepo = new GameRepository(db);
    const game = gameRepo.findById(gameId);

    if (!game) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'GAME_NOT_FOUND', message: viErrors.gameNotFound });
      return;
    }

    if (game.status !== 'playing') {
      socket.emit(SOCKET_EVENTS.ERROR, {
        code: 'INVALID_STATE',
        message: 'Trò chơi phải đang hoạt động để kích hoạt sự kiện.',
      });
      return;
    }

    try {
      // Build a minimal event payload and broadcast to the room
      const eventId = uuid();

      logger.info({ gameId, eventType, eventId }, 'Host manually triggered event.');

      emitToRoom(`room:${gameId}`, SOCKET_EVENTS.EVENT_TRIGGERED, {
        eventType,
        title: `Sự kiện đặc biệt: ${eventType}`,
        description: `Giảng viên đã kích hoạt sự kiện "${eventType}" để minh hoạ bài học.`,
        effects: {},
      });

      // If the engine is active, log the manual trigger
      const engine = getEngine(gameId);
      if (engine) {
        logger.info(
          { gameId, eventType, enginePhase: engine.phase },
          'Host trigger-event: engine is active, event broadcast complete.'
        );
      }
    } catch (err) {
      logger.error({ gameId, eventType: parsed.data.eventType, err }, 'Failed to trigger event for host.');
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'SERVER_ERROR', message: viErrors.serverError });
    }
  });
  // ---------------------------------------------------------------------------
  // 6. host:end-game  (force-finish)
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (socket as any).on('host:end-game', () => {
    if (role !== 'host' || !gameId) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'FORBIDDEN', message: viErrors.forbidden });
      return;
    }

    const db = getDatabase();
    const gameRepo = new GameRepository(db);
    const teamRepo = new TeamRepository(db);

    const game = gameRepo.findById(gameId);
    if (!game) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'GAME_NOT_FOUND', message: viErrors.gameNotFound });
      return;
    }

    if (game.status === 'finished') {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'INVALID_STATE', message: 'Trò chơi đã kết thúc rồi.' });
      return;
    }

    try {
      // Mark game finished in DB
      gameRepo.update(gameId, { status: 'finished' });

      // Build final leaderboard from current DB state
      const teams = teamRepo.findByGameId(gameId);
      const ranked: LeaderboardEntry[] = [...teams]
        .sort((a, b) => b.totalScore - a.totalScore)
        .map((t, idx) => ({
          teamId: t.id,
          teamName: t.name,
          teamNumber: t.teamNumber,
          totalScore: t.totalScore,
          quizScore: t.quizScore,
          marketShare: t.marketShare,
          monopolyRisk: t.monopolyRisk,
          rank: idx + 1,
          rankChange: 'same' as const,
        }));

      logger.info({ gameId, teams: ranked.map((r) => r.teamName) }, 'Host force-ended the game.');

      emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_OVER, {
        finalLeaderboard: ranked,
        gameStats: {
          educationalSummary: null,
          roundsPlayed: game.currentRound,
        },
      });

      emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_PHASE_CHANGE, {
        phase: 'finished',
        roundNumber: game.currentRound,
      });

      // Remove from in-memory engine registry (already statically imported above)
      removeEngine(gameId);
    } catch (err) {
      logger.error({ gameId, err }, 'Failed to force-end game.');
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'SERVER_ERROR', message: viErrors.serverError });
    }
  });
}
