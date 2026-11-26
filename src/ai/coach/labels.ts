// COACH: human-readable labels for actions and a short situation summary, for reviews a person (and Claude) will read.
// Pure functions of the full game state. Callers decide what may be shown: describeSituation(g, p) only names cards
// that player p can see (own hand, facedown cards p controls, public zones); the opponent's hand is a count.
import type { Action, Decision, GameState, ObjId, PlayerId } from '../../engine/types.ts';
import { chars, abilityByIndex } from '../../engine/chars.ts';

export function cardNameOf(g: GameState, id: ObjId | undefined): string {
  if (!id) return '?';
  const o = g.objects[id];
  if (!o) return id;
  return g.cards[o.cardId]?.name ?? o.cardId;
}

export function bfName(g: GameState, i: number | 'base' | undefined): string {
  if (i === undefined) return 'base';
  if (i === 'base') return 'base';
  const b = g.battlefields[i];
  const n = b ? cardNameOf(g, b.objId) : `battlefield ${i + 1}`;
  return `Battlefield ${i + 1} (${n})`;
}

function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

function runeLabel(g: GameState, id: ObjId): string {
  const o = g.objects[id];
  if (!o) return id;
  const def = g.cards[o.cardId];
  const dom = def?.domains?.[0];
  return dom ? `${dom} rune` : (def?.name ?? 'rune');
}

function paymentLabel(g: GameState, pay: { exhaust: ObjId[]; recycle: ObjId[]; other?: Record<string, unknown> } | undefined): string {
  if (!pay) return '';
  const parts: string[] = [];
  if (pay.exhaust?.length) parts.push(`exhausting ${list(pay.exhaust.map(id => runeLabel(g, id)))}`);
  if (pay.recycle?.length) parts.push(`recycling ${list(pay.recycle.map(id => runeLabel(g, id)))}`);
  if (pay.other && Object.keys(pay.other).length) parts.push('with extra cost choices');
  return parts.length ? `, paying by ${parts.join(' and ')}` : '';
}

/** The text of an activated ability, as the UI shows it (src/ui/board.ts abilityLabel). */
export function abilityText(g: GameState, obj: ObjId, i: number): string {
  if (i === 950) return 'exhaust for 1 Energy';
  if (i === 951) return 'recycle for 1 Power';
  if (i === 900) return 'Equip';
  if (i === 901) return 'Empower';
  let t: string | undefined;
  try {
    const ab = abilityByIndex(g, obj, i)?.ability as { text?: string; label?: string } | undefined;
    t = ab?.text ?? ab?.label;
  } catch { t = undefined; }
  if (!t) {
    const o = g.objects[obj];
    const c = o ? g.cards[o.cardId] : undefined;
    if (!c) return `ability ${i + 1}`;
    const lines = c.text.split('\n').filter(l => /:/.test(l) && !/^\[(Empowered|Level)/.test(l));
    t = lines[i] ?? lines[0] ?? c.text.split('\n')[i];
  }
  if (!t) return `ability ${i + 1}`;
  const clean = t.replace(/\[([^\]]+)\]/g, (_, x: string) => x === 'T' || x === 'E' ? 'Exhaust' : x === 'S' || x === 'M' ? 'Might' : x === 'C' ? 'Power' : /^\d+$/.test(x) ? `(${x})` : x);
  return clean.length > 110 ? clean.slice(0, 107).replace(/\s+\S*$/, '') + '...' : clean;
}

function zoneWord(g: GameState, id: ObjId): string {
  const o = g.objects[id];
  if (!o) return '';
  if (o.zone === 'facedown') return ' (from facedown)';
  if (o.zone === 'championZone') return ' (champion)';
  if (o.zone === 'trash') return ' (from trash)';
  return '';
}

/**
 * A readable label for an action. `d` is the decision it answers (defaults to g.pending), used for 'choose' labels.
 * Examples: "Play Jinx to Battlefield 2 (Zaun Warrens), paying by exhausting Fury rune and Fury rune",
 * "Move Garen and Lux to Battlefield 1 (The Grand Plaza)", "Pass", "Choose: Yes".
 */
export function labelAction(g: GameState, a: Action, d: Decision | null = g.pending): string {
  switch (a.type) {
    case 'playCard': {
      const name = cardNameOf(g, a.obj) + zoneWord(g, a.obj);
      const dest = a.destination === undefined ? '' : a.destination === 'base' ? ' to base' : ` to ${bfName(g, a.destination)}`;
      const extra = [a.mode ? `mode ${a.mode}` : '', a.x !== undefined ? `X=${a.x}` : '', a.hidden ? 'hidden' : ''].filter(Boolean);
      return `Play ${name}${dest}${extra.length ? ` (${extra.join(', ')})` : ''}${paymentLabel(g, a.payment)}`;
    }
    case 'activate':
      if (a.abilityIndex >= 950) return `${a.abilityIndex === 950 ? 'Exhaust' : 'Recycle'} ${runeLabel(g, a.obj)} (${a.abilityIndex === 950 ? '+1 Energy' : '+1 Power'})`;
      return `Activate ${cardNameOf(g, a.obj)}: ${abilityText(g, a.obj, a.abilityIndex)}${paymentLabel(g, a.payment)}`;
    case 'move': return `Move ${list(a.units.map(u => cardNameOf(g, u)))} to ${bfName(g, a.to)}`;
    case 'hide': return `Hide ${cardNameOf(g, a.obj)} facedown at ${bfName(g, a.battlefieldIndex)}${paymentLabel(g, a.payment)}`;
    case 'pass': return d && !d.inStep && d.kind === 'showdownAction' ? 'Pass (no more showdown actions)' : 'Pass';
    case 'endTurn': return 'End turn';
    case 'concede': return 'Concede';
    case 'cancel': return 'Cancel the play';
    case 'assignDamage': {
      const parts = Object.entries(a.assignment).filter(([, n]) => n > 0).map(([id, n]) => `${n} to ${cardNameOf(g, id)}`);
      return `Assign combat damage: ${parts.join(', ') || 'none'}`;
    }
    case 'choose': {
      const opts = d?.options ?? [];
      const names = a.optionIds.map(id => {
        const o = opts.find(x => x.id === id);
        if (o) {
          const objs = o.objIds?.length ? o.objIds.map(x => cardNameOf(g, x)) : [];
          const lbl = o.label && !/^o\d+$/.test(o.label) ? o.label : '';
          if (objs.length && lbl && !objs.every(n => lbl.includes(n))) return `${lbl} [${list(objs)}]`;
          return lbl || list(objs) || id;
        }
        if (g.objects[id]) return cardNameOf(g, id);
        return id;
      });
      const what = d ? decisionWord(d) : 'Choose';
      if (!names.length) return `${what}: none`;
      return `${what}: ${list(names)}`;
    }
  }
}

