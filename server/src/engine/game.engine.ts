import { Decision, GamePhase, LeaderboardEntry, SOCKET_EVENTS, GameEvent } from '@monopoly/shared';
import { v4 as uuid } from 'uuid';
import { getDatabase } from '../config/database.js';
import { GameRepository } from '../repositories/game.repository.js';
import { TeamRepository } from '../repositories/team.repository.js';
import { RoundRepository } from '../repositories/round.repository.js';
import { DecisionLogRepository } from '../repositories/decision-log.repository.js';
import { RoundEventRepository } from '../repositories/round-event.repository.js';
import { DecisionEngine, BASE_EFFECTS, DECISION_TYPES, DecisionType, StatsDelta } from './decision.engine.js';
import { SeededRNG } from '../utils/random.js';
import { logger } from '../utils/logger.js';
import { maybeGenerateEvent, applyEvent } from './event.engine.js';
import { emitToRoom } from '../socket/index.js';
import { check as detectMonopoly } from './monopoly-detector.js';

export interface GameEngineCallbacks {
  onRoundStart: (roundNumber: number, decisions: Decision[], duration: number) => void;
  onRoundTick: (secondsLeft: number) => void;
  onPhaseChange: (phase: GamePhase, roundNumber: number, data?: any) => void;
  onGameOver: (leaderboard: LeaderboardEntry[]) => void;
}

export interface InMemoryTeamState {
  id: string;
  name: string;
  teamNumber: number;
  money: number;
  marketShare: number;
  technology: number;
  reputation: number;
  monopolyRisk: number;
  status: string;
}

export class ServerGameState {
  public readonly gameId: string;
  public phase: GamePhase;
  public currentRound: number;
  public teams: Map<string, InMemoryTeamState>;
  public availableDecisions: Decision[];
  public submittedDecisions: Map<string, string>; // teamId -> decisionType
  public currentEvent: GameEvent | null; // Reserved for future event engine integration
  public seed: string;

  private roundTimer: NodeJS.Timeout | null = null;
  private secondsLeft = 0;
  private callbacks: GameEngineCallbacks;
  private db: any; // Optional injected database connection

  constructor(
    gameId: string,
    seed: string,
    callbacks: GameEngineCallbacks,
    db?: any
  ) {
    this.gameId = gameId;
    this.seed = seed;
    this.phase = 'lobby';
    this.currentRound = 0;
    this.teams = new Map();
    this.availableDecisions = [];
    this.submittedDecisions = new Map();
    this.currentEvent = null;
    this.callbacks = callbacks;
    this.db = db || null;
  }

  /**
   * Registers a team into the in-memory engine state manager.
   */
  public registerTeam(team: InMemoryTeamState): void {
    this.teams.set(team.id, { ...team });
  }

  /**
   * Starts a round, generating available decisions, initiating the 60-second timer,
   * and notifying client sockets of ticks every 5 seconds.
   */
  public startRound(roundNumber: number): void {
    // 1. Stop any running round timer
    this.stopTimer();

    this.currentRound = roundNumber;
    this.phase = 'decision';
    this.submittedDecisions.clear();

    // 2. Generate available decisions deterministically using the round seed
    const rng = new SeededRNG(`${this.seed}_round_${roundNumber}`);
    let allowedTypes = (Object.keys(BASE_EFFECTS) as DecisionType[]).filter((type) => {
      if ((type === DECISION_TYPES.LOBBY_GOVERNMENT || type === DECISION_TYPES.ACCEPT_GOV_SUPPORT) && roundNumber < 3) {
        return false;
      }
      return true;
    });
    allowedTypes = rng.shuffle(allowedTypes);

    // Form 5 globally available candidates for the round
    const roundCandidates = allowedTypes.slice(0, 5).map((type) => {
      const base = BASE_EFFECTS[type];
      return {
        id: `dec_${type}_r${roundNumber}`,
        type,
        nameVi: base.nameVi,
        descriptionVi: base.descriptionVi,
        cost: base.cost,
        effects: {
          money: base.money,
          marketShare: base.marketShare,
          technology: base.technology,
          reputation: base.reputation,
          monopolyRisk: base.monopolyRisk,
        },
      };
    });
    this.availableDecisions = roundCandidates;

    logger.info({ gameId: this.gameId, roundNumber }, 'Round started successfully in Game Engine.');

    // 3. Invoke callbacks
    const duration = 60; // 60-second round duration
    this.callbacks.onRoundStart(roundNumber, roundCandidates, duration);

    // 4. Start timer lifecycle
    this.secondsLeft = duration;
    this.roundTimer = setInterval(() => {
      this.secondsLeft -= 5;
      if (this.secondsLeft > 0) {
        this.callbacks.onRoundTick(this.secondsLeft);
      } else {
        this.stopTimer();
        logger.info({ gameId: this.gameId, roundNumber }, 'Round timer expired. Auto-processing round.');
        this.processRound();
      }
    }, 5000);
  }

