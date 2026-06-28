import { check as detectMonopoly, MONOPOLY_THRESHOLDS } from '../engine/monopoly-detector.js';
import { ServerGameState, GameEngineCallbacks } from '../engine/game.engine.js';
import { LeaderboardEntry } from '@monopoly/shared';
import { v4 as uuid } from 'uuid';
import Database from 'better-sqlite3';

async function runTask10Tests() {
  console.log('=== Starting Day 3 — Task 10 Monopoly Detector Tests ===');

  // Test 1: Check Condition 1: Market Dominance (marketShare >= 50%)
  console.log('Testing Condition 1: Market Dominance...');
  const teamsC1 = [
    {
      id: 'team_1',
      name: 'Đội A',
      teamNumber: 1,
      money: 10000,
      marketShare: 52.0, // Exceeds 50%
      technology: 10,
      reputation: 50,
      monopolyRisk: 20,
      status: 'playing',
    },
    {
      id: 'team_2',
      name: 'Đội B',
      teamNumber: 2,
      money: 10000,
      marketShare: 48.0,
      technology: 10,
      reputation: 50,
      monopolyRisk: 20,
      status: 'playing',
    },
  ];
  const resC1 = detectMonopoly(teamsC1);
  if (!resC1 || resC1.monopolyType !== 'MARKET_DOMINANCE' || resC1.dominantTeamId !== 'team_1') {
    throw new Error(`Market Dominance detection failed! Result: ${JSON.stringify(resC1)}`);
  }
  console.log('✅ Market Dominance triggers correctly.');

  // Test 2: Check Condition 2: Monopoly Risk Ceiling (monopolyRisk >= 80)
  console.log('Testing Condition 2: Monopoly Risk Ceiling...');
  const teamsC2 = [
    {
      id: 'team_1',
      name: 'Đội A',
      teamNumber: 1,
      money: 10000,
      marketShare: 20.0,
      technology: 10,
      reputation: 50,
      monopolyRisk: 85, // Exceeds 80
      status: 'playing',
    },
    {
      id: 'team_2',
      name: 'Đội B',
      teamNumber: 2,
      money: 10000,
      marketShare: 30.0,
      technology: 10,
      reputation: 50,
      monopolyRisk: 20,
      status: 'playing',
    },
  ];
  const resC2 = detectMonopoly(teamsC2);
  if (!resC2 || resC2.monopolyType !== 'MONOPOLY_RISK_CEILING' || resC2.dominantTeamId !== 'team_1') {
    throw new Error(`Monopoly Risk Ceiling detection failed! Result: ${JSON.stringify(resC2)}`);
  }
  console.log('✅ Monopoly Risk Ceiling triggers correctly.');

  // Test 3: Check Condition 3: Combined Dominance (marketShare >= 35% AND monopolyRisk >= 60)
  console.log('Testing Condition 3: Combined Dominance...');
  const teamsC3 = [
    {
      id: 'team_1',
      name: 'Đội A',
      teamNumber: 1,
      money: 10000,
      marketShare: 36.0, // Exceeds 35%
      technology: 10,
      reputation: 50,
      monopolyRisk: 62, // Exceeds 60
      status: 'playing',
    },
    {
      id: 'team_2',
      name: 'Đội B',
      teamNumber: 2,
      money: 10000,
      marketShare: 30.0,
      technology: 10,
      reputation: 50,
      monopolyRisk: 20,
      status: 'playing',
    },
  ];
  const resC3 = detectMonopoly(teamsC3);
  if (!resC3 || resC3.monopolyType !== 'COMBINED_DOMINANCE' || resC3.dominantTeamId !== 'team_1') {
    throw new Error(`Combined Dominance detection failed! Result: ${JSON.stringify(resC3)}`);
  }
  console.log('✅ Combined Dominance triggers correctly.');

  // Test 4: Check Condition 4: Relative Dominance (marketShare >= 3x the average of other teams)
  console.log('Testing Condition 4: Relative Dominance...');
  const teamsC4 = [
    {
      id: 'team_1',
      name: 'Đội A',
      teamNumber: 1,
      money: 10000,
      marketShare: 31.0, // average of others is (5+5)/2 = 5.0. 31 >= 3 * 5
      technology: 10,
      reputation: 50,
      monopolyRisk: 20,
      status: 'playing',
    },
    {
      id: 'team_2',
      name: 'Đội B',
      teamNumber: 2,
      money: 10000,
      marketShare: 5.0,
      technology: 10,
      reputation: 50,
      monopolyRisk: 20,
      status: 'playing',
    },
    {
      id: 'team_3',
      name: 'Đội C',
      teamNumber: 3,
      money: 10000,
      marketShare: 5.0,
      technology: 10,
      reputation: 50,
      monopolyRisk: 20,
      status: 'playing',
    },
  ];
  const resC4 = detectMonopoly(teamsC4);
  if (!resC4 || resC4.monopolyType !== 'RELATIVE_DOMINANCE' || resC4.dominantTeamId !== 'team_1') {
    throw new Error(`Relative Dominance detection failed! Result: ${JSON.stringify(resC4)}`);
  }
  console.log('✅ Relative Dominance triggers correctly.');

  // Test 5: Stable sorting selection/tie-breaking
  console.log('Testing stable sorting tie-breakers...');
  const tiedTeams = [
    {
      id: 'team_2',
      name: 'Đội B',
      teamNumber: 2, // Higher team number (lower priority in tie-breaker)
      money: 10000,
      marketShare: 55.0,
      technology: 10,
      reputation: 50,
      monopolyRisk: 20,
      status: 'playing',
    },
    {
      id: 'team_1',
      name: 'Đội A',
      teamNumber: 1, // Lower team number (higher priority in tie-breaker)
      money: 10000,
      marketShare: 55.0,
      technology: 10,
      reputation: 50,
      monopolyRisk: 20,
      status: 'playing',
    },
  ];
  const resTie = detectMonopoly(tiedTeams);
  if (!resTie || resTie.dominantTeamId !== 'team_1') {
    throw new Error(`Tie-breaker failed! Expected 'team_1', got: ${resTie?.dominantTeamId}`);
  }
  console.log('✅ Tie-breaker resolved stably (prioritizes team with lowest teamNumber).');

  // Test 6: Integration into GameEngine.processRound()
  console.log('Testing integration in GameEngine.processRound()...');
  const memDb = new Database(':memory:');
  memDb.exec(`
    CREATE TABLE game (
      id TEXT PRIMARY KEY,
      room_code TEXT UNIQUE,
      host_pin TEXT,
      status TEXT,
      current_round INTEGER,
      total_rounds INTEGER,
      round_duration_sec INTEGER,
      settings_json TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE team (
      id TEXT PRIMARY KEY,
      game_id TEXT,
      name TEXT,
      team_number INTEGER,
      money INTEGER,
      market_share REAL,
      technology INTEGER,
      reputation INTEGER,
      monopoly_risk INTEGER,
      total_score INTEGER,
      quiz_score INTEGER,
      status TEXT,
      created_at TEXT
    );
    CREATE TABLE round (
      id TEXT PRIMARY KEY,
      game_id TEXT,
      round_number INTEGER,
      phase TEXT,
      available_decisions_json TEXT,
      event_id TEXT,
      narration_text TEXT,
      started_at TEXT,
      ended_at TEXT
    );
    CREATE TABLE decision_log (
      id TEXT PRIMARY KEY,
      round_id TEXT,
      team_id TEXT,
      decision_type TEXT,
      decision_data_json TEXT,
      money_delta INTEGER,
      market_share_delta REAL,
      technology_delta INTEGER,
      reputation_delta INTEGER,
      monopoly_risk_delta INTEGER,
      score_earned INTEGER,
      created_at TEXT
    );
    CREATE TABLE round_event (
      id TEXT PRIMARY KEY,
      round_id TEXT,
      event_type TEXT,
      event_data_json TEXT,
      narration_text TEXT,
      created_at TEXT
    );
  `);

  const gameId = uuid();
  const roundId = uuid();
  const team1Id = uuid();
  const team2Id = uuid();

  memDb.prepare('INSERT INTO game (id, room_code, status, current_round, total_rounds, round_duration_sec) VALUES (?, ?, ?, ?, ?, ?)')
    .run(gameId, 'MONOPY', 'playing', 1, 8, 60);

  memDb.prepare('INSERT INTO round (id, game_id, round_number, phase, available_decisions_json) VALUES (?, ?, ?, ?, ?)')
    .run(roundId, gameId, 1, 'decision', '[]');

  // Team 1 starts with 60% market share (monopoly condition 1)
  memDb.prepare('INSERT INTO team (id, game_id, name, team_number, money, market_share, technology, reputation, monopoly_risk, total_score, quiz_score, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(team1Id, gameId, 'Đội A', 1, 10000, 60.0, 10, 50, 50, 0, 0, 'playing');

  memDb.prepare('INSERT INTO team (id, game_id, name, team_number, money, market_share, technology, reputation, monopoly_risk, total_score, quiz_score, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(team2Id, gameId, 'Đội B', 2, 10000, 20.0, 10, 50, 20, 0, 0, 'playing');

  const callbacks: GameEngineCallbacks = {
    onRoundStart: () => {},
    onRoundTick: () => {},
    onPhaseChange: () => {},
    onGameOver: () => {},
  };

  const engine = new ServerGameState(gameId, 'monopoly_test_seed', callbacks, memDb);
  engine.registerTeam({
    id: team1Id,
    name: 'Đội A',
    teamNumber: 1,
    money: 10000,
    marketShare: 60.0,
    technology: 10,
    reputation: 50,
    monopolyRisk: 50,
    status: 'playing',
  });
  engine.registerTeam({
    id: team2Id,
    name: 'Đội B',
    teamNumber: 2,
    money: 10000,
    marketShare: 20.0,
    technology: 10,
    reputation: 50,
    monopolyRisk: 20,
    status: 'playing',
  });

  engine.currentRound = 1;
  engine.phase = 'decision';
  engine.submitDecision(team1Id, 'invest_tech');
  engine.submitDecision(team2Id, 'invest_tech');

  // Verify that team stats are regulated correctly:
  // Team 1: starts at 60. With invest_tech +1% -> 61%.
  // Monopoly regulation applies: -10% market share reduction, -20 monopoly risk reduction.
  // Team 1 final marketShare should be 61 - 10 = 51% (or adjusted based on event/decision exactly).
  // Team 2: starts at 20. With invest_tech +1% -> 21%.
  // Monopoly regulation applies: +5% market share boost.
  // Team 2 final marketShare should be 21 + 5 = 26%.
  const finalT1 = engine.teams.get(team1Id)!;
  const finalT2 = engine.teams.get(team2Id)!;

  console.log('Final stats after round processing:');
  console.log(`Team 1: marketShare=${finalT1.marketShare}%, monopolyRisk=${finalT1.monopolyRisk}`);
  console.log(`Team 2: marketShare=${finalT2.marketShare}%, monopolyRisk=${finalT2.monopolyRisk}`);

  // Assertions
  // Check that Team 1 monopolyRisk is reduced by 20 (base 50 + 2 (from invest_tech) - 8 (from event: competitor) - 20 (regulation) = 24)
  if (finalT1.monopolyRisk !== 24) {
    throw new Error(`Expected Team 1 monopolyRisk to be 24, got: ${finalT1.monopolyRisk}`);
  }
  // Check that Team 2 received the +5% market share boost
  // For invest_tech, base MS gain is 1%. After scaling at MS 20%, it is still 1%.
  // Competitor event adds -2% MS.
  // Regulation adds +5% MS.
  // So Team 2: 20 + 1 (invest_tech) - 2 (event) + 5 (regulation) = 24%.
  if (finalT2.marketShare !== 24.0) {
    throw new Error(`Expected Team 2 marketShare to be 24.0%, got: ${finalT2.marketShare}`);
  }

  if (finalT1.marketShare >= 60.0) {
    throw new Error(`Team 1 marketShare was not reduced by monopoly regulator! MS: ${finalT1.marketShare}`);
  }
  if (finalT2.marketShare <= 20.0) {
    throw new Error(`Team 2 marketShare was not boosted by monopoly regulator! MS: ${finalT2.marketShare}`);
  }

  console.log('✅ Integration into GameEngine.processRound() verified successfully.');
  console.log('=== All Day 3 — Task 10 Monopoly Detector Tests Passed Successfully! ===');
}

runTask10Tests().catch((err) => {
  console.error('❌ Tests failed:', err);
  process.exit(1);
});
