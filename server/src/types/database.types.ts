// TypeScript definitions representing database entities in camelCase
// and DTOs (Data Transfer Objects) for database operations.

export interface GameEntity {
  id: string;
  roomCode: string;
  hostPin: string;
  status: 'lobby' | 'playing' | 'paused' | 'finished';
  currentRound: number;
  totalRounds: number;
  roundDurationSec: number;
  settingsJson: string; // JSON configuration
  createdAt: string;
  updatedAt: string;
}

export type CreateGameDto = Omit<GameEntity, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateGameDto = Partial<Omit<GameEntity, 'id' | 'createdAt'>> & {
  updatedAt?: string;
};

export interface TeamEntity {
  id: string;
  gameId: string;
  name: string;
  teamNumber: number;
  money: number;
  marketShare: number;
  technology: number;
  reputation: number;
  monopolyRisk: number;
  totalScore: number;
  quizScore: number;
  status: 'waiting' | 'ready' | 'playing' | 'eliminated';
  createdAt: string;
}

export type CreateTeamDto = Omit<TeamEntity, 'money' | 'marketShare' | 'technology' | 'reputation' | 'monopolyRisk' | 'totalScore' | 'quizScore' | 'status' | 'createdAt'> & {
  money?: number;
  marketShare?: number;
  technology?: number;
  reputation?: number;
  monopolyRisk?: number;
  totalScore?: number;
  quizScore?: number;
  status?: 'waiting' | 'ready' | 'playing' | 'eliminated';
  createdAt?: string;
};

export type UpdateTeamDto = Partial<Omit<TeamEntity, 'id' | 'gameId' | 'createdAt'>>;

export interface PlayerEntity {
  id: string;
  teamId: string;
  displayName: string;
  socketId: string | null;
  isConnected: number; // 0 or 1 (integer in SQLite)
  lastSeen: string;
}

export type CreatePlayerDto = Omit<PlayerEntity, 'isConnected' | 'lastSeen'> & {
  isConnected?: number;
  lastSeen?: string;
};

export type UpdatePlayerDto = Partial<Omit<PlayerEntity, 'id' | 'teamId'>>;

export interface RoundEntity {
  id: string;
  gameId: string;
  roundNumber: number;
  phase: 'decision' | 'event' | 'quiz' | 'narration' | 'results';
  availableDecisionsJson: string; // JSON array of Decisions
  eventId: string | null;
  narrationText: string | null;
  startedAt: string;
  endedAt: string | null;
}

export type CreateRoundDto = Omit<RoundEntity, 'startedAt' | 'endedAt'> & {
  startedAt?: string;
  endedAt?: string | null;
};

export type UpdateRoundDto = Partial<Omit<RoundEntity, 'id' | 'gameId'>>;

export interface DecisionLogEntity {
  id: string;
  roundId: string;
  teamId: string;
  decisionType: string;
  decisionDataJson: string; // JSON of Decision parameters
  moneyDelta: number;
  marketShareDelta: number;
  technologyDelta: number;
  reputationDelta: number;
  monopolyRiskDelta: number;
  scoreEarned: number;
  createdAt: string;
}

export type CreateDecisionLogDto = DecisionLogEntity;
export type UpdateDecisionLogDto = Partial<Omit<DecisionLogEntity, 'id' | 'roundId' | 'teamId'>>;

export interface RoundEventEntity {
  id: string;
  roundId: string;
  eventType: string;
  eventDataJson: string; // JSON string of parameters and effects
  narrationText: string;
  createdAt: string;
}

export type CreateRoundEventDto = RoundEventEntity;
export type UpdateRoundEventDto = Partial<Omit<RoundEventEntity, 'id' | 'roundId'>>;

export interface QuizAnswerEntity {
  id: string;
  roundId: string;
  teamId: string;
  questionId: string;
  selectedOption: number;
  isCorrect: number; // 0 or 1
  timeTakenMs: number;
  scoreEarned: number;
  createdAt: string;
}

export type CreateQuizAnswerDto = QuizAnswerEntity;
export type UpdateQuizAnswerDto = Partial<Omit<QuizAnswerEntity, 'id' | 'roundId' | 'teamId'>>;
