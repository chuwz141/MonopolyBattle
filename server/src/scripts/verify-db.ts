import { getDatabase } from '../config/database.js';
import { GameRepository } from '../repositories/game.repository.js';
import { TeamRepository } from '../repositories/team.repository.js';
import { PlayerRepository } from '../repositories/player.repository.js';
import { RoundRepository } from '../repositories/round.repository.js';
import { DecisionLogRepository } from '../repositories/decision-log.repository.js';
import { RoundEventRepository } from '../repositories/round-event.repository.js';
import { QuizAnswerRepository } from '../repositories/quiz-answer.repository.js';

function verifyDb() {
  const db = getDatabase();
  console.log('--- Database Verification Script ---');

  const gameRepo = new GameRepository(db);
  const teamRepo = new TeamRepository(db);
  const playerRepo = new PlayerRepository(db);
  const roundRepo = new RoundRepository(db);
  const decisionLogRepo = new DecisionLogRepository(db);
  const roundEventRepo = new RoundEventRepository(db);
  const quizAnswerRepo = new QuizAnswerRepository(db);

  // 1. Fetch Game
  const games = gameRepo.findMany();
  console.log(`Games count: ${games.length}`);
  if (games.length > 0) {
    const g = games[0]!;
    console.log(`- Room Code: ${g.roomCode}, Status: ${g.status}, Total Rounds: ${g.totalRounds}`);
    const foundGame = gameRepo.findByRoomCode(g.roomCode);
    console.log(`- findByRoomCode validation: ${foundGame ? 'SUCCESS' : 'FAILED'}`);
  }

  // 2. Fetch Teams
  const teams = teamRepo.findMany();
  console.log(`Teams count: ${teams.length}`);
  teams.forEach(t => {
    console.log(`- [Team ${t.teamNumber}] Name: ${t.name}, Money: ${t.money}, Market Share: ${t.marketShare}%`);
  });

  // 3. Fetch Players
  const players = playerRepo.findMany();
  console.log(`Players count: ${players.length}`);
  players.forEach(p => {
    console.log(`- Player: ${p.displayName}, Team ID: ${p.teamId.substring(0, 8)}..., Connected: ${p.isConnected}`);
  });

  // 4. Fetch Rounds
  const rounds = roundRepo.findMany();
  console.log(`Rounds count: ${rounds.length}`);
  if (rounds.length > 0) {
    const r = rounds[0]!;
    console.log(`- Round Number: ${r.roundNumber}, Phase: ${r.phase}, Narration: ${r.narrationText}`);
  }

  // 5. Fetch Decision Logs
  const decLogs = decisionLogRepo.findMany();
  console.log(`Decision Logs count: ${decLogs.length}`);
  decLogs.forEach(d => {
    console.log(`- Decision Type: ${d.decisionType}, Money Delta: ${d.moneyDelta}, Score Earned: ${d.scoreEarned}`);
  });

  // 6. Fetch Round Events
  const events = roundEventRepo.findMany();
  console.log(`Round Events count: ${events.length}`);
  events.forEach(e => {
    console.log(`- Event Type: ${e.eventType}, Narration: ${e.narrationText}`);
  });

  // 7. Fetch Quiz Answers
  const answers = quizAnswerRepo.findMany();
  console.log(`Quiz Answers count: ${answers.length}`);
  answers.forEach(a => {
    console.log(`- Question ID: ${a.questionId}, Is Correct: ${a.isCorrect}, Time Taken: ${a.timeTakenMs}ms`);
  });

  console.log('--- Verification Completed ---');
}

verifyDb();
