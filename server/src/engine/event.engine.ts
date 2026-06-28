import { GameEvent } from '@monopoly/shared';
import { SeededRNG } from '../utils/random.js';
import { StatsDelta } from './decision.engine.js';

export interface InMemoryTeamState {
  id: string;
  name: string;
  teamNumber: number;
  money: number;
  marketShare: number;
  technology: number;
  reputation: number;
  monopolyRisk: number;
  status: string;
}

export interface EventDefinition {
  id: string;
  title: string;
  description: string;
  targetType:
    | 'all_teams'
    | 'random_team'
    | 'random_three_teams'
    | 'richest_team'
    | 'weakest_team'
    | 'highest_market_share'
    | 'lowest_market_share'
    | 'highest_monopoly_risk'
    | 'lowest_reputation_team';
  effects: {
    money: number;
    marketShare: number;
    technology: number;
    reputation: number;
    monopolyRisk: number;
  };
  narrationKey: string;
  probability: number;
}

// 9 event types defined in architecture.md section 7.4
export const eventPool: EventDefinition[] = [
  {
    id: 'crisis',
    title: 'Khủng hoảng kinh tế',
    description: 'Nền kinh tế toàn cầu rơi vào suy thoái, ảnh hưởng tiêu cực đến doanh thu và thị phần của tất cả các đội.',
    targetType: 'all_teams',
    effects: {
      money: -2000,
      marketShare: -3.0,
      technology: 0,
      reputation: 0,
      monopolyRisk: -5,
    },
    narrationKey: 'event_crisis',
    probability: 0.15,
  },
  {
    id: 'competitor',
    title: 'Đối thủ mới xuất hiện',
    description: 'Một đối thủ cạnh tranh mới gia nhập thị trường với chiến dịch giảm giá sâu, làm giảm thị phần của tất cả các đội.',
    targetType: 'all_teams',
    effects: {
      money: 0,
      marketShare: -2.0,
      technology: 0,
      reputation: 0,
      monopolyRisk: -8,
    },
    narrationKey: 'event_competitor',
    probability: 0.15,
  },
  {
    id: 'inspection',
    title: 'Chính phủ thanh tra',
    description: 'Ủy ban Cạnh tranh tiến hành thanh tra chống độc quyền đối với đội có rủi ro độc quyền cao nhất.',
    targetType: 'highest_monopoly_risk',
    effects: {
      money: -3000,
      marketShare: -5.0,
      technology: 0,
      reputation: -10,
      monopolyRisk: -15,
    },
    narrationKey: 'event_inspection',
    probability: 0.10,
  },
  {
    id: 'strike',
    title: 'Đình công lao động',
    description: 'Cuộc đình công quy mô lớn xảy ra tại các nhà máy của tối đa 3 đội ngẫu nhiên, yêu cầu tăng phúc lợi và điều kiện làm việc.',
    targetType: 'random_three_teams',
    effects: {
      money: -1500,
      marketShare: -2.0,
      technology: 0,
      reputation: -10,
      monopolyRisk: 0,
    },
    narrationKey: 'event_strike',
    probability: 0.10,
  },
  {
    id: 'tech_breakthrough',
    title: 'Đột phá công nghệ',
    description: 'Một đột phá kỹ thuật nguồn mở mới xuất hiện, cho phép tất cả các doanh nghiệp nâng cao trình độ công nghệ.',
    targetType: 'all_teams',
    effects: {
      money: 0,
      marketShare: 0,
      technology: 10,
      reputation: 5,
      monopolyRisk: 0,
    },
    narrationKey: 'event_tech_breakthrough',
    probability: 0.10,
  },
  {
    id: 'foreign_investment',
    title: 'Đầu tư nước ngoài',
    description: 'Các tập đoàn đa quốc gia rót vốn đầu tư phát triển thị trường vào tối đa 3 đội ngẫu nhiên.',
    targetType: 'random_three_teams',
    effects: {
      money: 3000,
      marketShare: 2.0,
      technology: 5,
      reputation: 5,
      monopolyRisk: 3,
    },
    narrationKey: 'event_foreign_investment',
    probability: 0.15,
  },
  {
    id: 'disaster',
    title: 'Thiên tai lũ lụt',
    description: 'Lũ lụt gây gián đoạn chuỗi cung ứng và hư hại cơ sở hạ tầng của tất cả các đội.',
    targetType: 'all_teams',
    effects: {
      money: -3000,
      marketShare: -4.0,
      technology: -5,
      reputation: 0,
      monopolyRisk: 0,
    },
    narrationKey: 'event_disaster',
    probability: 0.10,
  },
  {
    id: 'trade_agreement',
    title: 'Hiệp định thương mại',
    description: 'Một hiệp định thương mại tự do mới được ký kết, thúc đẩy xuất khẩu và gia tăng doanh số cho toàn bộ thị trường.',
    targetType: 'all_teams',
    effects: {
      money: 1000,
      marketShare: 1.0,
      technology: 3,
      reputation: 5,
      monopolyRisk: 2,
    },
    narrationKey: 'event_trade_agreement',
    probability: 0.10,
  },
  {
    id: 'boycott',
    title: 'Tẩy chay từ người tiêu dùng',
    description: 'Một làn sóng tẩy chay nổ ra nhắm vào đội có uy tín thương hiệu thấp nhất thị trường.',
    targetType: 'lowest_reputation_team',
    effects: {
      money: -1000,
      marketShare: -5.0,
      technology: 0,
      reputation: -15,
      monopolyRisk: -5,
    },
    narrationKey: 'event_boycott',
    probability: 0.05,
  },
];

