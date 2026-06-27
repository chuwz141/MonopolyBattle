import Database from 'better-sqlite3';
import { BaseRepository } from './base.repository.js';
import { PlayerEntity, CreatePlayerDto, UpdatePlayerDto } from '../types/database.types.js';

export class PlayerRepository extends BaseRepository<PlayerEntity, CreatePlayerDto, UpdatePlayerDto> {
  constructor(db: Database.Database) {
    super(db, 'player');
  }

  private mapRowToEntity(row: any): PlayerEntity {
    return {
      id: row.id,
      teamId: row.team_id,
      displayName: row.display_name,
      socketId: row.socket_id,
      isConnected: row.is_connected,
      lastSeen: row.last_seen,
    };
  }

  findById(id: string): PlayerEntity | null {
    const row = this.db.prepare('SELECT * FROM player WHERE id = ?').get(id);
    return row ? this.mapRowToEntity(row) : null;
  }

  findByTeamId(teamId: string): PlayerEntity[] {
    const rows = this.db.prepare('SELECT * FROM player WHERE team_id = ?').all(teamId);
    return rows.map(row => this.mapRowToEntity(row));
  }

  create(dto: CreatePlayerDto): PlayerEntity {
    const lastSeen = dto.lastSeen ?? new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO player (id, team_id, display_name, socket_id, is_connected, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      dto.id,
      dto.teamId,
      dto.displayName,
      dto.socketId ?? null,
      dto.isConnected ?? 1,
      lastSeen
    );
    return this.findById(dto.id)!;
  }

  update(id: string, dto: UpdatePlayerDto): PlayerEntity {
    const fields: string[] = [];
    const params: any[] = [];

    if (dto.displayName !== undefined) { fields.push('display_name = ?'); params.push(dto.displayName); }
    if (dto.socketId !== undefined) { fields.push('socket_id = ?'); params.push(dto.socketId); }
    if (dto.isConnected !== undefined) { fields.push('is_connected = ?'); params.push(dto.isConnected); }
    
    // Always update lastSeen if updating connection attributes
    const lastSeen = new Date().toISOString();
    fields.push('last_seen = ?');
    params.push(lastSeen);

    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE player
      SET ${fields.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...params);

    return this.findById(id)!;
  }

  findMany(filter?: Partial<PlayerEntity>): PlayerEntity[] {
    let sql = 'SELECT * FROM player';
    const params: any[] = [];

    if (filter && Object.keys(filter).length > 0) {
      const clauses: string[] = [];
      if (filter.id !== undefined) { clauses.push('id = ?'); params.push(filter.id); }
      if (filter.teamId !== undefined) { clauses.push('team_id = ?'); params.push(filter.teamId); }
      if (filter.displayName !== undefined) { clauses.push('display_name = ?'); params.push(filter.displayName); }
      if (filter.socketId !== undefined) { clauses.push('socket_id = ?'); params.push(filter.socketId); }
      if (filter.isConnected !== undefined) { clauses.push('is_connected = ?'); params.push(filter.isConnected); }
      sql += ' WHERE ' + clauses.join(' AND ');
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(row => this.mapRowToEntity(row));
  }
}