function decisionWord(d: Decision): string {
  switch (d.kind) {
    case 'mulligan': return 'Mulligan (set aside)';
    case 'chooseTargets': return 'Target';
    case 'chooseMode': return 'Mode';
    case 'optional': return 'Choose';
    case 'payment': return 'Pay with';
    case 'orderTriggers': return 'Trigger order';
    case 'chooseCards': return 'Choose cards';
    case 'chooseBattlefield': return 'Battlefield';
    case 'chooseDestination': return 'Destination';
    default: return 'Choose';
  }
}

function mightOf(g: GameState, id: ObjId): number | null {
  try { return chars(g, id).might ?? null; } catch { return null; }
}

function unitList(g: GameState, ids: ObjId[]): string {
  return ids.map(id => {
    const o = g.objects[id];
    const m = mightOf(g, id);
    const flags = [o.exhausted ? 'exhausted' : '', o.stunned ? 'stunned' : '', o.damage ? `${o.damage} dmg` : ''].filter(Boolean);
    return `${cardNameOf(g, id)}${m !== null ? ` ${m}` : ''}${flags.length ? ` (${flags.join(', ')})` : ''}`;
  }).join(', ') || 'none';
}

/** A short, multi-line description of the position from player p's point of view (only what p can see). */
export function describeSituation(g: GameState, p: PlayerId): string {
  const q = (1 - p) as PlayerId;
  const me = g.players[p], op = g.players[q];
  const lines: string[] = [];
  const whose = g.activePlayer === p ? 'your turn' : "opponent's turn";
  const d = g.pending;
  lines.push(`Turn ${g.turn} (${whose}), phase ${g.phase}${d ? `, deciding: ${d.kind}${d.prompt ? ` - "${d.prompt}"` : ''}` : ''}.`);
  lines.push(`Points: you ${me.points}, opponent ${op.points}. Runes in play: you ${me.runesInPlay.length} (${me.runesInPlay.filter(r => !g.objects[r]?.exhausted).length} ready), opponent ${op.runesInPlay.length}.`);
  lines.push(`Your hand: ${me.hand.map(id => cardNameOf(g, id)).join(', ') || 'empty'}. Opponent hand: ${op.hand.length} cards. Decks: you ${me.mainDeck.length}, opponent ${op.mainDeck.length}.`);
  const atBase = (pl: PlayerId) => Object.values(g.objects).filter(o => o.zone === 'base' && o.controller === pl && !o.attachedTo && safeType(g, o.id) === 'Unit').map(o => o.id);
  lines.push(`Base units: you ${unitList(g, atBase(p))}; opponent ${unitList(g, atBase(q))}.`);
  g.battlefields.forEach((b, i) => {
    const here = Object.values(g.objects).filter(o => o.zone === 'battlefield' && o.battlefieldIndex === i && !o.attachedTo && o.id !== b.objId && safeType(g, o.id) !== 'Battlefield');
    const mine = here.filter(o => o.controller === p).map(o => o.id), theirs = here.filter(o => o.controller === q).map(o => o.id);
    const fd = Object.values(g.objects).filter(o => o.zone === 'facedown' && o.battlefieldIndex === i);
    const fdTxt = fd.length ? `; facedown: ${fd.map(o => o.controller === p ? `your ${cardNameOf(g, o.id)}` : 'opponent card').join(', ')}` : '';
    const ctl = b.controller === null ? 'uncontrolled' : b.controller === p ? 'you control' : 'opponent controls';
    lines.push(`${bfName(g, i)}: ${ctl}${b.contested ? ', contested' : ''}. You: ${unitList(g, mine)}. Opponent: ${unitList(g, theirs)}${fdTxt}.`);
  });
  if (g.chain.length) lines.push(`Chain (top last): ${g.chain.map(c => `${c.controller === p ? 'your' : 'their'} ${c.label ?? cardNameOf(g, c.source)}`).join(' > ')}.`);
  if (g.showdown) lines.push(`${g.showdown.isCombat ? 'Combat' : 'Showdown'} at ${bfName(g, g.showdown.battlefieldIndex)}.`);
  return lines.join('\n');
}

function safeType(g: GameState, id: ObjId): string | undefined {
  try { return chars(g, id).type; } catch { return g.cards[g.objects[id]?.cardId]?.type; }
}
