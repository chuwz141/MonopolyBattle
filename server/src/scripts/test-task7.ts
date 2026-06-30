import { ServerGameState, GameEngineCallbacks } from '../engine/game.engine.js';
import { Decision, GamePhase, LeaderboardEntry } from '@monopoly/shared';
import { v4 as uuid } from 'uuid';

async function runTask7Tests() {
  console.log('=== Starting Day 2 — Task 7 Game Engine Tests ===');

  const gameId = uuid();
  const team1Id = uuid();
  const team2Id = uuid();

  const eventsLog: string[] = [];
  let ticksReceived = 0;
  let gameOverLeaderboard: LeaderboardEntry[] | null = null;

  // 1. Set up callback observers
  const callbacks: GameEngineCallbacks = {
    onRoundStart: (roundNumber, decisions, duration) => {
      eventsLog.push(`onRoundStart: Round ${roundNumber}, Decisions: ${decisions.length}, Duration: ${duration}s`);
    },
    onRoundTick: (secondsLeft) => {
      ticksReceived++;
      eventsLog.push(`onRoundTick: ${secondsLeft}s left`);
    },
    onPhaseChange: (phase, roundNumber) => {
      eventsLog.push(`onPhaseChange: Phase -> ${phase}, Round ${roundNumber}`);
    },
    onGameOver: (leaderboard) => {
      gameOverLeaderboard = leaderboard;
      eventsLog.push('onGameOver: Leaderboard computed.');
    },
  };

  // 2. Initialize Game Engine
  const engine = new ServerGameState(gameId, 'game_test_seed_999', callbacks);

  // Register Teams
  engine.registerTeam({
    id: team1Id,
    name: 'Đội A',
    teamNumber: 1,
    money: 8000,
    marketShare: 30.0,
    technology: 10,
    reputation: 50,
    monopolyRisk: 5,
    status: 'playing',
  });

  engine.registerTeam({
    id: team2Id,
    name: 'Đội B',
    teamNumber: 2,
    money: 8000,
    marketShare: 30.0,
    technology: 10,
    reputation: 50,
    monopolyRisk: 5,
    status: 'playing',
  });

  console.log('Engine state initialized. Registered 2 teams.');

  // 3. Test startRound(1)
  console.log('\nStarting Round 1...');
  engine.startRound(1);

  if ((engine.phase as string) !== 'decision') {
    throw new Error(`Expected phase to be decision, got: ${engine.phase}`);
  }
  if (engine.availableDecisions.length !== 5) {
    throw new Error(`Expected 5 round candidate decisions, got: ${engine.availableDecisions.length}`);
  }
  console.log('✅ Round 1 started in decision phase with 5 decisions.');

  // Test state views
  const publicState = engine.getPublicState();
  const t1State = engine.getTeamState(team1Id);

  const team0 = publicState.teams[0];
  if (!team0 || team0.id !== team1Id || team0.submitted !== false) {
    throw new Error('Public state mismatch');
  }
  if (!t1State.myTeam || t1State.myTeam.money !== 8000 || t1State.availableDecisions.length === 0) {
    throw new Error('Team state private details missing');
  }
  console.log('✅ Public and private team states retrieved successfully.');

  // 4. Test submitDecision triggers early processing
  console.log('\nSubmitting decision for Team 1 (invest_tech)...');
  engine.submitDecision(team1Id, 'invest_tech');
  if (engine.submittedDecisions.size !== 1) {
    throw new Error('Expected submittedDecisions count to be 1');
  }

  console.log('Submitting decision for Team 2 (acquire)...');
  engine.submitDecision(team2Id, 'acquire');

  // Verify early process transitioned phase to 'event'
  if ((engine.phase as string) !== 'event') {
    throw new Error(`Expected early processing to transition phase to event, got: ${engine.phase}`);
  }
  console.log('✅ Early processing triggered immediately upon all submissions.');

  // Verify in-memory stats updated (Team 1 submitted invest_tech which adds 15 tech)
  const updatedT1 = engine.teams.get(team1Id)!;
  console.log('Team 1 updated stats:', updatedT1);
  if (updatedT1.technology !== 25) {
    throw new Error(`Expected Team 1 tech to be 25 (10 base + 15 invest_tech), got: ${updatedT1.technology}`);
  }
  console.log('✅ Team in-memory metrics updated with scaled deltas.');

  // 5. Test advancePhase transitions sequence
  console.log('\nAdvancing Phase: event -> narration...');
  engine.advancePhase();
  if ((engine.phase as string) !== 'narration') {
    throw new Error(`Expected phase to be narration, got: ${engine.phase}`);
  }

  console.log('Advancing Phase: narration -> results (no quiz in Round 1)...');
  engine.advancePhase();
  if ((engine.phase as string) !== 'results') {
    throw new Error(`Expected phase to be results, got: ${engine.phase}`);
  }

  console.log('Advancing Phase: results -> decision (starts Round 2)...');
  engine.advancePhase();
  if ((engine.phase as string) !== 'decision' || engine.currentRound !== 2) {
    throw new Error(`Expected round 2 decision phase, got: ${engine.phase} (Round ${engine.currentRound})`);
  }
  console.log('✅ Full phase transition loop transited to next round successfully.');

  // Stop active Round 2 timer to let script terminate clean
  engine.stopTimer();

  console.log('\nEvent notifications received during lifecycle:');
  eventsLog.forEach((evt) => console.log(`  - ${evt}`));

  console.log('\n=== All Day 2 — Task 7 Game Engine Tests Passed Successfully! ===');
}

runTask7Tests().catch((err) => {
  console.error('❌ Tests failed:', err);
  process.exit(1);
});
