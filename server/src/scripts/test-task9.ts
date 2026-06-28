import { ServerGameState, GameEngineCallbacks } from '../engine/game.engine.js';
import { maybeGenerateEvent, applyEvent, eventPool } from '../engine/event.engine.js';
import { SeededRNG } from '../utils/random.js';
import { LeaderboardEntry } from '@monopoly/shared';
import { v4 as uuid } from 'uuid';
import Database from 'better-sqlite3';
import { RoundEventRepository } from '../repositories/round-event.repository.js';
import { RoundRepository } from '../repositories/round.repository.js';

async function runTask9Tests() {
  console.log('=== Starting Day 3 — Task 9 Event Engine Tests ===');

  // Test 1: Event pool contains all 9 events defined in architecture.md
  console.log(`Event pool size: ${eventPool.length} (Expected: 9)`);
  if (eventPool.length !== 9) {
    throw new Error(`Expected event pool to have 9 events, got ${eventPool.length}`);
  }
  console.log('✅ Event pool has exactly 9 events.');

  // Test 2: maybeGenerateEvent probability and determinism
  const iterations = 1000;
  let triggerCount = 0;
  const seed = 'test_event_engine_seed_12345';
  
  // Ensure that with the same seed, the sequence is identical (determinism)
  const rng1 = new SeededRNG(seed);
  const rng2 = new SeededRNG(seed);
  
  for (let i = 0; i < iterations; i++) {
    const ev1 = maybeGenerateEvent(i, rng1);
    const ev2 = maybeGenerateEvent(i, rng2);
    
    if (ev1?.id !== ev2?.id) {
      throw new Error(`maybeGenerateEvent is not deterministic! Difference at index ${i}`);
    }
    
    if (ev1 !== null) {
      triggerCount++;
    }
  }
  
  const actualRatio = triggerCount / iterations;
  console.log(`Trigger ratio over ${iterations} runs: ${(actualRatio * 100).toFixed(1)}% (Expected: ~60%)`);
  if (actualRatio < 0.55 || actualRatio > 0.65) {
    throw new Error(`Trigger ratio ${actualRatio} is outside the expected 60% probability bound`);
  }
  console.log('✅ Trigger probability and determinism verified.');

  // Test 3: Event Target resolution & tie-breakers
  const mockTeams = [
    {
      id: 'team_1',
      name: 'Đội A',
      teamNumber: 1,
      money: 8000,
      marketShare: 30.0,
      technology: 10,
      reputation: 50,
      monopolyRisk: 10,
      status: 'playing',
    },
    {
      id: 'team_2',
      name: 'Đội B',
      teamNumber: 2,
      money: 12000, // Richest
      marketShare: 40.0, // Highest market share
      technology: 20,
      reputation: 50,
      monopolyRisk: 40, // Highest monopoly risk
      status: 'playing',
    },
    {
      id: 'team_3',
      name: 'Đội C',
      teamNumber: 3,
      money: 5000, // Weakest
      marketShare: 10.0, // Lowest market share
      technology: 5,
      reputation: 20, // Lowest reputation
      monopolyRisk: 5,
      status: 'playing',
    },
  ];

  // Apply Gov Inspection (targets highest monopoly risk -> team_2)
  const inspectionEvent = eventPool.find(e => e.id === 'inspection')!;
  const inspectionGameEvent = {
    id: inspectionEvent.id,
    type: inspectionEvent.id,
    titleVi: inspectionEvent.title,
    descriptionVi: inspectionEvent.description,
    effects: inspectionEvent.effects,
    scope: 'specific' as const,
  };

  const inspectionDeltas = applyEvent(inspectionGameEvent, mockTeams);
  const t2Delta = inspectionDeltas.get('team_2');
  const t1Delta = inspectionDeltas.get('team_1');

  if (!t2Delta || t2Delta.money !== -3000 || t2Delta.marketShare !== -5.0 || t2Delta.reputation !== -10 || t2Delta.monopolyRisk !== -15) {
    throw new Error('Gov Inspection did not target or apply correct effects to the top monopoly risk team (team_2)');
  }
  if (!t1Delta || t1Delta.money !== 0 || t1Delta.marketShare !== 0) {
    throw new Error('Gov Inspection modified stats of non-targeted team (team_1)');
  }
  console.log('✅ Event targeting (highest_monopoly_risk) and effects applied successfully.');

  // Apply Consumer Boycott (targets lowest reputation -> team_3)
  const boycottEvent = eventPool.find(e => e.id === 'boycott')!;
  const boycottGameEvent = {
    id: boycottEvent.id,
    type: boycottEvent.id,
    titleVi: boycottEvent.title,
    descriptionVi: boycottEvent.description,
    effects: boycottEvent.effects,
    scope: 'specific' as const,
  };
  const boycottDeltas = applyEvent(boycottGameEvent, mockTeams);
  const t3BoycottDelta = boycottDeltas.get('team_3');
  if (!t3BoycottDelta || t3BoycottDelta.money !== -1000 || t3BoycottDelta.reputation !== -15) {
    throw new Error('Consumer Boycott did not target or apply correct effects to lowest reputation team (team_3)');
  }
  console.log('✅ Event targeting (lowest_reputation) applied successfully.');

  // Test 4: Stable Sorting Tie Breakers
  // Create tie for richest (team 1 and team 2 have 12000). Team 1 has teamNumber 1, Team 2 has teamNumber 2.
  const tiedTeams = [
    { ...mockTeams[0]!, money: 12000 },
    { ...mockTeams[1]!, money: 12000 },
  ];
  // Apply richest_team targeting (should choose team_1 because teamNumber 1 < 2)
  const richestEvent = {
    id: 'test_richest',
    type: 'test_richest',
    titleVi: 'Test Richest',
    descriptionVi: 'Test',
    effects: { money: -500, marketShare: 0, technology: 0, reputation: 0, monopolyRisk: 0 },
    scope: 'specific' as const,
  };
  // Inject mock event pool item to simulate resolution
  eventPool.push({
    id: 'test_richest',
    title: 'Test Richest',
    description: 'Test',
    targetType: 'richest_team',
    effects: { money: -500, marketShare: 0, technology: 0, reputation: 0, monopolyRisk: 0 },
    narrationKey: 'test',
    probability: 0,
  });

  const richestDeltas = applyEvent(richestEvent, tiedTeams);
  const t1Richest = richestDeltas.get('team_1');
  const t2Richest = richestDeltas.get('team_2');

  if (!t1Richest || t1Richest.money !== -500) {
    throw new Error('Stable sorting tie-breaker failed to select team_1 (lower teamNumber)');
  }
  if (!t2Richest || t2Richest.money !== 0) {
    throw new Error('Stable sorting tie-breaker incorrectly applied effects to team_2');
  }
  console.log('✅ Tie-breakers resolved deterministically using stable sorting.');

  // Test 5: GameEngine Integration and DB Persistence
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
  const teamId1 = uuid();
  const teamId2 = uuid();

  // Populate mock database
  memDb.prepare('INSERT INTO game (id, room_code, status, current_round, total_rounds, round_duration_sec) VALUES (?, ?, ?, ?, ?, ?)')
    .run(gameId, 'ABCDEF', 'playing', 1, 8, 60);

  memDb.prepare('INSERT INTO round (id, game_id, round_number, phase, available_decisions_json) VALUES (?, ?, ?, ?, ?)')
    .run(roundId, gameId, 1, 'decision', '[]');

  memDb.prepare('INSERT INTO team (id, game_id, name, team_number, money, market_share, technology, reputation, monopoly_risk, total_score, quiz_score, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(teamId1, gameId, 'Đội Alpha', 1, 10000, 30.0, 10, 50, 20, 0, 0, 'playing');

  memDb.prepare('INSERT INTO team (id, game_id, name, team_number, money, market_share, technology, reputation, monopoly_risk, total_score, quiz_score, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(teamId2, gameId, 'Đội Beta', 2, 10000, 30.0, 10, 50, 20, 0, 0, 'playing');

  // Test callbacks
  const callbacks: GameEngineCallbacks = {
    onRoundStart: () => {},
    onRoundTick: () => {},
    onPhaseChange: () => {},
    onGameOver: () => {},
  };

  // Construct engine using in-memory db
  const engine = new ServerGameState(gameId, 'fixed_event_seed_test', callbacks, memDb);
  engine.registerTeam({
    id: teamId1,
    name: 'Đội Alpha',
    teamNumber: 1,
    money: 10000,
    marketShare: 30.0,
    technology: 10,
    reputation: 50,
    monopolyRisk: 20,
    status: 'playing',
  });
  engine.registerTeam({
    id: teamId2,
    name: 'Đội Beta',
    teamNumber: 2,
    money: 10000,
    marketShare: 30.0,
    technology: 10,
    reputation: 50,
    monopolyRisk: 20,
    status: 'playing',
  });

  engine.currentRound = 1;
  engine.phase = 'decision';
  engine.submitDecision(teamId1, 'invest_tech');
  engine.submitDecision(teamId2, 'invest_tech');

  // After processing:
  // 1. A random event should be determined using the seed 'fixed_event_seed_test_round_1_event'
  // Let's verify what event is expected for this seed and round 1:
  const testRng = new SeededRNG('fixed_event_seed_test_round_1_event');
  const expectedEvent = maybeGenerateEvent(1, testRng);
  
  console.log(`Expected event for test seed: ${expectedEvent ? expectedEvent.titleVi : 'None'}`);

  // Engine processRound should apply the decision effects + event effects
  // Decision (invest_tech): cost -2000, +15 tech, +5 reputation, +2 monopoly_risk, +1% market share (scaled)
  // If event triggers, its effects are also added.
  
  // Verify Database contains the event log
  const roundEventRepo = new RoundEventRepository(memDb);
  const roundRepo = new RoundRepository(memDb);

  const updatedRound = roundRepo.findByGameIdAndRoundNumber(gameId, 1);
  if (expectedEvent) {
    if (updatedRound?.eventId !== expectedEvent.id) {
      throw new Error(`Round eventId mismatch. Got ${updatedRound?.eventId}, expected ${expectedEvent.id}`);
    }

    const savedEvent = roundEventRepo.findByRoundId(roundId);
    if (!savedEvent) {
      throw new Error('Event triggered but no record saved in round_event table!');
    }
    console.log(`✅ Saved round_event successfully: type=${savedEvent.eventType}, narration=${savedEvent.narrationText}`);
  } else {
    console.log('✅ No event triggered for this seed, DB eventId remains null.');
  }

  console.log('=== All Day 3 — Task 9 Event Engine Tests Passed Successfully! ===');
}

runTask9Tests().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
