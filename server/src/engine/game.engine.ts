import { Decision, GamePhase, LeaderboardEntry, SOCKET_EVENTS, GameEvent } from '@monopoly/shared';
import { v4 as uuid } from 'uuid';
import { getDatabase } from '../config/database.js';
import { GameRepository } from '../repositories/game.repository.js';
import { TeamRepository } from '../repositories/team.repository.js';
import { RoundRepository } from '../repositories/round.repository.js';
import { DecisionLogRepository } from '../repositories/decision-log.repository.js';
import { RoundEventRepository } from '../repositories/round-event.repository.js';
import { QuizAnswerRepository } from '../repositories/quiz-answer.repository.js';
import { DecisionEngine, BASE_EFFECTS, DECISION_TYPES, DecisionType, StatsDelta } from './decision.engine.js';
import { SeededRNG } from '../utils/random.js';
import { logger } from '../utils/logger.js';
import { maybeGenerateEvent, applyEvent } from './event.engine.js';
import { emitToRoom } from '../socket/index.js';
import { check as detectMonopoly } from './monopoly-detector.js';
import { calculateRoundScore, calculateLeaderboard, calculateFinalRanking } from './scoring.engine.js';
import { NarratorEngine } from '../narrator/narrator.engine.js';
import {
  getQuizForRound,
  scoreAnswer,
  generateQuizResult,
  QuizQuestion,
  QuizAnswerRecord,
  QuizResultSummary,
} from '../education/quiz.engine.js';
import { generateEducationalSummary, QuizRoundRecord } from '../education/education.engine.js';
import { removeEngine } from './game-engine.registry.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface GameEngineCallbacks {
  onRoundStart: (roundNumber: number, decisions: Decision[], duration: number) => void;
  onRoundTick: (secondsLeft: number) => void;
  onPhaseChange: (phase: GamePhase, roundNumber: number, data?: unknown) => void;
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
  totalScore?: number;
  quizScore?: number;
}

// ---------------------------------------------------------------------------
// Quiz timer duration constant
// ---------------------------------------------------------------------------

const QUIZ_DURATION_SEC = 30;
const QUIZ_DURATION_MS = QUIZ_DURATION_SEC * 1_000;

// ---------------------------------------------------------------------------
// ServerGameState
// ---------------------------------------------------------------------------

export class ServerGameState {
  public readonly gameId: string;
  public phase: GamePhase;
  public currentRound: number;
  public teams: Map<string, InMemoryTeamState>;
  public availableDecisions: Decision[];
  public submittedDecisions: Map<string, string>; // teamId → decisionType
  public currentEvent: GameEvent | null;
  public seed: string;
  public leaderboard: LeaderboardEntry[];
  public narrator: NarratorEngine;

  /** Currently active quiz question (null when not in quiz phase). */
  public activeQuizQuestion: QuizQuestion | null = null;

  /** Accumulated quiz answers for the current round (teamId → record). */
  public quizAnswers: Map<string, QuizAnswerRecord> = new Map();

  /** Historical quiz records used for educational summary at game-over. */
  public quizHistory: QuizRoundRecord[] = [];

  /** Timestamp when the current quiz phase started. */
  private quizStartedAt = 0;

  private roundTimer: NodeJS.Timeout | null = null;
  private quizTimer: NodeJS.Timeout | null = null;
  private secondsLeft = 0;
  private callbacks: GameEngineCallbacks;
  private db: ReturnType<typeof getDatabase> | null;

  constructor(
    gameId: string,
    seed: string,
    callbacks: GameEngineCallbacks,
    db?: ReturnType<typeof getDatabase>
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
    this.db = db ?? null;
    this.leaderboard = [];
    this.narrator = new NarratorEngine();
  }

  // -------------------------------------------------------------------------
  // Team management
  // -------------------------------------------------------------------------

  /**
   * Registers a team into the in-memory engine state manager.
   */
  public registerTeam(
    team: Omit<InMemoryTeamState, 'totalScore' | 'quizScore'> & {
      totalScore?: number;
      quizScore?: number;
    }
  ): void {
    this.teams.set(team.id, {
      ...team,
      totalScore: team.totalScore ?? 0,
      quizScore: team.quizScore ?? 0,
    });
  }

  // -------------------------------------------------------------------------
  // Round timer
  // -------------------------------------------------------------------------

