import Database from 'better-sqlite3';
import { BaseRepository } from './base.repository.js';
import { DecisionLogEntity, CreateDecisionLogDto, UpdateDecisionLogDto } from '../types/database.types.js';

export class DecisionLogRepository extends BaseRepository<DecisionLogEntity, CreateDecisionLogDto, UpdateDecisionLogDto> {
  constructor(db: Database.Database) {
    super(db, 'decision_log');
  }

  private mapRowToEntity(row: any): DecisionLogEntity {
    return {
      id: row.id,
      roundId: row.round_id,
      teamId: row.team_id,
      decisionType: row.decision_type,
      decisionDataJson: row.decision_data_json,
      moneyDelta: row.money_delta,
      marketShareDelta: row.market_share_delta,
      technologyDelta: row.technology_delta,
      reputationDelta: row.reputation_delta,
      monopolyRiskDelta: row.monopoly_risk_delta,
      scoreEarned: row.score_earned,
      createdAt: row.created_at,
    };
  }

  findById(id: string): DecisionLogEntity | null {
    const row = this.db.prepare('SELECT * FROM decision_log WHERE id = ?').get(id);
    return row ? this.mapRowToEntity(row) : null;
  }

  findByRoundIdAndTeamId(roundId: string, teamId: string): DecisionLogEntity | null {
    const row = this.db.prepare('SELECT * FROM decision_log WHERE round_id = ? AND team_id = ?').get(roundId, teamId);
    return row ? this.mapRowToEntity(row) : null;
  }

  create(dto: CreateDecisionLogDto): DecisionLogEntity {
    const createdAt = dto.createdAt ?? new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO decision_log (id, round_id, team_id, decision_type, decision_data_json, money_delta, market_share_delta, technology_delta, reputation_delta, monopoly_risk_delta, score_earned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      dto.id,
      dto.roundId,
      dto.teamId,
      dto.decisionType,
      dto.decisionDataJson,
      dto.moneyDelta,
      dto.marketShareDelta,
      dto.technologyDelta,
      dto.reputationDelta,
      dto.monopolyRiskDelta,
      dto.scoreEarned,
      createdAt
    );
    return this.findById(dto.id)!;
  }

  update(id: string, dto: UpdateDecisionLogDto): DecisionLogEntity {
    const fields: string[] = [];
    const params: any[] = [];

    if (dto.decisionType !== undefined) { fields.push('decision_type = ?'); params.push(dto.decisionType); }
    if (dto.decisionDataJson !== undefined) { fields.push('decision_data_json = ?'); params.push(dto.decisionDataJson); }
    if (dto.moneyDelta !== undefined) { fields.push('money_delta = ?'); params.push(dto.moneyDelta); }
    if (dto.marketShareDelta !== undefined) { fields.push('market_share_delta = ?'); params.push(dto.marketShareDelta); }
    if (dto.technologyDelta !== undefined) { fields.push('technology_delta = ?'); params.push(dto.technologyDelta); }
    if (dto.reputationDelta !== undefined) { fields.push('reputation_delta = ?'); params.push(dto.reputationDelta); }
    if (dto.monopolyRiskDelta !== undefined) { fields.push('monopoly_risk_delta = ?'); params.push(dto.monopolyRiskDelta); }
    if (dto.scoreEarned !== undefined) { fields.push('score_earned = ?'); params.push(dto.scoreEarned); }

    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE decision_log
      SET ${fields.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...params);

    return this.findById(id)!;
  }

  findMany(filter?: Partial<DecisionLogEntity>): DecisionLogEntity[] {
    let sql = 'SELECT * FROM decision_log';
    const params: any[] = [];

    if (filter && Object.keys(filter).length > 0) {
      const clauses: string[] = [];
      if (filter.id !== undefined) { clauses.push('id = ?'); params.push(filter.id); }
      if (filter.roundId !== undefined) { clauses.push('round_id = ?'); params.push(filter.roundId); }
      if (filter.teamId !== undefined) { clauses.push('team_id = ?'); params.push(filter.teamId); }
      if (filter.decisionType !== undefined) { clauses.push('decision_type = ?'); params.push(filter.decisionType); }
      sql += ' WHERE ' + clauses.join(' AND ');
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(row => this.mapRowToEntity(row));
  }
}