/**
 * Deterministically checks if an event triggers (60% chance) and returns the selected GameEvent.
 * Uses a seeded RNG.
 */
export function maybeGenerateEvent(round: number, rng: SeededRNG): GameEvent | null {
  const triggered = rng.next() < 0.6;
  if (!triggered) {
    return null;
  }

  const roll = rng.next();
  let cumulative = 0;

  for (const item of eventPool) {
    cumulative += item.probability;
    if (roll < cumulative) {
      let scope: 'all' | 'specific' | 'random' = 'specific';
      if (item.targetType === 'all_teams') {
        scope = 'all';
      } else if (item.targetType === 'random_team' || item.targetType === 'random_three_teams') {
        scope = 'random';
      }

      return {
        id: item.id,
        type: item.id,
        titleVi: item.title,
        descriptionVi: item.description,
        effects: { ...item.effects },
        scope,
      };
    }
  }

  // Fallback to first event if rounding errors occur
  const first = eventPool[0]!;
  return {
    id: first.id,
    type: first.id,
    titleVi: first.title,
    descriptionVi: first.description,
    effects: { ...first.effects },
    scope: 'all',
  };
}

/**
 * Resolves which teams are targeted based on the targetType.
 * Always returns deterministic results (stable sorting / seeded RNG).
 */
export function resolveTargets(
  targetType: string,
  teams: InMemoryTeamState[],
  rng?: SeededRNG
): InMemoryTeamState[] {
  if (teams.length === 0) {
    return [];
  }

  switch (targetType) {
    case 'all_teams':
      return teams;

    case 'random_team': {
      if (!rng) {
        throw new Error('SeededRNG is required for random target selection.');
      }
      // Sort teams by id to make sure the order is stable before selecting
      const stableTeams = [...teams].sort((a, b) => a.id.localeCompare(b.id));
      const index = rng.nextInt(0, stableTeams.length - 1);
      const selected = stableTeams[index];
      return selected ? [selected] : [];
    }

    case 'random_three_teams': {
      if (!rng) {
        throw new Error('SeededRNG is required for random target selection.');
      }
      // Sort teams by id to make sure the order is stable before shuffling
      const stableTeams = [...teams].sort((a, b) => a.id.localeCompare(b.id));
      const shuffled = rng.shuffle(stableTeams);
      return shuffled.slice(0, 3);
    }

    case 'richest_team': {
      const sorted = [...teams].sort((a, b) => {
        if (b.money !== a.money) {
          return b.money - a.money;
        }
        return a.teamNumber - b.teamNumber; // stable tie-breaker
      });
      const selected = sorted[0];
      return selected ? [selected] : [];
    }

    case 'weakest_team': {
      const sorted = [...teams].sort((a, b) => {
        if (a.money !== b.money) {
          return a.money - b.money;
        }
        return a.teamNumber - b.teamNumber; // stable tie-breaker
      });
      const selected = sorted[0];
      return selected ? [selected] : [];
    }

    case 'highest_market_share': {
      const sorted = [...teams].sort((a, b) => {
        if (b.marketShare !== a.marketShare) {
          return b.marketShare - a.marketShare;
        }
        return a.teamNumber - b.teamNumber; // stable tie-breaker
      });
      const selected = sorted[0];
      return selected ? [selected] : [];
    }

    case 'lowest_market_share': {
      const sorted = [...teams].sort((a, b) => {
        if (a.marketShare !== b.marketShare) {
          return a.marketShare - b.marketShare;
        }
        return a.teamNumber - b.teamNumber; // stable tie-breaker
      });
      const selected = sorted[0];
      return selected ? [selected] : [];
    }

    case 'highest_monopoly_risk': {
      const sorted = [...teams].sort((a, b) => {
        if (b.monopolyRisk !== a.monopolyRisk) {
          return b.monopolyRisk - a.monopolyRisk;
        }
        return a.teamNumber - b.teamNumber; // stable tie-breaker
      });
      const selected = sorted[0];
      return selected ? [selected] : [];
    }

    case 'lowest_reputation_team': {
      const sorted = [...teams].sort((a, b) => {
        if (a.reputation !== b.reputation) {
          return a.reputation - b.reputation;
        }
        return a.teamNumber - b.teamNumber; // stable tie-breaker
      });
      const selected = sorted[0];
      return selected ? [selected] : [];
    }

    default:
      return [];
  }
}

/**
 * Calculates effects of the event on the teams.
 * Returns a Map of TeamId -> StatsDelta.
 */
export function applyEvent(
  event: GameEvent,
  teams: InMemoryTeamState[],
  rng?: SeededRNG
): Map<string, StatsDelta> {
  const result = new Map<string, StatsDelta>();

  // Find targetType from event pool definition, fallback logically if not found
  const def = eventPool.find((e) => e.id === event.id);
  const targetType = def ? def.targetType : (event.scope === 'all' ? 'all_teams' : 'random_team');

  const targetTeams = resolveTargets(targetType, teams, rng);
  const targetIds = new Set(targetTeams.map((t) => t.id));

  for (const team of teams) {
    if (targetIds.has(team.id)) {
      result.set(team.id, {
        money: event.effects.money,
        marketShare: event.effects.marketShare,
        technology: event.effects.technology,
        reputation: event.effects.reputation,
        monopolyRisk: event.effects.monopolyRisk,
      });
    } else {
      result.set(team.id, {
        money: 0,
        marketShare: 0,
        technology: 0,
        reputation: 0,
        monopolyRisk: 0,
      });
    }
  }

  return result;
}