  /**
   * Starts a round, generating available decisions, initiating the 60-second timer,
   * and notifying client sockets of ticks every 5 seconds.
   */
  public startRound(roundNumber: number): void {
    this.stopTimer();

    this.currentRound = roundNumber;
    this.phase = 'decision';
    this.submittedDecisions.clear();

    const rng = new SeededRNG(`${this.seed}_round_${roundNumber}`);
    let allowedTypes = (Object.keys(BASE_EFFECTS) as DecisionType[]).filter((type) => {
      if (
        (type === DECISION_TYPES.LOBBY_GOVERNMENT || type === DECISION_TYPES.ACCEPT_GOV_SUPPORT) &&
        roundNumber < 3
      ) {
        return false;
      }
      return true;
    });
    allowedTypes = rng.shuffle(allowedTypes);

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

    // 1. Sync round start database records
    try {
      const activeDb = this.db ?? getDatabase();
      if (activeDb) {
        const gameRepo = new GameRepository(activeDb);
        gameRepo.update(this.gameId, { currentRound: roundNumber });

        const roundRepo = new RoundRepository(activeDb);
        const existing = roundRepo.findByGameIdAndRoundNumber(this.gameId, roundNumber);
        if (!existing) {
          roundRepo.create({
            id: uuid(),
            gameId: this.gameId,
            roundNumber,
            phase: 'decision',
            availableDecisionsJson: JSON.stringify(roundCandidates),
            eventId: null,
            narrationText: null,
          });
        } else {
          roundRepo.update(existing.id, {
            phase: 'decision',
            availableDecisionsJson: JSON.stringify(roundCandidates),
          });
        }
      }
    } catch (err) {
      logger.error({ gameId: this.gameId, err }, 'Failed to persist round start status in database.');
    }

    const duration = 60;
    this.callbacks.onRoundStart(roundNumber, roundCandidates, duration);

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

  // -------------------------------------------------------------------------
  // Decision submission
  // -------------------------------------------------------------------------

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

    const activeTeams = Array.from(this.teams.values()).filter(
      (t) => t.status === 'playing' || t.status === 'ready'
    );

    if (this.submittedDecisions.size === activeTeams.length && activeTeams.length > 0) {
      logger.info(
        { gameId: this.gameId },
        'All active teams submitted. Clearing timer and starting early processing.'
      );
      this.stopTimer();
      this.processRound();
    }
  }

  // -------------------------------------------------------------------------
  // Quiz answer submission
  // -------------------------------------------------------------------------

  /**
   * Records a team's quiz answer. If all active teams have answered, the quiz
   * is finalized immediately rather than waiting for the timer.
   */
  public submitQuizAnswer(
    teamId: string,
    questionId: string,
    selectedOption: number,
    timeTakenMs: number
  ): void {
    if (this.phase !== 'quiz') {
      logger.warn({ gameId: this.gameId, teamId }, 'submitQuizAnswer called outside quiz phase — ignored.');
      return;
    }

    if (!this.activeQuizQuestion) {
      logger.warn({ gameId: this.gameId, teamId }, 'submitQuizAnswer: no active quiz question — ignored.');
      return;
    }

    if (this.quizAnswers.has(teamId)) {
      logger.debug({ gameId: this.gameId, teamId }, 'Team already submitted quiz answer — duplicate ignored.');
      return;
    }

    if (questionId !== this.activeQuizQuestion.id) {
      logger.warn(
        { gameId: this.gameId, teamId, questionId, activeId: this.activeQuizQuestion.id },
        'Quiz answer questionId mismatch — ignored.'
      );
      return;
    }

    const score = scoreAnswer(questionId, selectedOption, timeTakenMs, QUIZ_DURATION_MS);
    const record: QuizAnswerRecord = { teamId, questionId, selectedOption, timeTakenMs, score };
    this.quizAnswers.set(teamId, record);

    logger.info(
      { gameId: this.gameId, teamId, isCorrect: score.isCorrect, points: score.totalPoints },
      'Quiz answer recorded.'
    );

    const activeTeams = Array.from(this.teams.values()).filter(
      (t) => t.status === 'playing' || t.status === 'ready'
    );

    if (this.quizAnswers.size >= activeTeams.length && activeTeams.length > 0) {
      logger.info({ gameId: this.gameId }, 'All teams answered quiz. Finalizing early.');
      this.stopQuizTimer();
      this.finalizeQuiz();
    }
  }

