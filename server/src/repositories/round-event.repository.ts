import Database from 'better-sqlite3';
import { BaseRepository } from './base.repository.js';
import { RoundEventEntity, CreateRoundEventDto, UpdateRoundEventDto } from '../types/database.types.js';

export class RoundEventRepository extends BaseRepository<RoundEventEntity, CreateRoundEventDto, UpdateRoundEventDto> {
  constructor(db: Database.Database) {
    super(db, 'round_event');
  }

  private mapRowToEntity(row: any): RoundEventEntity {
    return {
      id: row.id,
      roundId: row.round_id,
      eventType: row.event_type,
      eventDataJson: row.event_data_json,
      narrationText: row.narration_text,
      createdAt: row.created_at,
    };
  }

  findById(id: string): RoundEventEntity | null {
    const row = this.db.prepare('SELECT * FROM round_event WHERE id = ?').get(id);
    return row ? this.mapRowToEntity(row) : null;
  }

  findByRoundId(roundId: string): RoundEventEntity | null {
    const row = this.db.prepare('SELECT * FROM round_event WHERE round_id = ?').get(roundId);
    return row ? this.mapRowToEntity(row) : null;
  }

  create(dto: CreateRoundEventDto): RoundEventEntity {
    const createdAt = dto.createdAt ?? new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO round_event (id, round_id, event_type, event_data_json, narration_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      dto.id,
      dto.roundId,
      dto.eventType,
      dto.eventDataJson,
      dto.narrationText,
      createdAt
    );
    return this.findById(dto.id)!;
  }

  update(id: string, dto: UpdateRoundEventDto): RoundEventEntity {
    const fields: string[] = [];
    const params: any[] = [];

    if (dto.eventType !== undefined) { fields.push('event_type = ?'); params.push(dto.eventType); }
    if (dto.eventDataJson !== undefined) { fields.push('event_data_json = ?'); params.push(dto.eventDataJson); }
    if (dto.narrationText !== undefined) { fields.push('narration_text = ?'); params.push(dto.narrationText); }

    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE round_event
      SET ${fields.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...params);

    return this.findById(id)!;
  }

  findMany(filter?: Partial<RoundEventEntity>): RoundEventEntity[] {
    let sql = 'SELECT * FROM round_event';
    const params: any[] = [];

    if (filter && Object.keys(filter).length > 0) {
      const clauses: string[] = [];
      if (filter.id !== undefined) { clauses.push('id = ?'); params.push(filter.id); }
      if (filter.roundId !== undefined) { clauses.push('round_id = ?'); params.push(filter.roundId); }
      if (filter.eventType !== undefined) { clauses.push('event_type = ?'); params.push(filter.eventType); }
      sql += ' WHERE ' + clauses.join(' AND ');
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(row => this.mapRowToEntity(row));
  }
}
