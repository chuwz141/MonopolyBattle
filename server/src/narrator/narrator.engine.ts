import { SeededRNG } from '../utils/random.js';
import {
  loadTemplatesFile,
  selectTemplate,
  replaceVariables,
  Template
} from './template.system.js';

export interface NarratorMessage {
  text: string;
  type: 'info' | 'warning' | 'education';
  relatedConcept?: string;
}

export class NarratorEngine {
  private decisionsTemplates: Record<string, Template[]>;
  private eventsTemplates: Record<string, Template[]>;
  private monopolyTemplates: Record<string, Template[]>;
  private educationTemplates: Record<string, Template[]>;
  private summaryTemplates: Record<string, Template[]>;
  
  private recentUsedIds: string[] = [];

  constructor() {
    this.decisionsTemplates = loadTemplatesFile('decisions.json');
    this.eventsTemplates = loadTemplatesFile('events.json');
    this.monopolyTemplates = loadTemplatesFile('monopoly.json');
    this.educationTemplates = loadTemplatesFile('education.json');
    this.summaryTemplates = loadTemplatesFile('round-summary.json');
  }

  private trackUsed(id: string): void {
    this.recentUsedIds.push(id);
    // Keep sliding window size of 20 to avoid repetitions
    if (this.recentUsedIds.length > 20) {
      this.recentUsedIds.shift();
    }
  }

  /**
   * Generates a narration for a team's decision.
   */
  public generateDecisionNarration(
    team: { name: string; marketShare: number; technology: number; reputation: number; monopolyRisk: number },
    decisionType: string,
    rng: SeededRNG
  ): NarratorMessage {
    const list = this.decisionsTemplates[decisionType];
    if (!list || list.length === 0) {
      return {
        text: `Đội ${team.name} đã thực hiện hành động ${decisionType}.`,
        type: 'info'
      };
    }

    const tpl = selectTemplate(list, team, this.recentUsedIds, rng);
    this.trackUsed(tpl.id);

    const text = replaceVariables(tpl.text, {
      team: team.name,
      money: '',
      marketShare: team.marketShare,
      technology: team.technology,
      reputation: team.reputation
    });

    return {
      text,
      type: tpl.type,
      ...(tpl.relatedConcept ? { relatedConcept: tpl.relatedConcept } : {})
    };
  }

  /**
   * Generates a narration for a random event trigger.
   */
  public generateEventNarration(
    event: { type: string; titleVi: string; descriptionVi: string },
    targetTeam: { name: string; marketShare: number; technology: number; reputation: number; monopolyRisk: number } | null,
    rng: SeededRNG
  ): NarratorMessage {
    const list = this.eventsTemplates[event.type];
    if (!list || list.length === 0) {
      return {
        text: `Sự kiện: ${event.descriptionVi}`,
        type: 'info'
      };
    }

    const tpl = selectTemplate(list, targetTeam, this.recentUsedIds, rng);
    this.trackUsed(tpl.id);

    const text = replaceVariables(tpl.text, {
      event: event.titleVi,
      team: targetTeam?.name || ''
    });

    return {
      text,
      type: tpl.type,
      ...(tpl.relatedConcept ? { relatedConcept: tpl.relatedConcept } : {})
    };
  }

  /**
   * Generates a narration for a monopoly warning/intervention.
   */
  public generateMonopolyNarration(
    monopolyResult: { dominantTeamName: string; monopolyType: string; explanation?: string },
    team: { marketShare: number; technology: number; reputation: number; monopolyRisk: number } | null,
    rng: SeededRNG
  ): NarratorMessage {
    const list = this.monopolyTemplates[monopolyResult.monopolyType];
    if (!list || list.length === 0) {
      return {
        text: monopolyResult.explanation || `Cảnh báo độc quyền phát hiện đối với đội ${monopolyResult.dominantTeamName}.`,
        type: 'warning'
      };
    }

    const tpl = selectTemplate(list, team, this.recentUsedIds, rng);
    this.trackUsed(tpl.id);

    const text = replaceVariables(tpl.text, {
      team: monopolyResult.dominantTeamName,
      marketShare: team?.marketShare || 0,
      monopolyRisk: team?.monopolyRisk || 0
    });

    return {
      text,
      type: tpl.type,
      ...(tpl.relatedConcept ? { relatedConcept: tpl.relatedConcept } : {})
    };
  }

  /**
   * Generates a general round completion summary.
   */
  public generateRoundSummary(roundNumber: number, rng: SeededRNG): NarratorMessage {
    const list = this.summaryTemplates['general'];
    if (!list || list.length === 0) {
      return {
        text: `Vòng ${roundNumber} kết thúc.`,
        type: 'info'
      };
    }

    const tpl = selectTemplate(list, null, this.recentUsedIds, rng);
    this.trackUsed(tpl.id);

    const text = replaceVariables(tpl.text, {
      round: roundNumber
    });

    return {
      text,
      type: tpl.type,
      ...(tpl.relatedConcept ? { relatedConcept: tpl.relatedConcept } : {})
    };
  }

  /**
   * Generates a separate standalone educational message about a theoretical concept.
   */
  public generateEducationalNarration(concept: string, rng: SeededRNG): NarratorMessage | null {
    const list = this.educationTemplates[concept];
    if (!list || list.length === 0) {
      return null;
    }

    const tpl = selectTemplate(list, null, this.recentUsedIds, rng);
    this.trackUsed(tpl.id);

    return {
      text: tpl.text,
      type: 'education',
      ...(tpl.relatedConcept && tpl.relatedConcept.length > 0 ? { relatedConcept: tpl.relatedConcept } : {})
    };
  }
}
