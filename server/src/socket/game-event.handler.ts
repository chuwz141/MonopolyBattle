import { SOCKET_EVENTS } from '@monopoly/shared';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { getDatabase } from '../config/database.js';
import { GameRepository } from '../repositories/game.repository.js';
import { TeamRepository } from '../repositories/team.repository.js';
import { RoundRepository } from '../repositories/round.repository.js';
import { DecisionLogRepository } from '../repositories/decision-log.repository.js';
import { RoundEventRepository } from '../repositories/round-event.repository.js';
import { DecisionEngine, DECISION_TYPES } from '../engine/decision.engine.js';
import { logger } from '../utils/logger.js';
import { viErrors } from '../utils/errors.js';
import { MonopolySocket, emitToRoom } from './index.js';
import { getEngine } from '../engine/game-engine.registry.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const playerDecisionSchema = z.object({
  roundId: z.string().min(1, 'Mã vòng chơi không hợp lệ'),
  decisionType: z.string().min(1, 'Loại quyết định không hợp lệ'),
});

const playerQuizAnswerSchema = z.object({
  questionId: z.string().min(1, 'Mã câu hỏi không hợp lệ'),
  selectedOption: z.number().int().min(0).max(3),
  timeTakenMs: z.number().int().min(0),
});

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

/**
 * Registers events triggered by players during the active game phases
 * (decision inputs and quiz answers).
 */
