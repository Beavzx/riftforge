// AI-CORE: state / decision signatures from one player's point of view (transpositions in the turn search, and
// matching a planned line against the real game). Only information visible to `p` is hashed, so a determinized
// state and the real state hash equally while they agree on everything p can see.
import type { Decision, GameState, PlayerId } from '../../engine/types.ts';

function h32(s: string): string {
  let a = 0x811c9dc5, b = 0x12345678;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15); }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

export function stateSig(g: GameState, p: PlayerId): string {
  const parts: string[] = [];
  for (const id in g.objects) {
    const o = g.objects[id];
    const z = o.zone;
    if (z === 'mainDeck' || z === 'runeDeck' || z === 'setAside') continue;
    const visible = z !== 'facedown' && z !== 'hand' ? true : o.controller === p || o.owner === p;
    if (z === 'hand' && o.owner !== p) continue;   // opponent hand: count below
    parts.push(`${id}:${visible ? o.cardId : '?'}:${z}:${o.battlefieldIndex ?? ''}:${o.exhausted ? 1 : 0}:${o.damage}:${o.attachedTo ?? ''}:${o.stunned ? 1 : 0}:${o.controller}:${JSON.stringify(o.counters)}:${o.modifiers.length}`);
  }
  for (const pl of g.players) parts.push(`P${pl.id}:${pl.points}:${pl.hand.length}:${pl.mainDeck.length}:${pl.runeDeck.length}:${JSON.stringify(pl.pool)}:${pl.xp}`);
  for (const b of g.battlefields) parts.push(`B${b.controller}:${b.scoredThisTurnBy.join(',')}`);
  parts.push(`T${g.turn}:${g.activePlayer}:${g.chain.map(c => c.source + c.controller).join(',')}:${g.showdown ? g.showdown.battlefieldIndex : ''}`);
  const d = g.pending;
  if (d) parts.push(decisionSig(d));
  return h32(parts.join('|'));
}

export function decisionSig(d: Decision): string {
  return `${d.kind}:${d.player}:${d.inStep ? 1 : 0}:${d.prompt}:${d.source ?? ''}:${(d.options ?? []).map(o => o.id).join(',')}:${d.min ?? ''}:${d.max ?? ''}`;
}
