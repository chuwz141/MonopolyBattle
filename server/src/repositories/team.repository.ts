import Database from 'better-sqlite3';
import { BaseRepository } from './base.repository.js';
import { TeamEntity, CreateTeamDto, UpdateTeamDto } from '../types/database.types.js';

export class TeamRepository extends BaseRepository<TeamEntity, CreateTeamDto, UpdateTeamDto> {
  constructor(db: Database.Database) {
    super(db, 'team');
  }

  private mapRowToEntity(row: any): TeamEntity {
    return {
      id: row.id,
      gameId: row.game_id,
      name: row.name,
      teamNumber: row.team_number,
      money: row.money,
      marketShare: row.market_share,
      technology: row.technology,
      reputation: row.reputation,
      monopolyRisk: row.monopoly_risk,
      totalScore: row.total_score,
      quizScore: row.quiz_score,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  findById(id: string): TeamEntity | null {
    const row = this.db.prepare('SELECT * FROM team WHERE id = ?').get(id);
    return row ? this.mapRowToEntity(row) : null;
  }

  findByGameId(gameId: string): TeamEntity[] {
    const rows = this.db.prepare('SELECT * FROM team WHERE game_id = ?').all(gameId);
    return rows.map(row => this.mapRowToEntity(row));
  }

  create(dto: CreateTeamDto): TeamEntity {
    const createdAt = dto.createdAt ?? new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO team (id, game_id, name, team_number, money, market_share, technology, reputation, monopoly_risk, total_score, quiz_score, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      dto.id,
      dto.gameId,
      dto.name,
      dto.teamNumber,
      dto.money ?? 10000,
      dto.marketShare ?? 0.0,
      dto.technology ?? 0,
      dto.reputation ?? 0,
      dto.monopolyRisk ?? 0,
      dto.totalScore ?? 0,
      dto.quizScore ?? 0,
      dto.status ?? 'waiting',
      createdAt
    );
    return this.findById(dto.id)!;
  }

  update(id: string, dto: UpdateTeamDto): TeamEntity {
    const fields: string[] = [];
    const params: any[] = [];

    if (dto.name !== undefined) { fields.push('name = ?'); params.push(dto.name); }
    if (dto.teamNumber !== undefined) { fields.push('team_number = ?'); params.push(dto.teamNumber); }
    if (dto.money !== undefined) { fields.push('money = ?'); params.push(dto.money); }
    if (dto.marketShare !== undefined) { fields.push('market_share = ?'); params.push(dto.marketShare); }
    if (dto.technology !== undefined) { fields.push('technology = ?'); params.push(dto.technology); }
    if (dto.reputation !== undefined) { fields.push('reputation = ?'); params.push(dto.reputation); }
    if (dto.monopolyRisk !== undefined) { fields.push('monopoly_risk = ?'); params.push(dto.monopolyRisk); }
    if (dto.totalScore !== undefined) { fields.push('total_score = ?'); params.push(dto.totalScore); }
    if (dto.quizScore !== undefined) { fields.push('quiz_score = ?'); params.push(dto.quizScore); }
    if (dto.status !== undefined) { fields.push('status = ?'); params.push(dto.status); }

    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE team
      SET ${fields.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...params);

    return this.findById(id)!;
  }

  findMany(filter?: Partial<TeamEntity>): TeamEntity[] {
    let sql = 'SELECT * FROM team';
    const params: any[] = [];

    if (filter && Object.keys(filter).length > 0) {
      const clauses: string[] = [];
      if (filter.id !== undefined) { clauses.push('id = ?'); params.push(filter.id); }
      if (filter.gameId !== undefined) { clauses.push('game_id = ?'); params.push(filter.gameId); }
      if (filter.name !== undefined) { clauses.push('name = ?'); params.push(filter.name); }
      if (filter.teamNumber !== undefined) { clauses.push('team_number = ?'); params.push(filter.teamNumber); }
      if (filter.money !== undefined) { clauses.push('money = ?'); params.push(filter.money); }
      if (filter.marketShare !== undefined) { clauses.push('market_share = ?'); params.push(filter.marketShare); }
      if (filter.technology !== undefined) { clauses.push('technology = ?'); params.push(filter.technology); }
      if (filter.reputation !== undefined) { clauses.push('reputation = ?'); params.push(filter.reputation); }
      if (filter.monopolyRisk !== undefined) { clauses.push('monopoly_risk = ?'); params.push(filter.monopolyRisk); }
      if (filter.totalScore !== undefined) { clauses.push('total_score = ?'); params.push(filter.totalScore); }
      if (filter.quizScore !== undefined) { clauses.push('quiz_score = ?'); params.push(filter.quizScore); }
      if (filter.status !== undefined) { clauses.push('status = ?'); params.push(filter.status); }
      sql += ' WHERE ' + clauses.join(' AND ');
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(row => this.mapRowToEntity(row));
  }
}
