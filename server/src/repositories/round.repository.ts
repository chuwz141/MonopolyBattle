import Database from 'better-sqlite3';
import { BaseRepository } from './base.repository.js';
import { RoundEntity, CreateRoundDto, UpdateRoundDto } from '../types/database.types.js';

export class RoundRepository extends BaseRepository<RoundEntity, CreateRoundDto, UpdateRoundDto> {
  constructor(db: Database.Database) {
    super(db, 'round');
  }

  private mapRowToEntity(row: any): RoundEntity {
    return {
      id: row.id,
      gameId: row.game_id,
      roundNumber: row.round_number,
      phase: row.phase,
      availableDecisionsJson: row.available_decisions_json,
      eventId: row.event_id,
      narrationText: row.narration_text,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    };
  }

  findById(id: string): RoundEntity | null {
    const row = this.db.prepare('SELECT * FROM round WHERE id = ?').get(id);
    return row ? this.mapRowToEntity(row) : null;
  }

  findByGameIdAndRoundNumber(gameId: string, roundNumber: number): RoundEntity | null {
    const row = this.db.prepare('SELECT * FROM round WHERE game_id = ? AND round_number = ?').get(gameId, roundNumber);
    return row ? this.mapRowToEntity(row) : null;
  }

  create(dto: CreateRoundDto): RoundEntity {
    const startedAt = dto.startedAt ?? new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO round (id, game_id, round_number, phase, available_decisions_json, event_id, narration_text, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      dto.id,
      dto.gameId,
      dto.roundNumber,
      dto.phase,
      dto.availableDecisionsJson,
      dto.eventId ?? null,
      dto.narrationText ?? null,
      startedAt,
      dto.endedAt ?? null
    );
    return this.findById(dto.id)!;
  }

  update(id: string, dto: UpdateRoundDto): RoundEntity {
    const fields: string[] = [];
    const params: any[] = [];

    if (dto.phase !== undefined) { fields.push('phase = ?'); params.push(dto.phase); }
    if (dto.availableDecisionsJson !== undefined) { fields.push('available_decisions_json = ?'); params.push(dto.availableDecisionsJson); }
    if (dto.eventId !== undefined) { fields.push('event_id = ?'); params.push(dto.eventId); }
    if (dto.narrationText !== undefined) { fields.push('narration_text = ?'); params.push(dto.narrationText); }
    if (dto.endedAt !== undefined) { fields.push('ended_at = ?'); params.push(dto.endedAt); }

    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE round
      SET ${fields.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...params);

    return this.findById(id)!;
  }

  findMany(filter?: Partial<RoundEntity>): RoundEntity[] {
    let sql = 'SELECT * FROM round';
    const params: any[] = [];

    if (filter && Object.keys(filter).length > 0) {
      const clauses: string[] = [];
      if (filter.id !== undefined) { clauses.push('id = ?'); params.push(filter.id); }
      if (filter.gameId !== undefined) { clauses.push('game_id = ?'); params.push(filter.gameId); }
      if (filter.roundNumber !== undefined) { clauses.push('round_number = ?'); params.push(filter.roundNumber); }
      if (filter.phase !== undefined) { clauses.push('phase = ?'); params.push(filter.phase); }
      if (filter.eventId !== undefined) { clauses.push('event_id = ?'); params.push(filter.eventId); }
      sql += ' WHERE ' + clauses.join(' AND ');
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(row => this.mapRowToEntity(row));
  }
}
