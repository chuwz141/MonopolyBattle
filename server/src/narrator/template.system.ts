import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import fs from 'fs';
import { SeededRNG } from '../utils/random.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Template {
  id: string;
  text: string;
  type: 'info' | 'warning' | 'education';
  conditions?: {
    minMarketShare?: number;
    maxMarketShare?: number;
    minMonopolyRisk?: number;
    maxMonopolyRisk?: number;
    minTechnology?: number;
    maxTechnology?: number;
    minReputation?: number;
    maxReputation?: number;
  };
  relatedConcept?: string;
}

/**
 * Returns the absolute template file path, fallback safe for ts-node / dist runtime environments.
 */
export function getTemplatePath(fileName: string): string {
  let p = resolve(__dirname, 'templates', fileName);
  if (fs.existsSync(p)) return p;

  p = resolve(__dirname, '..', '..', 'src', 'narrator', 'templates', fileName);
  if (fs.existsSync(p)) return p;

  p = resolve(process.cwd(), 'src', 'narrator', 'templates', fileName);
  if (fs.existsSync(p)) return p;

  p = resolve(process.cwd(), 'server', 'src', 'narrator', 'templates', fileName);
  if (fs.existsSync(p)) return p;

  return p;
}

/**
 * Validates template structure and returns categories dictionary.
 */
export function validateTemplates(data: any): Record<string, Template[]> {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Templates structure must be a JSON object.');
  }

  const validated: Record<string, Template[]> = {};

  for (const [category, list] of Object.entries(data)) {
    if (!Array.isArray(list)) {
      throw new Error(`Category "${category}" must contain an array of templates.`);
    }

    const categoryTemplates: Template[] = [];

    for (const item of list) {
      if (typeof item !== 'object' || item === null) {
        throw new Error(`Template item in category "${category}" must be an object.`);
      }
      if (typeof item.id !== 'string' || !item.id) {
        throw new Error(`Template in category "${category}" must have a non-empty string "id".`);
      }
      if (typeof item.text !== 'string' || !item.text) {
        throw new Error(`Template in category "${category}" (id: ${item.id}) must have a non-empty string "text".`);
      }
      if (item.type !== 'info' && item.type !== 'warning' && item.type !== 'education') {
        throw new Error(`Template (id: ${item.id}) type must be "info", "warning", or "education".`);
      }

      categoryTemplates.push({
        id: item.id,
        text: item.text,
        type: item.type,
        conditions: item.conditions,
        relatedConcept: item.relatedConcept,
      });
    }

    validated[category] = categoryTemplates;
  }

  return validated;
}

/**
 * Loads a JSON template file securely.
 */
export function loadTemplatesFile(fileName: string): Record<string, Template[]> {
  const filePath = getTemplatePath(fileName);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return validateTemplates(parsed);
  } catch (err: any) {
    throw new Error(`Failed to load and validate template file "${fileName}": ${err.message}`);
  }
}

/**
 * Asserts if a template meets the conditions of the team metrics.
 */
export function evaluateConditions(
  template: Template,
  team: { marketShare: number; monopolyRisk: number; technology: number; reputation: number }
): boolean {
  if (!template.conditions) {
    return true;
  }

  const cond = template.conditions;
  if (cond.minMarketShare !== undefined && team.marketShare < cond.minMarketShare) return false;
  if (cond.maxMarketShare !== undefined && team.marketShare > cond.maxMarketShare) return false;
  if (cond.minMonopolyRisk !== undefined && team.monopolyRisk < cond.minMonopolyRisk) return false;
  if (cond.maxMonopolyRisk !== undefined && team.monopolyRisk > cond.maxMonopolyRisk) return false;
  if (cond.minTechnology !== undefined && team.technology < cond.minTechnology) return false;
  if (cond.maxTechnology !== undefined && team.technology > cond.maxTechnology) return false;
  if (cond.minReputation !== undefined && team.reputation < cond.minReputation) return false;
  if (cond.maxReputation !== undefined && team.reputation > cond.maxReputation) return false;

  return true;
}

/**
 * Stably selects a template deterministically, bypassing recently used template IDs.
 */
export function selectTemplate(
  templates: Template[],
  team: { marketShare: number; monopolyRisk: number; technology: number; reputation: number } | null,
  recentUsedIds: string[],
  rng: SeededRNG
): Template {
  // 1. Filter by conditions if team stats are provided
  let candidates = team ? templates.filter((t) => evaluateConditions(t, team)) : templates;
  if (candidates.length === 0) {
    candidates = templates;
  }

  // 2. Filter out recently used templates (recency constraint)
  const nonRecent = candidates.filter((t) => !recentUsedIds.includes(t.id));
  const finalCandidates = nonRecent.length > 0 ? nonRecent : candidates;

  // 3. Pick seeded index
  const idx = Math.floor(rng.next() * finalCandidates.length);
  const selected = finalCandidates[idx];
  if (!selected) {
    throw new Error('Template selection returned null.');
  }

  return selected;
}

/**
 * Injects values into double-curly bracket placeholders.
 */
export function replaceVariables(text: string, variables: Record<string, any>): string {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.split(placeholder).join(String(value ?? ''));
  }
  return result;
}
