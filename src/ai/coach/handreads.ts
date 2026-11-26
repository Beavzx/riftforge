// COACH: "what could they be holding?" Aggregates many determinizations (src/ai/determinize.ts: the opponent's hidden
// cards are re-dealt uniformly from their known decklist minus every card seen) into per-card and per-category
// probabilities. This is a PRIOR read: it uses the decklist and what has been seen, not the opponent's behaviour
// (passing with mana up, not blocking, ...). That inference would need a learned model.
import type { CardDef, GameState, PlayerId } from '../../engine/types.ts';
import { determinize } from '../determinize.ts';
import { makeRng } from '../../engine/rng.ts';
import analysisJson from '../../../data/card-analysis.json' with { type: 'json' };

export type Category = 'removal' | 'combatTrick' | 'reaction' | 'counter' | 'draw';
export const CATEGORY_LABEL: Record<Category, string> = {
  removal: 'removal (kill / damage / bounce / banish / stun / Might reduction)',
  combatTrick: 'combat trick (Action/Reaction-speed buff or ready)',
  reaction: 'Reaction-speed card (can answer on your turn)',
  counter: 'counterspell',
  draw: 'card draw',
};

interface Analysis { abilities?: { kind?: string; patterns?: string[]; trigger?: { clause?: string }; targets?: { filter?: string }[] }[] }
const ANALYSIS = analysisJson as unknown as Record<string, Analysis>;

const REMOVAL = new Set(['effect:kill', 'effect:deal-damage', 'effect:deal-damage-variable', 'effect:banish', 'effect:return-to-hand', 'effect:might-minus', 'effect:stun', 'effect:fight', 'effect:recall']);
const TRICK = new Set(['effect:might-plus', 'effect:buff', 'effect:grant-keyword', 'effect:ready', 'effect:heal']);

const catCache = new Map<string, Category[]>();
/**
 * Categories of a card, from data/card-analysis.json patterns + keywords. Heuristic: a spell (or a unit/gear's
 * "when you play me" trigger) with a removal effect is removal; an Action/Reaction spell that buffs/readies is a trick.
 */
export function categoriesOf(def: CardDef | undefined): Category[] {
  if (!def) return [];
  const hit = catCache.get(def.id);
  if (hit) return hit;
  const kws = (def.keywords ?? []).map(k => k.split(' ')[0]);
  const fast = kws.includes('Action') || kws.includes('Reaction');
  const pats = new Set<string>(), playPats = new Set<string>();
  let removalHere = false;
  for (const ab of ANALYSIS[def.id]?.abilities ?? []) {
    const onPlay = ab.kind === 'triggered' && /play me/i.test(ab.trigger?.clause ?? '');
    for (const p of ab.patterns ?? []) { pats.add(p); if (onPlay) playPats.add(p); }
    // removal = a removal effect that can hit an enemy (not "kill a friendly unit" sacrifice effects)
    const tg = ab.targets ?? [];
    const friendlyOnly = tg.length > 0 && tg.every(t => /\|friendly/.test(t.filter ?? ''));
    if ((def.type === 'Spell' || onPlay) && !friendlyOnly && (ab.patterns ?? []).some(p => REMOVAL.has(p))) removalHere = true;
  }
  const has = (set: Set<string>, from: Set<string>) => [...from].some(p => set.has(p));
  const out: Category[] = [];
  const effects = def.type === 'Spell' ? pats : playPats;
  if (removalHere) out.push('removal');
  if (def.type === 'Spell' && fast && has(TRICK, pats)) out.push('combatTrick');
  if (kws.includes('Reaction')) out.push('reaction');
  if (pats.has('effect:counter')) out.push('counter');
  if (has(new Set(['effect:draw']), effects)) out.push('draw');
  catCache.set(def.id, out);
  return out;
}

export interface CardRead { cardId: string; name: string; pAtLeastOne: number; expected: number; categories: Category[] }
export interface HandReads {
  opponent: PlayerId;
  handSize: number;
  facedown: number;
  samples: number;
  /** distinct cards in the opponent's unseen pool, most likely first */
  cards: CardRead[];
  /** probability the hand holds at least one card of each category */
  categories: { category: Category; label: string; pAtLeastOne: number }[];
  note: string;
}

/** Sample `samples` determinizations from p's point of view and aggregate the opponent's hand. Never mutates g. */
export function handReads(g: GameState, p: PlayerId, samples = 200, seed = 7): HandReads {
  const q = (g.players.find(x => x.id !== p)?.id ?? (1 - p)) as PlayerId;
  const rng = makeRng(seed);
  const n = g.players[q].hand.length;
  const counts = new Map<string, number[]>();   // cardId -> per-sample counts (sparse: total + hits)
  const cardHits = new Map<string, number>(), cardTotal = new Map<string, number>();
  const catHits = new Map<Category, number>();
  let ok = 0;
  for (let i = 0; i < samples; i++) {
    let det: GameState;
    try { det = determinize(g, p, rng); } catch { continue; }
    ok++;
    const seen = new Set<string>(), cats = new Set<Category>();
    for (const id of det.players[q].hand) {
      const cid = det.objects[id]?.cardId;
      if (!cid) continue;
      cardTotal.set(cid, (cardTotal.get(cid) ?? 0) + 1);
      seen.add(cid);
      for (const c of categoriesOf(det.cards[cid])) cats.add(c);
    }
    for (const cid of seen) cardHits.set(cid, (cardHits.get(cid) ?? 0) + 1);
    for (const c of cats) catHits.set(c, (catHits.get(c) ?? 0) + 1);
  }
  void counts;
  const cards: CardRead[] = [...cardTotal.keys()].map(cid => ({
    cardId: cid, name: g.cards[cid]?.name ?? cid,
    pAtLeastOne: ok ? (cardHits.get(cid) ?? 0) / ok : 0,
    expected: ok ? (cardTotal.get(cid) ?? 0) / ok : 0,
    categories: categoriesOf(g.cards[cid]),
  })).sort((a, b) => b.pAtLeastOne - a.pAtLeastOne || a.name.localeCompare(b.name));
  const categories = (Object.keys(CATEGORY_LABEL) as Category[]).map(c => ({ category: c, label: CATEGORY_LABEL[c], pAtLeastOne: ok ? (catHits.get(c) ?? 0) / ok : 0 }));
  const facedown = Object.values(g.objects).filter(o => o.zone === 'facedown' && o.controller === q).length;
  return { opponent: q, handSize: n, facedown, samples: ok, cards, categories,
    note: 'Prior read from the known decklist minus cards seen (uniform over unseen cards); it does not yet use how the opponent has played.' };
}