  /**
   * Submit decision for a specific team. Triggers early processing if all active teams have submitted.
   */
  public submitDecision(teamId: string, decisionType: string): void {
    if (this.phase !== 'decision') {
      throw new Error('Hiện tại không ở trong giai đoạn đưa ra quyết định.');
    }

    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Không tìm thấy đội chơi: ${teamId}`);
    }

    this.submittedDecisions.set(teamId, decisionType);
    logger.info({ gameId: this.gameId, teamId, decisionType }, 'Decision registered in Game Engine.');

    // Check if everyone submitted
    const activeTeams = Array.from(this.teams.values()).filter(
      (t) => t.status === 'playing' || t.status === 'ready'
    );

    if (this.submittedDecisions.size === activeTeams.length && activeTeams.length > 0) {
      logger.info({ gameId: this.gameId }, 'All active teams submitted. Clearing timer and starting early processing.');
      this.stopTimer();
      this.processRound();
    }
  }

  /**
   * Applies the selected business decisions, updates in-memory states,
   * synchronizes to SQLite database records, and triggers advancePhase.
   */
  public processRound(): void {
    const decisionEngine = new DecisionEngine();
    const results = new Map<string, StatsDelta>();

    // 1. Calculate and update deltas for all teams
    const activeTeams = Array.from(this.teams.values()).filter(
      (t) => t.status === 'playing' || t.status === 'ready'
    );

    for (const team of activeTeams) {
      const choice = this.submittedDecisions.get(team.id);
      let delta: StatsDelta;

      if (choice) {
        delta = decisionEngine.applyDecision(team, choice, {
          roundNumber: this.currentRound,
          activeEvent: this.currentEvent,
        });
      } else {
        // Zero change fallback if a team timed out
        delta = { money: 0, marketShare: 0, technology: 0, reputation: 0, monopolyRisk: 0 };
      }

      results.set(team.id, delta);

      // Clamp stats inside database bounds (0-100 for percentage items)
      team.money = Math.max(0, team.money + delta.money);
      team.marketShare = Math.min(100, Math.max(0, Number((team.marketShare + delta.marketShare).toFixed(1))));
      team.technology = Math.min(100, Math.max(0, team.technology + delta.technology));
      team.reputation = Math.min(100, Math.max(0, team.reputation + delta.reputation));
      team.monopolyRisk = Math.min(100, Math.max(0, team.monopolyRisk + delta.monopolyRisk));
    }

    // 1.1 Generate and apply random event
    const eventRng = new SeededRNG(`${this.seed}_round_${this.currentRound}_event`);
    const triggeredEvent = maybeGenerateEvent(this.currentRound, eventRng);

    this.currentEvent = triggeredEvent;

    if (triggeredEvent) {
      const eventDeltas = applyEvent(triggeredEvent, activeTeams, eventRng);

      for (const team of activeTeams) {
        const eDelta = eventDeltas.get(team.id);
        if (eDelta) {
          team.money = Math.max(0, team.money + eDelta.money);
          team.marketShare = Math.min(100, Math.max(0, Number((team.marketShare + eDelta.marketShare).toFixed(1))));
          team.technology = Math.min(100, Math.max(0, team.technology + eDelta.technology));
          team.reputation = Math.min(100, Math.max(0, team.reputation + eDelta.reputation));
          team.monopolyRisk = Math.min(100, Math.max(0, team.monopolyRisk + eDelta.monopolyRisk));
        }
      }

      // Broadcast event:triggered to all clients in the game room
      try {
        emitToRoom(`room:${this.gameId}`, SOCKET_EVENTS.EVENT_TRIGGERED, {
          eventType: triggeredEvent.type,
          title: triggeredEvent.titleVi,
          description: triggeredEvent.descriptionVi,
          effects: triggeredEvent.effects,
        });
      } catch (err) {
        logger.error({ gameId: this.gameId, err }, 'Failed to broadcast event:triggered socket event.');
      }
    }

    // 1.2 Run Monopoly Detector
    const monopolyResult = detectMonopoly(activeTeams);
    if (monopolyResult) {
      logger.info(
        { gameId: this.gameId, dominantTeamId: monopolyResult.dominantTeamId, monopolyType: monopolyResult.monopolyType },
        'Monopoly detected! Applying antitrust regulation interventions.'
      );

      for (const team of activeTeams) {
        if (team.id === monopolyResult.dominantTeamId) {
          team.monopolyRisk = Math.max(0, team.monopolyRisk - monopolyResult.intervention.monopolyRiskReduction);
          team.marketShare = Math.min(100, Math.max(0, Number((team.marketShare - monopolyResult.intervention.marketShareReduction).toFixed(1))));
        } else {
          team.marketShare = Math.min(100, Math.max(0, Number((team.marketShare + monopolyResult.intervention.otherTeamsMarketShareBoost).toFixed(1))));
        }
      }

      // Broadcast monopoly:detected to all clients in the game room
      try {
        emitToRoom(`room:${this.gameId}`, SOCKET_EVENTS.MONOPOLY_DETECTED, {
          teamId: monopolyResult.dominantTeamId,
          teamName: monopolyResult.dominantTeamName,
          explanation: monopolyResult.explanation,
        });
      } catch (err) {
        logger.error({ gameId: this.gameId, err }, 'Failed to broadcast monopoly:detected socket event.');
      }
    }

    // 2. Persist to DB if database is connected
    try {
      const activeDb = this.db || getDatabase();
      if (activeDb) {
        const roundRepo = new RoundRepository(activeDb);
        const round = roundRepo.findByGameIdAndRoundNumber(this.gameId, this.currentRound);
        if (round) {
          // If event was triggered, update round record and save to round_event
          if (triggeredEvent) {
            roundRepo.update(round.id, { eventId: triggeredEvent.id });

            const roundEventRepo = new RoundEventRepository(activeDb);
            const eventDeltas = applyEvent(triggeredEvent, activeTeams, eventRng);
            const targetedTeamIds = Array.from(eventDeltas.entries())
              .filter(([_, delta]) => (
                delta.money !== 0 ||
                delta.marketShare !== 0 ||
                delta.technology !== 0 ||
                delta.reputation !== 0 ||
                delta.monopolyRisk !== 0
              ))
              .map(([teamId]) => teamId);

            roundEventRepo.create({
              id: uuid(),
              roundId: round.id,
              eventType: triggeredEvent.type,
              eventDataJson: JSON.stringify({
                effects: triggeredEvent.effects,
                targets: targetedTeamIds,
              }),
              narrationText: triggeredEvent.descriptionVi,
              createdAt: new Date().toISOString(),
            });
          }

          this.persistRoundResults(round.id, results);
        }
      }
    } catch (err) {
      logger.error({ gameId: this.gameId, err }, 'Failed to persist round processing results to database.');
    }

    // 3. Automatically transition to next phase
    this.advancePhase();
  }

  /**
   * Advances the game state machine to the next phase sequentially.
   */
  public advancePhase(): void {
    const currentPhase = this.phase;
    let nextPhase: GamePhase;

    if (currentPhase === 'decision') {
      nextPhase = 'event';
    } else if (currentPhase === 'event') {
      nextPhase = 'narration';
    } else if (currentPhase === 'narration') {
      const hasQuiz = this.currentRound === 3 || this.currentRound === 5 || this.currentRound === 7;
      nextPhase = hasQuiz ? 'quiz' : 'results';
    } else if (currentPhase === 'quiz') {
      nextPhase = 'results';
    } else if (currentPhase === 'results') {
      const activeDb = this.db || getDatabase();
      let totalRounds = 8; // default fallback
      if (activeDb) {
        try {
          const gameRepo = new GameRepository(activeDb);
          const game = gameRepo.findById(this.gameId);
          if (game) {
            totalRounds = game.totalRounds;
          }
        } catch (err) {
          logger.error({ gameId: this.gameId, err }, 'Failed to look up totalRounds during phase transition.');
        }
      }

      if (this.currentRound < totalRounds) {
        this.startRound(this.currentRound + 1);
        return; // startRound manages its own events
      } else {
        nextPhase = 'finished';
      }
    } else {
      return;
    }

    this.phase = nextPhase;

    // Persist status updates to database
    try {
      const activeDb = this.db || getDatabase();
      if (activeDb) {
        if (nextPhase === 'finished') {
          const gameRepo = new GameRepository(activeDb);
          gameRepo.update(this.gameId, { status: 'finished' });

          const teamRepo = new TeamRepository(activeDb);
          const teams = teamRepo.findByGameId(this.gameId);
          const sortedTeams = [...teams].sort((a, b) => b.totalScore - a.totalScore);
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
          this.callbacks.onGameOver(finalLeaderboard);
        } else {
          const roundRepo = new RoundRepository(activeDb);
          const round = roundRepo.findByGameIdAndRoundNumber(this.gameId, this.currentRound);
          if (round) {
            roundRepo.update(round.id, { phase: nextPhase });
          }
        }
      }
    } catch (err) {
      logger.error({ gameId: this.gameId, err }, 'Failed to persist phase status updates to database.');
    }

    this.callbacks.onPhaseChange(this.phase, this.currentRound);
  }

  /**
   * Returns non-sensitive public state viewable by anyone (e.g. projector).
   */
  public getPublicState(): any {
    const teamsArray = Array.from(this.teams.values()).map((t) => ({
      id: t.id,
      name: t.name,
      teamNumber: t.teamNumber,
      marketShare: t.marketShare,
      technology: t.technology,
      reputation: t.reputation,
      monopolyRisk: t.monopolyRisk,
      submitted: this.submittedDecisions.has(t.id),
    }));

    return {
      gameId: this.gameId,
      phase: this.phase,
      currentRound: this.currentRound,
      teams: teamsArray,
      currentEvent: this.currentEvent,
      secondsLeft: this.secondsLeft,
    };
  }

  /**
   * Returns detailed state for a specific team, incorporating private metrics and filtered decisions.
   */
  public getTeamState(teamId: string): any {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Không tìm thấy đội chơi: ${teamId}`);
    }

    const decisionEngine = new DecisionEngine();
    let prevDecisionType: string | null = null;

    try {
      const activeDb = this.db || getDatabase();
      if (activeDb) {
        const roundRepo = new RoundRepository(activeDb);
        const decisionLogRepo = new DecisionLogRepository(activeDb);
        const prevRound = roundRepo.findByGameIdAndRoundNumber(this.gameId, this.currentRound - 1);
        if (prevRound) {
          const log = decisionLogRepo.findByRoundIdAndTeamId(prevRound.id, teamId);
          if (log) {
            prevDecisionType = log.decisionType;
          }
        }
      }
    } catch (err) {
      logger.error({ teamId, err }, 'Failed to check previous decision during team state retrieval.');
    }

    const filteredDecisions = decisionEngine.getAvailableDecisions(
      this.currentRound,
      team,
      prevDecisionType,
      this.seed
    );

    return {
      ...this.getPublicState(),
      myTeam: {
        id: team.id,
        name: team.name,
        teamNumber: team.teamNumber,
        money: team.money,
        marketShare: team.marketShare,
        technology: team.technology,
        reputation: team.reputation,
        monopolyRisk: team.monopolyRisk,
      },
      availableDecisions: filteredDecisions,
      hasSubmitted: this.submittedDecisions.has(teamId),
    };
  }

  /**
   * Stops the active timer to avoid leaks.
   */
  public stopTimer(): void {
    if (this.roundTimer) {
      clearInterval(this.roundTimer);
      this.roundTimer = null;
    }
  }

  /**
   * Helper function to save in-memory delta results to database.
   */
  private persistRoundResults(roundId: string, results: Map<string, StatsDelta>): void {
    const activeDb = this.db || getDatabase();
    if (!activeDb) return;

    const teamRepo = new TeamRepository(activeDb);
    const decisionLogRepo = new DecisionLogRepository(activeDb);

    for (const [teamId, delta] of results.entries()) {
      const team = this.teams.get(teamId);
      if (!team) continue;

      // 1. Update team in SQLite
      teamRepo.update(teamId, {
        money: team.money,
        marketShare: team.marketShare,
        technology: team.technology,
        reputation: team.reputation,
        monopolyRisk: team.monopolyRisk,
      });

      // 2. Insert fallback log record if not submitted (ensures complete historical charts)
      const existing = decisionLogRepo.findByRoundIdAndTeamId(roundId, teamId);
      if (!existing) {
        const decisionType = this.submittedDecisions.get(teamId) || 'invest_tech';
        decisionLogRepo.create({
          id: uuid(),
          roundId,
          teamId,
          decisionType,
          decisionDataJson: JSON.stringify({ cost: Math.abs(delta.money), timeoutFallback: !this.submittedDecisions.has(teamId) }),
          moneyDelta: delta.money,
          marketShareDelta: delta.marketShare,
          technologyDelta: delta.technology,
          reputationDelta: delta.reputation,
          monopolyRiskDelta: delta.monopolyRisk,
          scoreEarned: 0,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
}