  // -------------------------------------------------------------------------
  // Round processing
  // -------------------------------------------------------------------------

  /**
   * Applies the selected business decisions, updates in-memory states,
   * synchronizes to SQLite database records, and triggers advancePhase.
   */
  public processRound(): void {
    const decisionEngine = new DecisionEngine();
    const results = new Map<string, StatsDelta>();

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
        delta = { money: 0, marketShare: 0, technology: 0, reputation: 0, monopolyRisk: 0 };
      }

      results.set(team.id, delta);

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
        {
          gameId: this.gameId,
          dominantTeamId: monopolyResult.dominantTeamId,
          monopolyType: monopolyResult.monopolyType,
        },
        'Monopoly detected! Applying antitrust regulation interventions.'
      );

      for (const team of activeTeams) {
        if (team.id === monopolyResult.dominantTeamId) {
          team.monopolyRisk = Math.max(0, team.monopolyRisk - monopolyResult.intervention.monopolyRiskReduction);
          team.marketShare = Math.min(
            100,
            Math.max(0, Number((team.marketShare - monopolyResult.intervention.marketShareReduction).toFixed(1)))
          );
        } else {
          team.marketShare = Math.min(
            100,
            Math.max(0, Number((team.marketShare + monopolyResult.intervention.otherTeamsMarketShareBoost).toFixed(1)))
          );
        }
      }

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

    // 1.3 Run Scoring Engine
    for (const team of activeTeams) {
      const choice = this.submittedDecisions.get(team.id) ?? null;
      const breakdown = calculateRoundScore(team, choice, {
        roundNumber: this.currentRound,
        activeEvent: this.currentEvent ? { type: this.currentEvent.type } : null,
      });
      team.totalScore = (team.totalScore ?? 0) + breakdown.totalRoundScore;

      logger.debug(
        {
          gameId: this.gameId,
          teamId: team.id,
          roundScore: breakdown.totalRoundScore,
          newTotalScore: team.totalScore,
        },
        'Round score calculated and updated for team.'
      );
    }

    // 1.4 Calculate Leaderboard ranking
    this.leaderboard = calculateLeaderboard(activeTeams, this.leaderboard);

    // 1.5 Generate and broadcast educational narrator messages
    const narratorRng = new SeededRNG(`${this.seed}_round_${this.currentRound}_narrator`);
    const narratorMessages = [];

    const summaryMsg = this.narrator.generateRoundSummary(this.currentRound, narratorRng);
    narratorMessages.push(summaryMsg);

    let eventMsg = null;
    if (triggeredEvent) {
      const targetTeam =
        activeTeams.find((t) => {
          const delta = results.get(t.id);
          return (
            delta &&
            (delta.money !== 0 ||
              delta.marketShare !== 0 ||
              delta.technology !== 0 ||
              delta.reputation !== 0 ||
              delta.monopolyRisk !== 0)
          );
        }) ?? null;

      eventMsg = this.narrator.generateEventNarration(
        {
          type: triggeredEvent.type,
          titleVi: triggeredEvent.titleVi,
          descriptionVi: triggeredEvent.descriptionVi,
        },
        targetTeam,
        narratorRng
      );
      narratorMessages.push(eventMsg);
    }

    for (const team of activeTeams) {
      const choice = this.submittedDecisions.get(team.id);
      if (choice) {
        const msg = this.narrator.generateDecisionNarration(team, choice, narratorRng);
        narratorMessages.push(msg);
      }
    }

    let monopolyMsg = null;
    if (monopolyResult) {
      const dominantTeam = activeTeams.find((t) => t.id === monopolyResult.dominantTeamId) ?? null;
      monopolyMsg = this.narrator.generateMonopolyNarration(
        {
          dominantTeamName: monopolyResult.dominantTeamName,
          monopolyType: monopolyResult.monopolyType,
          explanation: monopolyResult.explanation,
        },
        dominantTeam,
        narratorRng
      );
      narratorMessages.push(monopolyMsg);
    }

    const concept =
      monopolyMsg?.relatedConcept ??
      eventMsg?.relatedConcept ??
      narratorMessages.find((m) => m.relatedConcept)?.relatedConcept;

    if (concept) {
      const eduMsg = this.narrator.generateEducationalNarration(concept, narratorRng);
      if (eduMsg) {
        narratorMessages.push(eduMsg);
      }
    }

    for (const msg of narratorMessages) {
      try {
        emitToRoom(`room:${this.gameId}`, SOCKET_EVENTS.NARRATOR_MESSAGE, {
          text: msg.text,
          type: msg.type,
          ...(msg.relatedConcept ? { relatedConcept: msg.relatedConcept } : {}),
        });
      } catch (err) {
        logger.error({ gameId: this.gameId, err }, 'Failed to broadcast narrator:message socket event.');
      }
    }

    const combinedNarrationText = narratorMessages.map((m) => m.text).join('\n\n');

    // 2. Persist to DB
    try {
      const activeDb = this.db ?? getDatabase();
      if (activeDb) {
        const roundRepo = new RoundRepository(activeDb);
        const round = roundRepo.findByGameIdAndRoundNumber(this.gameId, this.currentRound);
        if (round) {
          roundRepo.update(round.id, {
            eventId: triggeredEvent?.id ?? round.eventId,
            narrationText: combinedNarrationText,
          });

          if (triggeredEvent) {
            const roundEventRepo = new RoundEventRepository(activeDb);
            const eventDeltas = applyEvent(triggeredEvent, activeTeams, eventRng);
            const targetedTeamIds = Array.from(eventDeltas.entries())
              .filter(
                ([, delta]) =>
                  delta.money !== 0 ||
                  delta.marketShare !== 0 ||
                  delta.technology !== 0 ||
                  delta.reputation !== 0 ||
                  delta.monopolyRisk !== 0
              )
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

    this.advancePhase();
  }

  // -------------------------------------------------------------------------
  // Phase management
  // -------------------------------------------------------------------------

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
      const hasQuiz =
        this.currentRound === 3 || this.currentRound === 5 || this.currentRound === 7;
      nextPhase = hasQuiz ? 'quiz' : 'results';
    } else if (currentPhase === 'quiz') {
      nextPhase = 'results';
    } else if (currentPhase === 'results') {
      const activeDb = this.db ?? getDatabase();
      let totalRounds = 8;
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
        return;
      } else {
        nextPhase = 'finished';
      }
    } else {
      return;
    }

    this.phase = nextPhase;

    // Handle quiz phase start
    if (nextPhase === 'quiz') {
      this.startQuizPhase();
    }

    // Persist phase changes and handle game-over
    try {
      const activeDb = this.db ?? getDatabase();
      if (activeDb) {
        if (nextPhase === 'finished') {
          this.handleGameOver(activeDb);
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

  // -------------------------------------------------------------------------
  // Quiz phase
  // -------------------------------------------------------------------------

  /**
   * Starts the quiz phase for the current round:
   * 1. Loads the question for this round.
   * 2. Clears previous quiz state.
   * 3. Emits quiz:start to all clients.
   * 4. Starts the 30-second countdown; auto-finalizes on expiry.
   */
  private startQuizPhase(): void {
    const question = getQuizForRound(this.currentRound);
    if (!question) {
      logger.warn(
        { gameId: this.gameId, round: this.currentRound },
        'No quiz question available for this round — skipping quiz phase.'
      );
      this.phase = 'results';
      this.callbacks.onPhaseChange(this.phase, this.currentRound);
      return;
    }

    this.activeQuizQuestion = question;
    this.quizAnswers = new Map();
    this.quizStartedAt = Date.now();

    logger.info(
      { gameId: this.gameId, round: this.currentRound, questionId: question.id },
      'Quiz phase started.'
    );

    try {
      emitToRoom(`room:${this.gameId}`, SOCKET_EVENTS.QUIZ_START, {
        question: question.question,
        options: question.options,
        timeLimit: QUIZ_DURATION_SEC,
      });
    } catch (err) {
      logger.error({ gameId: this.gameId, err }, 'Failed to broadcast quiz:start.');
    }

    this.quizTimer = setTimeout(() => {
      logger.info({ gameId: this.gameId, round: this.currentRound }, 'Quiz timer expired. Auto-finalizing.');
      this.finalizeQuiz();
    }, QUIZ_DURATION_MS);
  }

  /**
   * Finalizes the quiz phase:
   * 1. Scores all answers (teams that didn't answer get 0 points).
   * 2. Applies quiz scores to team.quizScore.
   * 3. Persists answers to quiz_answer table (in a transaction).
   * 4. Emits quiz:results.
   * 5. Advances to 'results' phase.
   */
  private finalizeQuiz(): void {
    this.stopQuizTimer();

    const question = this.activeQuizQuestion;
    if (!question) {
      logger.warn({ gameId: this.gameId }, 'finalizeQuiz called with no active question.');
      this.advancePhase();
      return;
    }

    const activeTeams = Array.from(this.teams.values()).filter(
      (t) => t.status === 'playing' || t.status === 'ready'
    );

    // Award quiz scores in-memory
    for (const team of activeTeams) {
      const record = this.quizAnswers.get(team.id);
      if (record?.score.isCorrect) {
        team.quizScore = (team.quizScore ?? 0) + record.score.totalPoints;
        team.totalScore = (team.totalScore ?? 0) + record.score.totalPoints;
      }
    }

    const summary: QuizResultSummary = generateQuizResult(this.quizAnswers, question);

    // Save quiz round to history for educational summary
    this.quizHistory.push({
      round: this.currentRound,
      conceptId: question.conceptId,
      result: summary,
    });

    // Emit quiz:results
    try {
      emitToRoom(`room:${this.gameId}`, SOCKET_EVENTS.QUIZ_RESULTS, {
        correctAnswer: summary.correctAnswer,
        teamScores: summary.teamResults,
        explanation: summary.explanation,
      });
    } catch (err) {
      logger.error({ gameId: this.gameId, err }, 'Failed to broadcast quiz:results.');
    }

    // Persist answers to DB
    try {
      const activeDb = this.db ?? getDatabase();
      if (activeDb) {
        const roundRepo = new RoundRepository(activeDb);
        const round = roundRepo.findByGameIdAndRoundNumber(this.gameId, this.currentRound);

        if (round) {
          const quizAnswerRepo = new QuizAnswerRepository(activeDb);
          const teamRepo = new TeamRepository(activeDb);

          // Use a DB transaction for atomicity
          const saveQuizAnswers = activeDb.transaction(() => {
            for (const team of activeTeams) {
              const record = this.quizAnswers.get(team.id);
              const selectedOption = record?.selectedOption ?? -1;
              const isCorrect = record?.score.isCorrect ?? false;
              const timeTakenMs = record?.timeTakenMs ?? QUIZ_DURATION_MS;
              const scoreEarned = record?.score.totalPoints ?? 0;

              quizAnswerRepo.create({
                id: uuid(),
                roundId: round.id,
                teamId: team.id,
                questionId: question.id,
                selectedOption,
                isCorrect: isCorrect ? 1 : 0,
                timeTakenMs,
                scoreEarned,
                createdAt: new Date().toISOString(),
              });

              // Update team quiz score in DB
              teamRepo.update(team.id, {
                quizScore: team.quizScore ?? 0,
                totalScore: team.totalScore ?? 0,
              });
            }
          });

          saveQuizAnswers();

          logger.info(
            { gameId: this.gameId, round: this.currentRound, answersCount: this.quizAnswers.size },
            'Quiz answers persisted to database.'
          );
        }
      }
    } catch (err) {
      logger.error({ gameId: this.gameId, err }, 'Failed to persist quiz answers to database.');
    }

    this.activeQuizQuestion = null;
    this.advancePhase();
  }

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------

  /**
   * Handles the game-over sequence:
   * 1. Calculates final leaderboard (includes quiz scores).
   * 2. Updates DB: game status = finished, final team scores.
   * 3. Generates educational summary.
   * 4. Emits game:over to all room members.
   * 5. Cleans up the engine registry entry.
   */
  private handleGameOver(activeDb: ReturnType<typeof getDatabase>): void {
    const gameRepo = new GameRepository(activeDb);
    const teamRepo = new TeamRepository(activeDb);

    // Build final team list from DB for accurate final scores
    const dbTeams = teamRepo.findByGameId(this.gameId);
    const finalTeamStates: InMemoryTeamState[] = dbTeams.map((t) => ({
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
    }));

    const finalLeaderboard = calculateFinalRanking(finalTeamStates);

    // Persist game status to finished (transaction)
    try {
      const finalize = activeDb.transaction(() => {
        gameRepo.update(this.gameId, { status: 'finished' });
      });
      finalize();
    } catch (err) {
      logger.error({ gameId: this.gameId, err }, 'Failed to finalize game status in DB.');
    }

    // Build educational summary from quiz history
    const eduSummary = generateEducationalSummary(this.currentRound, this.quizHistory);

    // Statistics
    const totalTeams = finalLeaderboard.length;
    const avgScore =
      totalTeams > 0
        ? Math.round(
            finalLeaderboard.reduce((sum, e) => sum + e.totalScore, 0) / totalTeams
          )
        : 0;

    // Emit game:over
    try {
      emitToRoom(`room:${this.gameId}`, SOCKET_EVENTS.GAME_OVER, {
        finalLeaderboard,
        gameStats: {
          totalTeams,
          roundsPlayed: this.currentRound,
          avgScore,
          educationalSummary: eduSummary,
        },
      });
    } catch (err) {
      logger.error({ gameId: this.gameId, err }, 'Failed to broadcast game:over.');
    }

    // Notify host via callback (used for host UI)
    this.callbacks.onGameOver(finalLeaderboard);

    // Remove from registry to avoid memory leaks
    removeEngine(this.gameId);

    logger.info(
      { gameId: this.gameId, finalLeaderboard: finalLeaderboard.map((e) => e.teamName) },
      'Game over. Final leaderboard emitted.'
    );
  }

  // -------------------------------------------------------------------------
  // Public state accessors
  // -------------------------------------------------------------------------

  /**
   * Returns non-sensitive public state viewable by anyone (e.g. projector).
   */
  public getPublicState(): {
    gameId: string;
    phase: GamePhase;
    currentRound: number;
    teams: Array<{
      id: string;
      name: string;
      teamNumber: number;
      marketShare: number;
      technology: number;
      reputation: number;
      monopolyRisk: number;
      submitted: boolean;
    }>;
    currentEvent: GameEvent | null;
    secondsLeft: number;
  } {
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
  public getTeamState(teamId: string): {
    gameId: string;
    phase: GamePhase;
    currentRound: number;
    teams: Array<unknown>;
    currentEvent: GameEvent | null;
    secondsLeft: number;
    myTeam: {
      id: string;
      name: string;
      teamNumber: number;
      money: number;
      marketShare: number;
      technology: number;
      reputation: number;
      monopolyRisk: number;
    };
    availableDecisions: Decision[];
    hasSubmitted: boolean;
  } {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Không tìm thấy đội chơi: ${teamId}`);
    }

    const decisionEngine = new DecisionEngine();
    let prevDecisionType: string | null = null;

    try {
      const activeDb = this.db ?? getDatabase();
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

  // -------------------------------------------------------------------------
  // Timer helpers
  // -------------------------------------------------------------------------

  /** Stops the active round timer to avoid leaks. */
  public stopTimer(): void {
    if (this.roundTimer) {
      clearInterval(this.roundTimer);
      this.roundTimer = null;
    }
  }

  /** Stops the active quiz countdown timer. */
  private stopQuizTimer(): void {
    if (this.quizTimer) {
      clearTimeout(this.quizTimer);
      this.quizTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // DB persistence helper
  // -------------------------------------------------------------------------

  /**
   * Saves in-memory delta results to database.
   */
  private persistRoundResults(roundId: string, results: Map<string, StatsDelta>): void {
    const activeDb = this.db ?? getDatabase();
    if (!activeDb) return;

    const teamRepo = new TeamRepository(activeDb);
    const decisionLogRepo = new DecisionLogRepository(activeDb);

    for (const [teamId, delta] of results.entries()) {
      const team = this.teams.get(teamId);
      if (!team) continue;

      teamRepo.update(teamId, {
        money: team.money,
        marketShare: team.marketShare,
        technology: team.technology,
        reputation: team.reputation,
        monopolyRisk: team.monopolyRisk,
        totalScore: team.totalScore ?? 0,
      });

      const existing = decisionLogRepo.findByRoundIdAndTeamId(roundId, teamId);
      if (!existing) {
        const decisionType = this.submittedDecisions.get(teamId) ?? 'invest_tech';
        decisionLogRepo.create({
          id: uuid(),
          roundId,
          teamId,
          decisionType,
          decisionDataJson: JSON.stringify({
            cost: Math.abs(delta.money),
            timeoutFallback: !this.submittedDecisions.has(teamId),
          }),
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
