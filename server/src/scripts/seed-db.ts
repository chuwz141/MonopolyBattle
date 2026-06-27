import { v4 as uuid } from 'uuid';
import { getDatabase } from '../config/database.js';
import { GameRepository } from '../repositories/game.repository.js';
import { TeamRepository } from '../repositories/team.repository.js';
import { PlayerRepository } from '../repositories/player.repository.js';
import { RoundRepository } from '../repositories/round.repository.js';
import { DecisionLogRepository } from '../repositories/decision-log.repository.js';
import { RoundEventRepository } from '../repositories/round-event.repository.js';
import { QuizAnswerRepository } from '../repositories/quiz-answer.repository.js';
import { logger } from '../utils/logger.js';

export function seedDatabase(): void {
  const db = getDatabase();
  logger.info('Database seeding started...');

  const gameRepo = new GameRepository(db);
  const teamRepo = new TeamRepository(db);
  const playerRepo = new PlayerRepository(db);
  const roundRepo = new RoundRepository(db);
  const decisionLogRepo = new DecisionLogRepository(db);
  const roundEventRepo = new RoundEventRepository(db);
  const quizAnswerRepo = new QuizAnswerRepository(db);

  // Run everything inside a transaction to ensure clean rollbacks on failure
  const runSeeding = db.transaction(() => {
    logger.info('Clearing old data from tables...');
    // Delete in reverse order of foreign keys
    db.prepare('DELETE FROM quiz_answer').run();
    db.prepare('DELETE FROM round_event').run();
    db.prepare('DELETE FROM decision_log').run();
    db.prepare('DELETE FROM player').run();
    db.prepare('DELETE FROM team').run();
    db.prepare('DELETE FROM round').run();
    db.prepare('DELETE FROM game').run();
    logger.info('Tables cleared successfully.');

    // 1. Create a Game
    const gameId = uuid();
    const game = gameRepo.create({
      id: gameId,
      roomCode: 'TEST12',
      hostPin: '123456', // Simulated hash/pin
      status: 'playing',
      currentRound: 1,
      totalRounds: 8,
      roundDurationSec: 60,
      settingsJson: JSON.stringify({ quizEnabled: true }),
    });
    logger.info({ gameId: game.id }, 'Seeded Game');

    // 2. Create Teams
    const teamsData = [
      { name: 'Hải Quân', teamNumber: 1, marketShare: 33.3 },
      { name: 'Không Quân', teamNumber: 2, marketShare: 33.4 },
      { name: 'Lục Quân', teamNumber: 3, marketShare: 33.3 },
    ];

    const seededTeams = teamsData.map((t) => {
      const team = teamRepo.create({
        id: uuid(),
        gameId,
        name: t.name,
        teamNumber: t.teamNumber,
        money: 10000,
        marketShare: t.marketShare,
        technology: 10,
        reputation: 50,
        monopolyRisk: 15,
        totalScore: 100,
        quizScore: 0,
        status: 'playing',
      });
      logger.info({ teamId: team.id, name: team.name }, 'Seeded Team');
      return team;
    });

    // 3. Create Players for each team
    seededTeams.forEach((team) => {
      const player1 = playerRepo.create({
        id: uuid(),
        teamId: team.id,
        displayName: `Đội trưởng ${team.name}`,
        socketId: `socket_${team.name.toLowerCase()}_1`,
        isConnected: 1,
      });
      const player2 = playerRepo.create({
        id: uuid(),
        teamId: team.id,
        displayName: `Thành viên ${team.name}`,
        socketId: `socket_${team.name.toLowerCase()}_2`,
        isConnected: 1,
      });
      logger.info({ p1: player1.displayName, p2: player2.displayName }, 'Seeded Players');
    });

    // 4. Create Round 1
    const roundId = uuid();
    const round = roundRepo.create({
      id: roundId,
      gameId,
      roundNumber: 1,
      phase: 'decision',
      availableDecisionsJson: JSON.stringify([
        { id: 'dec_1', type: 'invest_tech', nameVi: 'Đầu tư công nghệ', cost: 1000 },
        { id: 'dec_2', type: 'acquire', nameVi: 'Thâu tóm đối thủ nhỏ', cost: 3000 },
      ]),
      eventId: 'evt_crisis_01',
      narrationText: 'Trận chiến bắt đầu, các đội đang chuẩn bị đưa ra quyết định.',
    });
    logger.info({ roundId: round.id }, 'Seeded Round 1');

    // 5. Seed Decision Logs for Round 1
    seededTeams.forEach((team) => {
      const decLog = decisionLogRepo.create({
        id: uuid(),
        roundId,
        teamId: team.id,
        decisionType: 'invest_tech',
        decisionDataJson: JSON.stringify({ cost: 1000 }),
        moneyDelta: -1000,
        marketShareDelta: 2.5,
        technologyDelta: 15,
        reputationDelta: 5,
        monopolyRiskDelta: 2,
        scoreEarned: 25,
        createdAt: new Date().toISOString(),
      });
      logger.info({ decLogId: decLog.id, teamId: team.id }, 'Seeded Decision Log');
    });

    // 6. Seed a Round Event
    const roundEvent = roundEventRepo.create({
      id: uuid(),
      roundId,
      eventType: 'crisis',
      eventDataJson: JSON.stringify({ inflationRate: 5.5 }),
      narrationText: 'Một cuộc khủng hoảng kinh tế toàn cầu nổ ra khiến chi phí tăng.',
      createdAt: new Date().toISOString(),
    });
    logger.info({ roundEventId: roundEvent.id }, 'Seeded Round Event');

    // 7. Seed Quiz Answers for Round 1
    seededTeams.forEach((team, index) => {
      const isCorrect = index === 0 ? 1 : 0; // First team is correct, others incorrect
      const quizAns = quizAnswerRepo.create({
        id: uuid(),
        roundId,
        teamId: team.id,
        questionId: 'quiz_mb_001',
        selectedOption: isCorrect ? 0 : 2,
        isCorrect,
        timeTakenMs: 12500,
        scoreEarned: isCorrect ? 50 : 0,
        createdAt: new Date().toISOString(),
      });
      logger.info({ quizAnsId: quizAns.id, teamId: team.id }, 'Seeded Quiz Answer');
    });
  });

  try {
    runSeeding();
    logger.info('Database seeded successfully!');
  } catch (error) {
    logger.error({ err: error }, 'Seeding failed');
    throw error;
  }
}

// Automatically invoke if run directly
import { fileURLToPath } from 'url';
import path from 'path';

const currentFilePath = fileURLToPath(import.meta.url);
const runFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (currentFilePath === runFilePath) {
  try {
    seedDatabase();
  } catch (err: any) {
    console.error('CRITICAL SEED ERROR:', err);
    if (err && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}
