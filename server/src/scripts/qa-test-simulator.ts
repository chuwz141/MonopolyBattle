import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { io as ServerIo } from '../socket/index.js';
import { io as ClientIo } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { initDatabase, getDatabase } from '../config/database.js';
import { SOCKET_EVENTS } from '@monopoly/shared';
import { GameRepository } from '../repositories/game.repository.js';
import { TeamRepository } from '../repositories/team.repository.js';
import { PlayerRepository } from '../repositories/player.repository.js';
import { GameService } from '../services/game.service.js';
import { TeamService } from '../services/team.service.js';
import { GameController } from '../controllers/game.controller.js';
import { AuthController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

async function runQaSimulation() {
  console.log('===========================================================');
  console.log('🚀 Day 6 — Task 23: E2E QA Simulation Starting');
  console.log('===========================================================');

  // Initialize DB & clear existing tables
  const db = initDatabase();
  db.exec(`
    DELETE FROM quiz_answer;
    DELETE FROM round_event;
    DELETE FROM decision_log;
    DELETE FROM player;
    DELETE FROM team;
    DELETE FROM round;
    DELETE FROM game;
  `);
  console.log('🧹 Test database initialized and cleared.');

  // Set up Express server for API endpoints
  const app = express();
  app.use(cors());
  app.use(express.json());

  const teamRepo = new TeamRepository(db);
  const playerRepo = new PlayerRepository(db);
  const gameRepo = new GameRepository(db);
  const teamService = new TeamService(teamRepo, playerRepo);
  const gameService = new GameService(gameRepo, teamRepo, playerRepo, teamService);
  const gameController = new GameController(gameService, teamService, playerRepo);
  const authController = new AuthController(gameService);

  app.post('/api/auth/join', authController.join);
  app.post('/api/games', requireAuth, gameController.create);
  app.get('/api/games/:id', requireAuth, gameController.getGame);
  app.get('/api/games/:id/results', requireAuth, gameController.getResults);

  const httpServer = createServer(app);
  ServerIo.attach(httpServer);

  const TEST_PORT = 5003;
  await new Promise<void>((resolve) => {
    httpServer.listen(TEST_PORT, () => resolve());
  });
  console.log(`📡 QA Test Server listening on port ${TEST_PORT}`);

  // Test variables
  let gameId = '';
  let roomCode = '';
  let hostToken = '';
  const teamTokens: string[] = [];
  const teamIds: string[] = [];
  const teamNames = ['Alpha Team', 'Beta Team', 'Gamma Team'];

  // Test 1: Create Game via REST API
  console.log('\n--- 1. Creating Game session via REST API ---');
  const hostPreToken = jwt.sign({ userId: 'host', role: 'host', gameId: '' }, config.JWT_SECRET);
  const createResponse = await fetch(`http://localhost:${TEST_PORT}/api/games`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${hostPreToken}`
    },
    body: JSON.stringify({
      totalRounds: 8,
      roundDurationSec: 60,
      quizEnabled: true
    })
  });

  const createData = await createResponse.json() as any;
  if (!createData.success) {
    throw new Error(`Failed to create game: ${JSON.stringify(createData)}`);
  }
  gameId = createData.game.id;
  roomCode = createData.game.roomCode;
  hostToken = createData.token;
  console.log(`✅ Game created successfully. ID: ${gameId}, Room Code: ${roomCode}`);

  // Test 2: Join 3 Team Clients via REST API
  console.log('\n--- 2. Joining 3 Teams via API ---');
  const teamJoinPayloads = teamNames.map((name) => ({
    roomCode,
    teamName: name,
    playerName: `${name} Captain`
  }));

  const authJoin = async (payload: typeof teamJoinPayloads[0]) => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json() as any;
  };

  for (const payload of teamJoinPayloads) {
    const data = await authJoin(payload);
    if (!data.success) {
      throw new Error(`Team failed to join: ${JSON.stringify(data)}`);
    }
    teamTokens.push(data.token);
    teamIds.push(data.team.id);
    console.log(`✅ Team "${payload.teamName}" joined. ID: ${data.team.id}`);
  }

  // Connect sockets
  console.log('\n--- 3. Connecting Websockets (1 Host, 1 Projector, 3 Teams) ---');
  const hostSocket = ClientIo(`http://localhost:${TEST_PORT}`, {
    auth: { token: hostToken },
    transports: ['websocket']
  });

  const projectorSocket = ClientIo(`http://localhost:${TEST_PORT}`, {
    auth: { role: 'projector', roomCode },
    transports: ['websocket']
  });

  const teamSockets = teamTokens.map((token) => {
    return ClientIo(`http://localhost:${TEST_PORT}`, {
      auth: { token },
      transports: ['websocket']
    });
  });

  // Verify all connected
  await new Promise<void>((resolve, reject) => {
    let connectCount = 0;
    const checkConnect = () => {
      connectCount++;
      if (connectCount === 5) resolve();
    };
    hostSocket.on('connect', checkConnect);
    projectorSocket.on('connect', checkConnect);
    teamSockets.forEach((s) => s.on('connect', checkConnect));
    setTimeout(() => reject(new Error('Websockets timed out connecting')), 5000);
  });
  console.log('✅ All 5 websockets connected successfully.');

  // Join projector to game room code
  projectorSocket.emit(SOCKET_EVENTS.PROJECTOR_JOIN, { roomCode });

  // Handle player ready updates
  console.log('\n--- 4. Marking all teams as READY ---');
  let readyEventCount = 0;
  await new Promise<void>((resolve, reject) => {
    hostSocket.on(SOCKET_EVENTS.TEAM_READY, (data: any) => {
      readyEventCount++;
      if (readyEventCount === 3) resolve();
    });
    teamSockets.forEach((s) => s.emit(SOCKET_EVENTS.PLAYER_READY));
    setTimeout(() => reject(new Error('Ready events timed out')), 5000);
  });
  console.log('✅ All teams marked as ready. Broadcast received by Host.');

  // Host starts the game
  console.log('\n--- 5. Host starting the game ---');
  let currentRoundNumber = 0;
  let activePhase: any = 'lobby';
  let activeQuizQuestion: any = null;
  let quizCount = 0;
  let eventsTriggered: string[] = [];
  let narrationsReceived: string[] = [];
  let monopolyDetectedCount = 0;

  let activeRoundNumber = 0;

  // Track projector phase changes & state updates
  projectorSocket.on(SOCKET_EVENTS.GAME_PHASE_CHANGE, (data: any) => {
    activePhase = data.phase;
    if (data.roundNumber !== undefined) {
      activeRoundNumber = data.roundNumber;
    }
    console.log(`[Projector View] Phase changed to: ${data.phase} (Round ${activeRoundNumber})`);
  });

  projectorSocket.on(SOCKET_EVENTS.ROUND_START, (data: any) => {
    activePhase = 'decision';
    if (data.roundNumber !== undefined) {
      activeRoundNumber = data.roundNumber;
    }
    console.log(`[Projector View] Round Started! Round: ${activeRoundNumber}. Phase changed to decision.`);
  });

  projectorSocket.on(SOCKET_EVENTS.QUIZ_START, (data: any) => {
    activeQuizQuestion = data;
    quizCount++;
    console.log(`[Projector View] 🎓 Quiz Started! Round: ${activeRoundNumber}. Question: ${data.question.substring(0, 50)}...`);
  });

  projectorSocket.on(SOCKET_EVENTS.EVENT_TRIGGERED, (data: any) => {
    eventsTriggered.push(data.eventType);
    console.log(`[Projector View] 🚨 Event triggered: ${data.title}`);
  });

  projectorSocket.on(SOCKET_EVENTS.NARRATOR_MESSAGE, (data: any) => {
    narrationsReceived.push(data.text);
    console.log(`[Projector View] 🎙️ Narration: ${data.text}`);
  });

  projectorSocket.on(SOCKET_EVENTS.MONOPOLY_DETECTED, (data: any) => {
    monopolyDetectedCount++;
    console.log(`[Projector View] ⚠️ Monopoly Detected: ${data.teamName} - ${data.explanation}`);
  });

  // Start E2E rounds loop
  hostSocket.emit(SOCKET_EVENTS.HOST_START_GAME);

  // Play through 8 rounds
  for (let r = 1; r <= 8; r++) {
    currentRoundNumber = r;
    console.log(`\n--- 🚀 ROUND ${r} START ---`);

    // Wait until we transition to decision phase of the target round
    await new Promise<void>((resolve) => {
      const check = () => {
        if (activePhase === 'decision' && activeRoundNumber === r) resolve();
        else setTimeout(check, 100);
      };
      check();
    });

    // Add a short delay to ensure server database state is fully settled and cached
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    // 1. Submit decisions from all 3 teams
    console.log(`Round ${r}: Submitting decisions for all teams...`);
    
    // To trigger high monopoly risk (for monopoly detection testing), Alpha team will always choose 'acquire' (adds +20 monopoly risk)
    // Beta will expand factories, Gamma will invest in tech
    teamSockets[0]!.emit(SOCKET_EVENTS.PLAYER_DECISION, { roundId: 'current', decisionType: 'acquire' });
    teamSockets[1]!.emit(SOCKET_EVENTS.PLAYER_DECISION, { roundId: 'current', decisionType: 'expand_factories' });
    teamSockets[2]!.emit(SOCKET_EVENTS.PLAYER_DECISION, { roundId: 'current', decisionType: 'invest_tech' });

    // Wait for game phase to advance to event
    await new Promise<void>((resolve) => {
      const check = () => {
        if (activePhase === 'event') resolve();
        else setTimeout(check, 100);
      };
      check();
    });
    console.log(`Round ${r}: Phase successfully transitioned to "event".`);

    // Host manually advances past event
    hostSocket.emit(SOCKET_EVENTS.HOST_NEXT_PHASE);

    // Wait for narration phase
    await new Promise<void>((resolve) => {
      const check = () => {
        if (activePhase === 'narration') resolve();
        else setTimeout(check, 100);
      };
      check();
    });
    console.log(`Round ${r}: Phase successfully transitioned to "narration".`);

    // Host advances narration phase
    hostSocket.emit(SOCKET_EVENTS.HOST_NEXT_PHASE);

    // Wait for quiz phase (only if Round 3, 5, or 7)
    const expectsQuiz = (r === 3 || r === 5 || r === 7);
    if (expectsQuiz) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (activePhase === 'quiz' && activeQuizQuestion) resolve();
          else setTimeout(check, 100);
        };
        check();
      });
      console.log(`Round ${r}: Quiz correctly triggered in Round ${r}!`);

      // Submit quiz answers (Alpha correct (option 0), Beta & Gamma incorrect)
      teamSockets[0]!.emit(SOCKET_EVENTS.PLAYER_QUIZ_ANSWER, {
        questionId: 'current',
        selectedOption: 0,
        timeTakenMs: 4000
      });
      teamSockets[1]!.emit(SOCKET_EVENTS.PLAYER_QUIZ_ANSWER, {
        questionId: 'current',
        selectedOption: 1,
        timeTakenMs: 6000
      });
      teamSockets[2]!.emit(SOCKET_EVENTS.PLAYER_QUIZ_ANSWER, {
        questionId: 'current',
        selectedOption: 2,
        timeTakenMs: 5000
      });

      // Let the engine finalize the quiz automatically since all teams answered
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
    } else {
      // For non-quiz rounds, check that quiz phase was NOT entered
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      if (activePhase === 'quiz') {
        throw new Error(`Round ${r} entered quiz phase but should not have!`);
      }
      console.log(`Round ${r}: Quiz correctly skipped.`);
    }

    // Wait for results phase
    await new Promise<void>((resolve) => {
      const check = () => {
        if (activePhase === 'results' || activePhase === 'finished') resolve();
        else setTimeout(check, 100);
      };
      check();
    });
    console.log(`Round ${r}: Phase successfully transitioned to "results".`);

    // Host starts next round
    hostSocket.emit(SOCKET_EVENTS.HOST_NEXT_PHASE);
  }

  // Wait for game over phase
  console.log('\n--- 6. Verifying Game Over ---');
  await new Promise<void>((resolve) => {
    const check = () => {
      if (activePhase === 'finished') resolve();
      else setTimeout(check, 100);
    };
    check();
  });
  console.log('✅ Game correctly transitioned to "finished" phase after Round 8.');

  // Test 7: Verify final results endpoint
  console.log('\n--- 7. Fetching results via REST API ---');
  const resultsResponse = await fetch(`http://localhost:${TEST_PORT}/api/games/${gameId}/results`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${hostToken}`
    }
  });

  const resultsData = await resultsResponse.json() as any;
  if (!resultsData.success) {
    throw new Error(`Failed to retrieve results: ${JSON.stringify(resultsData)}`);
  }

  console.log('✅ API results successfully retrieved.');
  console.log(`Total Teams in Leaderboard: ${resultsData.leaderboard.length}`);
  console.log(`Rounds Played: ${resultsData.statistics.roundsPlayed}`);
  console.log(`Average score: ${resultsData.statistics.avgScore}`);
  console.log(`Quiz accuracy: ${resultsData.statistics.quizAccuracyPercent}%`);

  if (resultsData.educationalSummary) {
    console.log('--- Educational Summary ---');
    console.log(`Concepts Covered: ${resultsData.educationalSummary.conceptsCovered.join(', ')}`);
    console.log(`Highlights:`);
    resultsData.educationalSummary.highlights.forEach((h: string) => console.log(`  - ${h}`));
  } else {
    console.log('⚠️ Warning: educationalSummary is null!');
  }

  // Cleanup
  console.log('\n--- 8. Cleaning up websocket connections & server ---');
  hostSocket.disconnect();
  projectorSocket.disconnect();
  teamSockets.forEach((s) => s.disconnect());
  
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
  console.log('✅ Server stopped successfully.');

  console.log('\n===========================================================');
  console.log('🎉 Day 6 — Task 23 E2E QA Simulation Finished Successfully!');
  console.log('===========================================================');
  console.log('RESULTS DETAILS:');
  console.log(`- Quiz count expected: 3, actual: ${quizCount}`);
  console.log(`- Monopoly detections expected: >0, actual: ${monopolyDetectedCount}`);
  console.log(`- Total events triggered: ${eventsTriggered.length}`);
  console.log(`- Narrations received: ${narrationsReceived.length}`);
  console.log('===========================================================');
}

runQaSimulation().catch((err) => {
  console.error('❌ E2E QA simulation failed with error:', err);
  process.exit(1);
});
