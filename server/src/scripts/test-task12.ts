import { NarratorEngine } from '../narrator/narrator.engine.js';
import { loadTemplatesFile, selectTemplate, replaceVariables, getTemplatePath } from '../narrator/template.system.js';
import { ServerGameState, GameEngineCallbacks } from '../engine/game.engine.js';
import { SeededRNG } from '../utils/random.js';
import { v4 as uuid } from 'uuid';
import Database from 'better-sqlite3';

export class LocalTeamRepository {
  constructor(private db: Database.Database) {}
  findById(id: string) {
    const row = this.db.prepare('SELECT * FROM team WHERE id = ?').get(id) as any;
    return row ? { id: row.id, totalScore: row.total_score } : null;
  }
}

export class LocalRoundRepository {
  constructor(private db: Database.Database) {}
  findById(id: string) {
    const row = this.db.prepare('SELECT * FROM round WHERE id = ?').get(id) as any;
    return row ? { id: row.id, eventId: row.event_id, narrationText: row.narration_text } : null;
  }
}

async function runTask12Tests() {
  console.log('=== Starting Day 3 — Task 12 Narrator Engine Tests ===');

  const rng = new SeededRNG('narrator_test_seed');
  const narrator = new NarratorEngine();

  const mockTeam = {
    id: 'team_1',
    name: 'Đội Delta',
    teamNumber: 1,
    money: 10000,
    marketShare: 32.0,
    technology: 45,
    reputation: 60,
    monopolyRisk: 40,
    status: 'playing',
    totalScore: 100,
  };

  // Test 1: Generate Decision Narration
  console.log('Testing generateDecisionNarration()...');
  const decisionMsg = narrator.generateDecisionNarration(mockTeam, 'invest_tech', rng);
  console.log(`Generated: ${JSON.stringify(decisionMsg)}`);
  if (!decisionMsg.text.includes('Đội Delta') || !decisionMsg.text.includes('45')) {
    throw new Error(`Decision narration mapping failed: ${decisionMsg.text}`);
  }
  console.log('✅ generateDecisionNarration() verified.');

  // Test 2: Generate Event Narration
  console.log('Testing generateEventNarration()...');
  const eventMsg = narrator.generateEventNarration({
    type: 'crisis',
    titleVi: 'Khủng hoảng tài chính toàn cầu',
    descriptionVi: 'Kinh tế suy thoái'
  }, mockTeam, rng);
  console.log(`Generated: ${JSON.stringify(eventMsg)}`);
  if (!eventMsg.text.includes('Khủng hoảng tài chính toàn cầu')) {
    throw new Error(`Event narration mapping failed: ${eventMsg.text}`);
  }
  console.log('✅ generateEventNarration() verified.');

  // Test 3: Generate Monopoly Narration
  console.log('Testing generateMonopolyNarration()...');
  const monopolyMsg = narrator.generateMonopolyNarration({
    dominantTeamName: 'Đội Delta',
    monopolyType: 'MARKET_DOMINANCE',
    explanation: 'Chiếm giữ trên 50% thị phần'
  }, mockTeam, rng);
  console.log(`Generated: ${JSON.stringify(monopolyMsg)}`);
  if (!monopolyMsg.text.includes('Đội Delta') || !monopolyMsg.text.includes('32')) {
    throw new Error(`Monopoly narration mapping failed: ${monopolyMsg.text}`);
  }
  console.log('✅ generateMonopolyNarration() verified.');

  // Test 4: Generate Round Summary
  console.log('Testing generateRoundSummary()...');
  const summaryMsg = narrator.generateRoundSummary(3, rng);
  console.log(`Generated: ${JSON.stringify(summaryMsg)}`);
  if (!summaryMsg.text.includes('3')) {
    throw new Error(`Round summary mapping failed: ${summaryMsg.text}`);
  }
  console.log('✅ generateRoundSummary() verified.');

  // Test 5: Generate Educational Narration
  console.log('Testing generateEducationalNarration()...');
  const eduMsg = narrator.generateEducationalNarration('CAPITAL_CONCENTRATION', rng);
  console.log(`Generated: ${JSON.stringify(eduMsg)}`);
  if (!eduMsg || !eduMsg.text.includes('Tập trung tư bản')) {
    throw new Error(`Educational narration failed: ${eduMsg?.text}`);
  }
  console.log('✅ generateEducationalNarration() verified.');

  // Test 6: Verify Recency Constraint (Avoid Repetitive selection)
  console.log('Testing template recency constraint (avoid repetition)...');
  // Load summary templates: they contain sum_gen_001 and sum_gen_002
  const templates = loadTemplatesFile('round-summary.json')['general']!;
  const used: string[] = [];

  const rng2 = new SeededRNG('recency_test');
  const first = selectTemplate(templates, null, used, rng2);
  used.push(first.id);

  // When selecting again with 'first.id' marked as recently used, it MUST select the other template
  const second = selectTemplate(templates, null, used, rng2);
  if (first.id === second.id) {
    throw new Error(`Recency constraint failed: selected same template "${first.id}" despite being marked as used!`);
  }
  console.log(`Selected sequence: ${first.id} -> ${second.id}`);
  console.log('✅ Template recency constraint verified.');

  // Test 7: Integration in GameEngine.processRound()
  console.log('Testing integration in GameEngine.processRound()...');
  const memDb = new Database(':memory:');
  memDb.exec(`
    CREATE TABLE game (
      id TEXT PRIMARY KEY,
      room_code TEXT UNIQUE,
      status TEXT,
      current_round INTEGER,
      total_rounds INTEGER,
      round_duration_sec INTEGER
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
  const teamId = uuid();

  memDb.prepare('INSERT INTO game (id, room_code, status, current_round, total_rounds, round_duration_sec) VALUES (?, ?, ?, ?, ?, ?)')
    .run(gameId, 'NARRAT', 'playing', 1, 8, 60);

  memDb.prepare('INSERT INTO round (id, game_id, round_number, phase, available_decisions_json) VALUES (?, ?, ?, ?, ?)')
    .run(roundId, gameId, 1, 'decision', '[]');

  memDb.prepare('INSERT INTO team (id, game_id, name, team_number, money, market_share, technology, reputation, monopoly_risk, total_score, quiz_score, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(teamId, gameId, 'Đội Alpha', 1, 10000, 30.0, 10, 50, 20, 100, 0, 'playing');

  const callbacks: GameEngineCallbacks = {
    onRoundStart: () => {},
    onRoundTick: () => {},
    onPhaseChange: () => {},
    onGameOver: () => {},
  };

  const engine = new ServerGameState(gameId, 'narrator_test_seed_fixed', callbacks, memDb);
  engine.registerTeam({
    id: teamId,
    name: 'Đội Alpha',
    teamNumber: 1,
    money: 10000,
    marketShare: 30.0,
    technology: 10,
    reputation: 50,
    monopolyRisk: 20,
    status: 'playing',
    totalScore: 100,
  });

  engine.currentRound = 1;
  engine.phase = 'decision';
  engine.submitDecision(teamId, 'invest_tech');

  // Trigger processing
  engine.processRound();

  // Verify narrationText was persisted to DB in the round record
  const roundRepo = new LocalRoundRepository(memDb);
  const dbRound = roundRepo.findById(roundId)!;
  console.log(`Database saved narrationText: \n${dbRound.narrationText}`);
  if (!dbRound.narrationText || dbRound.narrationText.trim() === '') {
    throw new Error('Narration text was not saved to round record in database!');
  }
  if (!dbRound.narrationText.includes('Đội Alpha')) {
    throw new Error(`Narration text did not contain expected team name! Got: ${dbRound.narrationText}`);
  }

  console.log('✅ Integration into GameEngine.processRound() and narration database persistence verified.');
  console.log('=== All Day 3 — Task 12 Narrator Engine Tests Passed Successfully! ===');
}

runTask12Tests().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
