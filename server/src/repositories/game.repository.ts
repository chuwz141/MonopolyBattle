import Database from 'better-sqlite3';
import { BaseRepository } from './base.repository.js';
import { GameEntity, CreateGameDto, UpdateGameDto } from '../types/database.types.js';

export class GameRepository extends BaseRepository<GameEntity, CreateGameDto, UpdateGameDto> {
  constructor(db: Database.Database) {
    super(db, 'game');
  }

  private mapRowToEntity(row: any): GameEntity {
    return {
      id: row.id,
      roomCode: row.room_code,
      hostPin: row.host_pin,
      status: row.status,
      currentRound: row.current_round,
      totalRounds: row.total_rounds,
      roundDurationSec: row.round_duration_sec,
      settingsJson: row.settings_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  findById(id: string): GameEntity | null {
    const row = this.db.prepare('SELECT * FROM game WHERE id = ?').get(id);
    return row ? this.mapRowToEntity(row) : null;
  }

  findByRoomCode(roomCode: string): GameEntity | null {
    const row = this.db.prepare('SELECT * FROM game WHERE room_code = ?').get(roomCode);
    return row ? this.mapRowToEntity(row) : null;
  }

  create(dto: CreateGameDto): GameEntity {
    const createdAt = dto.createdAt ?? new Date().toISOString();
    const updatedAt = dto.updatedAt ?? createdAt;
    const stmt = this.db.prepare(`
      INSERT INTO game (id, room_code, host_pin, status, current_round, total_rounds, round_duration_sec, settings_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      dto.id,
      dto.roomCode,
      dto.hostPin,
      dto.status,
      dto.currentRound,
      dto.totalRounds ?? 8,
      dto.roundDurationSec ?? 60,
      dto.settingsJson,
      createdAt,
      updatedAt
    );
    return this.findById(dto.id)!;
  }

  update(id: string, dto: UpdateGameDto): GameEntity {
    const fields: string[] = [];
    const params: any[] = [];

    if (dto.roomCode !== undefined) { fields.push('room_code = ?'); params.push(dto.roomCode); }
    if (dto.hostPin !== undefined) { fields.push('host_pin = ?'); params.push(dto.hostPin); }
    if (dto.status !== undefined) { fields.push('status = ?'); params.push(dto.status); }
    if (dto.currentRound !== undefined) { fields.push('current_round = ?'); params.push(dto.currentRound); }
    if (dto.totalRounds !== undefined) { fields.push('total_rounds = ?'); params.push(dto.totalRounds); }
    if (dto.roundDurationSec !== undefined) { fields.push('round_duration_sec = ?'); params.push(dto.roundDurationSec); }
    if (dto.settingsJson !== undefined) { fields.push('settings_json = ?'); params.push(dto.settingsJson); }

    const updatedAt = dto.updatedAt ?? new Date().toISOString();
    fields.push('updated_at = ?');
    params.push(updatedAt);

    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE game
      SET ${fields.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...params);

    return this.findById(id)!;
  }

  findMany(filter?: Partial<GameEntity>): GameEntity[] {
    let sql = 'SELECT * FROM game';
    const params: any[] = [];

    if (filter && Object.keys(filter).length > 0) {
      const clauses: string[] = [];
      if (filter.id !== undefined) { clauses.push('id = ?'); params.push(filter.id); }
      if (filter.roomCode !== undefined) { clauses.push('room_code = ?'); params.push(filter.roomCode); }
      if (filter.hostPin !== undefined) { clauses.push('host_pin = ?'); params.push(filter.hostPin); }
      if (filter.status !== undefined) { clauses.push('status = ?'); params.push(filter.status); }
      if (filter.currentRound !== undefined) { clauses.push('current_round = ?'); params.push(filter.currentRound); }
      if (filter.totalRounds !== undefined) { clauses.push('total_rounds = ?'); params.push(filter.totalRounds); }
      if (filter.roundDurationSec !== undefined) { clauses.push('round_duration_sec = ?'); params.push(filter.roundDurationSec); }
      if (filter.settingsJson !== undefined) { clauses.push('settings_json = ?'); params.push(filter.settingsJson); }
      sql += ' WHERE ' + clauses.join(' AND ');
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(row => this.mapRowToEntity(row));
  }
}
