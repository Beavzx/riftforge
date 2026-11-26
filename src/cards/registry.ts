// Card registry: CardId -> CardScript. Cards without a script behave as vanilla
// (keywords parsed from their text by the engine). Alternate-art printings map to the base id
// via data/printings.json (see aliasPrinting).
import type { CardScript, Ability } from '../engine/abilities.ts';
import type { CardId } from '../engine/types.ts';

const scripts = new Map<CardId, CardScript>();
const aliases = new Map<CardId, CardId>();
const grants = new Map<string, Ability>();
export type DelayedDef = Ability;
const delayed = new Map<string, DelayedDef>();

export function registerScript(s: CardScript): void {
  scripts.set(s.id, s);
}

export function registerScripts(list: CardScript[]): void {
  for (const s of list) registerScript(s);
}

export function aliasPrinting(printed: CardId, canonical: CardId): void {
  if (printed !== canonical) aliases.set(printed, canonical);
}

export function getScript(id: CardId): CardScript | undefined {
  return scripts.get(id) ?? (aliases.has(id) ? scripts.get(aliases.get(id)!) : undefined);
}

export function hasScript(id: CardId): boolean {
  return getScript(id) !== undefined;
}

export function allScripts(): CardScript[] {
  return [...scripts.values()];
}

/** Abilities that can be granted to other objects by key (e.g. 'gain:killAtEndOfTurn'). */
export function registerGrant(key: string, ability: Ability): string {
  grants.set(key, ability);
  return key;
}

export function getGrant(key: string): Ability | undefined {
  return grants.get(key);
}

/**
 * Delayed abilities (CR 389) are stored in state as {key, data}; the ability (usually a triggered,
 * replacement, static, costMod or playRule ability) is looked up here. ctx.data holds the data.
 */
export function registerDelayed(key: string, ability: DelayedDef): string {
  delayed.set(key, ability);
  return key;
}

export function getDelayed(key: string): DelayedDef | undefined {
  return delayed.get(key);
}

/** Test helper: remove all scripts registered for ids with a prefix. */
export function unregisterPrefix(prefix: string): void {
  for (const k of [...scripts.keys()]) if (k.startsWith(prefix)) scripts.delete(k);
}
