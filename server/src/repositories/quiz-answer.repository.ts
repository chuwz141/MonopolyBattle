import Database from 'better-sqlite3';
import { BaseRepository } from './base.repository.js';
import { QuizAnswerEntity, CreateQuizAnswerDto, UpdateQuizAnswerDto } from '../types/database.types.js';

export class QuizAnswerRepository extends BaseRepository<QuizAnswerEntity, CreateQuizAnswerDto, UpdateQuizAnswerDto> {
  constructor(db: Database.Database) {
    super(db, 'quiz_answer');
  }

  private mapRowToEntity(row: any): QuizAnswerEntity {
    return {
      id: row.id,
      roundId: row.round_id,
      teamId: row.team_id,
      questionId: row.question_id,
      selectedOption: row.selected_option,
      isCorrect: row.is_correct,
      timeTakenMs: row.time_taken_ms,
      scoreEarned: row.score_earned,
      createdAt: row.created_at,
    };
  }

  findById(id: string): QuizAnswerEntity | null {
    const row = this.db.prepare('SELECT * FROM quiz_answer WHERE id = ?').get(id);
    return row ? this.mapRowToEntity(row) : null;
  }

  findByRoundIdAndTeamId(roundId: string, teamId: string): QuizAnswerEntity | null {
    const row = this.db.prepare('SELECT * FROM quiz_answer WHERE round_id = ? AND team_id = ?').get(roundId, teamId);
    return row ? this.mapRowToEntity(row) : null;
  }

  create(dto: CreateQuizAnswerDto): QuizAnswerEntity {
    const createdAt = dto.createdAt ?? new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO quiz_answer (id, round_id, team_id, question_id, selected_option, is_correct, time_taken_ms, score_earned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      dto.id,
      dto.roundId,
      dto.teamId,
      dto.questionId,
      dto.selectedOption,
      dto.isCorrect,
      dto.timeTakenMs,
      dto.scoreEarned,
      createdAt
    );
    return this.findById(dto.id)!;
  }

  update(id: string, dto: UpdateQuizAnswerDto): QuizAnswerEntity {
    const fields: string[] = [];
    const params: any[] = [];

    if (dto.questionId !== undefined) { fields.push('question_id = ?'); params.push(dto.questionId); }
    if (dto.selectedOption !== undefined) { fields.push('selected_option = ?'); params.push(dto.selectedOption); }
    if (dto.isCorrect !== undefined) { fields.push('is_correct = ?'); params.push(dto.isCorrect); }
    if (dto.timeTakenMs !== undefined) { fields.push('time_taken_ms = ?'); params.push(dto.timeTakenMs); }
    if (dto.scoreEarned !== undefined) { fields.push('score_earned = ?'); params.push(dto.scoreEarned); }

    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE quiz_answer
      SET ${fields.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...params);

    return this.findById(id)!;
  }

  findMany(filter?: Partial<QuizAnswerEntity>): QuizAnswerEntity[] {
    let sql = 'SELECT * FROM quiz_answer';
    const params: any[] = [];

    if (filter && Object.keys(filter).length > 0) {
      const clauses: string[] = [];
      if (filter.id !== undefined) { clauses.push('id = ?'); params.push(filter.id); }
      if (filter.roundId !== undefined) { clauses.push('round_id = ?'); params.push(filter.roundId); }
      if (filter.teamId !== undefined) { clauses.push('team_id = ?'); params.push(filter.teamId); }
      if (filter.questionId !== undefined) { clauses.push('question_id = ?'); params.push(filter.questionId); }
      if (filter.isCorrect !== undefined) { clauses.push('is_correct = ?'); params.push(filter.isCorrect); }
      sql += ' WHERE ' + clauses.join(' AND ');
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(row => this.mapRowToEntity(row));
  }
}