export function registerGameEventHandlers(socket: MonopolySocket): void {
  const { role, gameId, teamId } = socket.data;

  // ---------------------------------------------------------------------------
  // player:decision
  // ---------------------------------------------------------------------------
  socket.on(SOCKET_EVENTS.PLAYER_DECISION, (payload: unknown) => {
    // 1. Validate credentials & permissions
    if (role !== 'player' || !teamId || !gameId) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'FORBIDDEN', message: viErrors.forbidden });
      return;
    }

    // 2. Validate payload structure
    const parsed = playerDecisionSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(SOCKET_EVENTS.ERROR, {
        code: 'INVALID_PAYLOAD',
        message: parsed.error.issues[0]?.message ?? viErrors.invalidInput,
      });
      return;
    }

    const { roundId, decisionType } = parsed.data;

    // Validate if decisionType is a valid base decision type
    const validDecisionTypes = Object.values(DECISION_TYPES) as string[];
    if (!validDecisionTypes.includes(decisionType)) {
      socket.emit(SOCKET_EVENTS.ERROR, {
        code: 'INVALID_DECISION_TYPE',
        message: 'Loại quyết định không được hỗ trợ trong hệ thống.',
      });
      return;
    }

    const db = getDatabase();
    const gameRepo = new GameRepository(db);
    const roundRepo = new RoundRepository(db);
    const teamRepo = new TeamRepository(db);
    const decisionLogRepo = new DecisionLogRepository(db);
    const eventRepo = new RoundEventRepository(db);

    try {
      // 3. Retrieve round and verify active state constraints
      let round;
      const engine = getEngine(gameId);
      if (roundId === 'current') {
        const game = gameRepo.findById(gameId);
        if (!game) {
          socket.emit(SOCKET_EVENTS.ERROR, { code: 'GAME_NOT_FOUND', message: viErrors.gameNotFound });
          return;
        }
        const roundNumber = engine ? engine.currentRound : game.currentRound;
        round = roundRepo.findByGameIdAndRoundNumber(gameId, roundNumber);
      } else {
        round = roundRepo.findById(roundId);
      }

      if (!round) {
        socket.emit(SOCKET_EVENTS.ERROR, { code: 'ROUND_NOT_FOUND', message: 'Không tìm thấy vòng chơi.' });
        return;
      }

      const activeRoundId = round.id;

      if (round.gameId !== gameId) {
        socket.emit(SOCKET_EVENTS.ERROR, { code: 'FORBIDDEN_ROUND_ACCESS', message: viErrors.forbidden });
        return;
      }

      const activePhase = engine ? engine.phase : round.phase;
      if (activePhase !== 'decision') {
        socket.emit(SOCKET_EVENTS.ERROR, {
          code: 'INVALID_PHASE',
          message: 'Hiện tại không ở trong giai đoạn đưa ra quyết định.',
        });
        return;
      }

      // 4. Prevent duplicate submission per team per round
      const existingSubmission = decisionLogRepo.findByRoundIdAndTeamId(activeRoundId, teamId);
      if (existingSubmission) {
        socket.emit(SOCKET_EVENTS.ERROR, {
          code: 'DECISION_LOCKED',
          message: viErrors.decisionLocked,
        });
        return;
      }

      const team = teamRepo.findById(teamId);
      if (!team) {
        socket.emit(SOCKET_EVENTS.ERROR, { code: 'TEAM_NOT_FOUND', message: viErrors.teamNotFound });
        return;
      }

      // 5. Apply Business Logic calculation using DecisionEngine
      const activeEvent = round.eventId ? eventRepo.findById(round.eventId) : null;
      const context = {
        roundNumber: round.roundNumber,
        activeEvent: activeEvent ? { type: activeEvent.eventType } : null,
      };

      const decisionEngine = new DecisionEngine();
      const delta = decisionEngine.applyDecision(team, decisionType, context);

      // 6. Save decision log entry
      decisionLogRepo.create({
        id: uuid(),
        roundId: activeRoundId,
        teamId,
        decisionType,
        decisionDataJson: JSON.stringify({ cost: Math.abs(delta.money) }),
        moneyDelta: delta.money,
        marketShareDelta: delta.marketShare,
        technologyDelta: delta.technology,
        reputationDelta: delta.reputation,
        monopolyRiskDelta: delta.monopolyRisk,
        scoreEarned: 0,
        createdAt: new Date().toISOString(),
      });

      logger.info(
        { gameId, roundId: activeRoundId, teamId, decisionType, delta },
        'Player decision submitted and processed successfully.'
      );

      // 7. Acknowledge the player and notify the host
      socket.emit(SOCKET_EVENTS.ROUND_DECISION_RECEIVED, { teamId, confirmed: true });
      emitToRoom(`host:${gameId}`, SOCKET_EVENTS.ROUND_DECISION_RECEIVED, { teamId, confirmed: true });

      // 8. Trigger early round phase processing if all active teams have submitted
      const allTeams = teamRepo.findByGameId(gameId);
      const activeTeams = allTeams.filter((t) => t.status === 'playing' || t.status === 'ready');
      const submissions = decisionLogRepo.findMany({ roundId: activeRoundId });

      if (submissions.length === activeTeams.length && activeTeams.length > 0) {
        // Transition the round phase in DB
        roundRepo.update(activeRoundId, { phase: 'event' });

        // Broadcast game phase update to all rooms
        emitToRoom(`room:${gameId}`, SOCKET_EVENTS.GAME_PHASE_CHANGE, {
          phase: 'event',
          roundNumber: round.roundNumber,
        });

        logger.info(
          { gameId, roundId: activeRoundId },
          'All teams have submitted decisions. Early processing initiated: transitioned to event phase.'
        );
      }

      // 9. Forward to in-memory engine if active (engine handles early round processing)
      if (engine) {
        try {
          engine.submitDecision(teamId, decisionType);
        } catch (engineErr) {
          // Engine may throw if not in decision phase (e.g. already processing) — non-fatal
          logger.debug({ gameId, teamId, engineErr }, 'Engine submitDecision skipped (non-fatal).');
        }
      }
    } catch (err) {
      logger.error({ gameId, roundId, teamId, err }, 'Failed to record decision submission.');
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'SERVER_ERROR', message: viErrors.serverError });
    }
  });

  // ---------------------------------------------------------------------------
  // player:quiz-answer
  // ---------------------------------------------------------------------------
  socket.on(SOCKET_EVENTS.PLAYER_QUIZ_ANSWER, (payload: unknown) => {
    // 1. Validate credentials & permissions
    if (role !== 'player' || !teamId || !gameId) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'FORBIDDEN', message: viErrors.forbidden });
      return;
    }

    // 2. Validate payload
    const parsed = playerQuizAnswerSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(SOCKET_EVENTS.ERROR, {
        code: 'INVALID_PAYLOAD',
        message: parsed.error.issues[0]?.message ?? viErrors.invalidInput,
      });
      return;
    }

    const { questionId, selectedOption, timeTakenMs } = parsed.data;

    // 3. Look up the active in-memory engine for this game
    const engine = getEngine(gameId);
    if (!engine) {
      socket.emit(SOCKET_EVENTS.ERROR, {
        code: 'ENGINE_NOT_FOUND',
        message: 'Trò chơi chưa được khởi động hoặc đã kết thúc.',
      });
      return;
    }

    // 4. Verify game is in quiz phase
    if (engine.phase !== 'quiz') {
      socket.emit(SOCKET_EVENTS.ERROR, {
        code: 'INVALID_PHASE',
        message: 'Hiện tại không ở trong giai đoạn trả lời câu hỏi.',
      });
      return;
    }

    // 5. Verify the team exists in this game
    const team = engine.teams.get(teamId);
    if (!team) {
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'TEAM_NOT_FOUND', message: viErrors.teamNotFound });
      return;
    }

    let targetQuestionId = questionId;
    if (questionId === 'current') {
      targetQuestionId = engine.activeQuizQuestion?.id ?? '';
    }

    // 6. Delegate to engine (engine handles duplicate detection, scoring, and finalization)
    try {
      engine.submitQuizAnswer(teamId, targetQuestionId, selectedOption, timeTakenMs);

      logger.info(
        { gameId, teamId, questionId: targetQuestionId, selectedOption, timeTakenMs },
        'Quiz answer forwarded to engine successfully.'
      );
    } catch (err) {
      logger.error({ gameId, teamId, err }, 'Failed to submit quiz answer to engine.');
      socket.emit(SOCKET_EVENTS.ERROR, { code: 'SERVER_ERROR', message: viErrors.serverError });
    }
  });
}
