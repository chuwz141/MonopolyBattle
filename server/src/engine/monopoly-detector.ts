import { InMemoryTeamState } from './game.engine.js';

export interface MonopolyResult {
  dominantTeamId: string;
  dominantTeamName: string;
  monopolyType: 'MARKET_DOMINANCE' | 'MONOPOLY_RISK_CEILING' | 'COMBINED_DOMINANCE' | 'RELATIVE_DOMINANCE';
  explanation: string;
  intervention: {
    monopolyRiskReduction: number;
    marketShareReduction: number;
    otherTeamsMarketShareBoost: number;
  };
}

// Configurable thresholds to avoid magic numbers
export const MONOPOLY_THRESHOLDS = {
  MARKET_DOMINANCE_SHARE: 50.0,
  MONOPOLY_RISK_CEILING: 80,
  COMBINED_MARKET_SHARE: 35.0,
  COMBINED_MONOPOLY_RISK: 60,
  RELATIVE_DOMINANCE_MULTIPLIER: 3,
} as const;

// Configurable intervention effects
export const INTERVENTION_EFFECTS = {
  MONOPOLY_RISK_REDUCTION: 20,
  MARKET_SHARE_REDUCTION: 10.0,
  OTHER_TEAMS_BOOST: 5.0,
} as const;

/**
 * Checks all active teams against the four monopoly conditions.
 * Stably returns the most dominant monopoly detection result (or null if none found).
 */
export function check(teams: InMemoryTeamState[]): MonopolyResult | null {
  const activeTeams = teams.filter((t) => t.status === 'playing' || t.status === 'ready');
  if (activeTeams.length === 0) {
    return null;
  }

  const detections: MonopolyResult[] = [];

  for (const team of activeTeams) {
    const otherTeams = activeTeams.filter((t) => t.id !== team.id);
    const otherTeamsCount = otherTeams.length;
    const otherMarketShareSum = otherTeams.reduce((sum, t) => sum + t.marketShare, 0);
    const otherAverageShare = otherTeamsCount > 0 ? otherMarketShareSum / otherTeamsCount : 0;

    // Condition 1: MARKET DOMINANCE (market_share >= 50%)
    if (team.marketShare >= MONOPOLY_THRESHOLDS.MARKET_DOMINANCE_SHARE) {
      detections.push({
        dominantTeamId: team.id,
        dominantTeamName: team.name,
        monopolyType: 'MARKET_DOMINANCE',
        explanation: `Đội ${team.name} đã đạt vị thế độc quyền do chiếm giữ trên ${MONOPOLY_THRESHOLDS.MARKET_DOMINANCE_SHARE}% thị phần (${team.marketShare}%). Chính phủ sẽ can thiệp để khôi phục cạnh tranh lành mạnh trên thị trường.`,
        intervention: {
          monopolyRiskReduction: INTERVENTION_EFFECTS.MONOPOLY_RISK_REDUCTION,
          marketShareReduction: INTERVENTION_EFFECTS.MARKET_SHARE_REDUCTION,
          otherTeamsMarketShareBoost: INTERVENTION_EFFECTS.OTHER_TEAMS_BOOST,
        },
      });
      continue;
    }

    // Condition 2: MONOPOLY RISK CEILING (monopoly_risk >= 80)
    if (team.monopolyRisk >= MONOPOLY_THRESHOLDS.MONOPOLY_RISK_CEILING) {
      detections.push({
        dominantTeamId: team.id,
        dominantTeamName: team.name,
        monopolyType: 'MONOPOLY_RISK_CEILING',
        explanation: `Đội ${team.name} đã chạm trần rủi ro độc quyền (${team.monopolyRisk} >= ${MONOPOLY_THRESHOLDS.MONOPOLY_RISK_CEILING}). Các hoạt động sáp nhập và thâu tóm quá mức buộc chính phủ phải can thiệp điều tiết.`,
        intervention: {
          monopolyRiskReduction: INTERVENTION_EFFECTS.MONOPOLY_RISK_REDUCTION,
          marketShareReduction: INTERVENTION_EFFECTS.MARKET_SHARE_REDUCTION,
          otherTeamsMarketShareBoost: INTERVENTION_EFFECTS.OTHER_TEAMS_BOOST,
        },
      });
      continue;
    }

    // Condition 3: COMBINED DOMINANCE (market_share >= 35% AND monopoly_risk >= 60)
    if (
      team.marketShare >= MONOPOLY_THRESHOLDS.COMBINED_MARKET_SHARE &&
      team.monopolyRisk >= MONOPOLY_THRESHOLDS.COMBINED_MONOPOLY_RISK
    ) {
      detections.push({
        dominantTeamId: team.id,
        dominantTeamName: team.name,
        monopolyType: 'COMBINED_DOMINANCE',
        explanation: `Đội ${team.name} đã đạt vị thế độc quyền do kết hợp giữa thị phần cao (${team.marketShare}% >= ${MONOPOLY_THRESHOLDS.COMBINED_MARKET_SHARE}%) và rủi ro độc quyền cao (${team.monopolyRisk} >= ${MONOPOLY_THRESHOLDS.COMBINED_MONOPOLY_RISK}).`,
        intervention: {
          monopolyRiskReduction: INTERVENTION_EFFECTS.MONOPOLY_RISK_REDUCTION,
          marketShareReduction: INTERVENTION_EFFECTS.MARKET_SHARE_REDUCTION,
          otherTeamsMarketShareBoost: INTERVENTION_EFFECTS.OTHER_TEAMS_BOOST,
        },
      });
      continue;
    }

    // Condition 4: RELATIVE DOMINANCE (market_share >= 3x the average of all other teams)
    // Only triggers if other teams exist and the team has non-zero market share
    if (
      otherTeamsCount > 0 &&
      team.marketShare > 0 &&
      team.marketShare >= MONOPOLY_THRESHOLDS.RELATIVE_DOMINANCE_MULTIPLIER * otherAverageShare
    ) {
      detections.push({
        dominantTeamId: team.id,
        dominantTeamName: team.name,
        monopolyType: 'RELATIVE_DOMINANCE',
        explanation: `Đội ${team.name} đã đạt vị thế độc quyền do thị phần (${team.marketShare}%) vượt quá ${MONOPOLY_THRESHOLDS.RELATIVE_DOMINANCE_MULTIPLIER} lần mức trung bình của các đối thủ khác (${otherAverageShare.toFixed(1)}%).`,
        intervention: {
          monopolyRiskReduction: INTERVENTION_EFFECTS.MONOPOLY_RISK_REDUCTION,
          marketShareReduction: INTERVENTION_EFFECTS.MARKET_SHARE_REDUCTION,
          otherTeamsMarketShareBoost: INTERVENTION_EFFECTS.OTHER_TEAMS_BOOST,
        },
      });
    }
  }

  if (detections.length === 0) {
    return null;
  }

  // Stable selection if multiple teams trigger:
  // Sort by marketShare descending, then monopolyRisk descending, then by teamNumber ascending
  const sortedDetections = detections.sort((a, b) => {
    const teamA = activeTeams.find((t) => t.id === a.dominantTeamId);
    const teamB = activeTeams.find((t) => t.id === b.dominantTeamId);
    if (!teamA || !teamB) {
      return 0;
    }
    if (teamB.marketShare !== teamA.marketShare) {
      return teamB.marketShare - teamA.marketShare;
    }
    if (teamB.monopolyRisk !== teamA.monopolyRisk) {
      return teamB.monopolyRisk - teamA.monopolyRisk;
    }
    return teamA.teamNumber - teamB.teamNumber;
  });

  return sortedDetections[0] ?? null;
}
