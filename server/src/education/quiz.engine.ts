import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuizQuestion {
  id: string;
  conceptId: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  difficulty: number;
}

export interface QuizScore {
  isCorrect: boolean;
  basePoints: number;
  speedBonus: number;
  totalPoints: number;
}

export interface QuizAnswerRecord {
  teamId: string;
  questionId: string;
  selectedOption: number;
  timeTakenMs: number;
  score: QuizScore;
}

export interface QuizResultSummary {
  questionId: string;
  correctAnswer: number;
  explanation: string;
  teamResults: Array<{
    teamId: string;
    isCorrect: boolean;
    scoreEarned: number;
    timeTakenMs: number;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUIZ_BASE_SCORE = 20;
const QUIZ_SPEED_BONUS_MAX = 10;
const QUIZ_TIME_LIMIT_MS = 30_000;

/** Maps game round numbers to required question difficulty. */
const ROUND_DIFFICULTY_MAP: Record<number, number> = {
  3: 1,
  5: 2,
  7: 3,
};

// ---------------------------------------------------------------------------
// Load quiz bank
// ---------------------------------------------------------------------------

function loadQuizBank(): QuizQuestion[] {
  try {
    let filePath = path.resolve(process.cwd(), 'src/education/data/quizzes.json');
    if (!fs.existsSync(filePath)) {
      filePath = path.resolve(process.cwd(), 'dist/education/data/quizzes.json');
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.resolve(process.cwd(), 'education/data/quizzes.json');
    }
    if (!fs.existsSync(filePath)) {
      // Fallback: check relative path from current module
      filePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'data/quizzes.json');
    }

    // Windows compatibility pathname decode
    if (filePath.startsWith('/') && process.platform === 'win32') {
      filePath = filePath.substring(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const data: unknown = JSON.parse(content);
    if (!Array.isArray(data)) {
      throw new TypeError('quizzes.json must be a JSON array');
    }
    return data as QuizQuestion[];
  } catch (err) {
    logger.error({ err }, 'Failed to load quizzes.json — quiz engine will return empty bank');
    return [];
  }
}

const QUIZ_BANK: QuizQuestion[] = loadQuizBank();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the quiz question to present for a given round number.
 *
 * - Round 3 → difficulty 1 (Monopoly definition)
 * - Round 5 → difficulty 2 (State monopoly capitalism)
 * - Round 7 → difficulty 3 (Vietnam real-world context)
 *
 * Questions within each difficulty bucket are returned in stable order
 * (sequential by id) so every game sees the same question per round.
 */
export function getQuizForRound(round: number): QuizQuestion | null {
  const difficulty = ROUND_DIFFICULTY_MAP[round];
  if (difficulty === undefined) {
    logger.warn({ round }, 'getQuizForRound called for non-quiz round');
    return null;
  }

  const bucket = QUIZ_BANK.filter((q) => q.difficulty === difficulty);
  if (bucket.length === 0) {
    logger.error({ difficulty, round }, 'No quiz questions found for difficulty level');
    return null;
  }

  // Use round as a stable index within the bucket so the same difficulty
  // always uses different questions across multiple game replays.
  const idx = (round / 2 - 1) % bucket.length; // rounds 3,5,7 → indices 0,1,2
  const question = bucket[Math.floor(idx)];
  return question ?? bucket[0] ?? null;
}

/**
 * Scores a single quiz answer.
 *
 * @param questionId     The id of the question being answered.
 * @param selectedOption The 0-based index of the option the team selected.
 * @param timeTakenMs    How long the team took to answer (in milliseconds).
 * @param timeLimitMs    The total time allowed (defaults to 30 000 ms).
 */
export function scoreAnswer(
  questionId: string,
  selectedOption: number,
  timeTakenMs: number,
  timeLimitMs: number = QUIZ_TIME_LIMIT_MS
): QuizScore {
  const question = QUIZ_BANK.find((q) => q.id === questionId);
  if (!question) {
    logger.warn({ questionId }, 'scoreAnswer: question not found in bank');
    return { isCorrect: false, basePoints: 0, speedBonus: 0, totalPoints: 0 };
  }

  const isCorrect = selectedOption === question.correctAnswer;

  if (!isCorrect) {
    return { isCorrect: false, basePoints: 0, speedBonus: 0, totalPoints: 0 };
  }

  const basePoints = QUIZ_BASE_SCORE;
  const clampedTime = Math.min(Math.max(0, timeTakenMs), timeLimitMs);
  const speedRatio = 1 - clampedTime / timeLimitMs;
  const speedBonus = Math.floor(speedRatio * QUIZ_SPEED_BONUS_MAX);
  const totalPoints = basePoints + speedBonus;

  return { isCorrect: true, basePoints, speedBonus, totalPoints };
}

/**
 * Collects all team answers and produces the final quiz result summary,
 * including per-team score breakdown.
 */
export function generateQuizResult(
  answers: Map<string, QuizAnswerRecord>,
  question: QuizQuestion
): QuizResultSummary {
  const teamResults = Array.from(answers.values()).map((record) => ({
    teamId: record.teamId,
    isCorrect: record.score.isCorrect,
    scoreEarned: record.score.totalPoints,
    timeTakenMs: record.timeTakenMs,
  }));

  return {
    questionId: question.id,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    teamResults,
  };
}
