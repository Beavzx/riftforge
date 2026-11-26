// ENCODE: observation encoder for an entity-set (transformer) policy/value network.
//
// encodeObservation(state, player) reads the raw GameState for speed, but only what `player` may know:
// - visibility is exactly hiddenIdsFor() (the same rule getView uses for redaction)
// - hidden objects contribute only public facts: counts per zone, and the multiset of each player's unseen cards
//   (open decklists: decklist minus everything seen, as src/ai/determinize.ts assumes)
// - while an opponent may still cancel a play in progress, the pre-play board is encoded (as getView does)
// Invariant (tests/ai/encode/leak.test.ts): encodeObservation(determinize(state, p, r), p) is identical for every r.
//
// Output is compact (nEntities rows, no padding). The network side pads/masks per batch (see python/riftnet).
import type { Action, Decision, DecisionKind, GameObject, GameState, ObjId, Phase, PlayerId, ZoneKind } from '../../engine/types.ts';
import { hiddenIdsFor } from '../../engine/hidden-ids.ts';
import { chars, withCharsMemo } from '../../engine/chars.ts';
import { cancelBase } from '../../engine/cancel.ts';
import { effectivePlayCost } from '../../engine/play.ts';
import { cardIdxOf, CARD_TYPES, DOMAINS, KEYWORDS, UNKNOWN_IDX } from './cards.ts';

export const ENCODER_VERSION = 1;
export const MAX_ENTITIES = 192;
export const MAX_BF = 4;   // battlefield slots encoded (1v1 uses 2-3)

export const ZONES: ZoneKind[] = ['mainDeck', 'runeDeck', 'hand', 'base', 'battlefield', 'trash', 'banishment', 'legendZone',
  'championZone', 'runePool', 'chain', 'facedown', 'setAside'];
export const PHASES: Phase[] = ['setup', 'mulligan', 'awaken', 'beginning', 'channel', 'draw', 'action', 'end', 'gameOver'];
export const DECISION_KINDS: DecisionKind[] = ['mulligan', 'mainAction', 'showdownAction', 'chainResponse', 'chooseTargets',
  'chooseMode', 'chooseX', 'optional', 'payment', 'orderTriggers', 'assignDamage', 'chooseBattlefield', 'chooseCards',
  'chooseUnitsToMove', 'chooseDestination', 'chooseNumber', 'confirm', 'chooseOrder', 'chooseShowdown', 'chooseOpponent'];
export const ENTITY_KINDS = ['object', 'chainItem', 'unseen'] as const;
const CHAIN_KINDS = ['spell', 'ability', 'trigger'] as const;
const HINTS = ['harm', 'help', 'neutral'] as const;

// ---------------- feature layouts (names double as the schema) ----------------
function layout(names: string[]): { names: string[]; at: Record<string, number>; dim: number } {
  const at: Record<string, number> = {};
  names.forEach((n, i) => { if (n in at) throw new Error(`duplicate feature ${n}`); at[n] = i; });
  return { names, at, dim: names.length };
}

const perPlayerGlobal = (who: string) => [
  `${who}:points`, `${who}:toWin`, `${who}:hand`, `${who}:mainDeck`, `${who}:runeDeck`, `${who}:runesInPlay`, `${who}:runesReady`,
  `${who}:trash`, `${who}:banishment`, `${who}:baseUnits`, `${who}:bfUnits`, `${who}:facedown`, `${who}:xp`, `${who}:turnsTaken`,
  `${who}:energy`, ...DOMAINS.map(d => `${who}:power:${d}`), `${who}:restricted`, `${who}:unseen`,
  ...DOMAINS.map(d => `${who}:runeDeck:${d}`), `${who}:mulliganDone`, `${who}:legendExhausted`,
];
export const GLOBAL = layout([
  'myTurn', 'iAmFirst', 'turn', 'victoryScore',
  ...PHASES.map(p => `phase:${p}`),
  'pending:mine', 'pending:none', ...DECISION_KINDS.map(k => `pending:${k}`), 'pending:inStep', 'pending:min', 'pending:max',
  'pending:nOptions', ...HINTS.map(h => `pending:hint:${h}`), 'pending:hasSource', 'pending:canCancel',
  'showdown:active', 'showdown:combat', 'showdown:closing', 'showdown:focusMe', 'showdown:iAttack', 'showdown:iDefend',
  ...Array.from({ length: MAX_BF }, (_, i) => `showdown:bf${i}`), 'showdown:passedMe', 'showdown:passedOpp',
  'chain:len', 'chain:topMine', 'chain:openerMine', 'chain:passes',
  ...perPlayerGlobal('me'), ...perPlayerGlobal('opp'),
  ...Array.from({ length: MAX_BF }, (_, i) => [`bf${i}:exists`, `bf${i}:mine`, `bf${i}:theirs`, `bf${i}:contested`,
    `bf${i}:scoredMe`, `bf${i}:scoredOpp`, `bf${i}:myUnits`, `bf${i}:oppUnits`, `bf${i}:myMight`, `bf${i}:oppMight`]).flat(),
  'entitiesTruncated',
]);

export const ENTITY = layout([
  ...ENTITY_KINDS.map(k => `kind:${k}`), 'known',
  ...ZONES.map(z => `zone:${z}`),
  'ownerMe', 'controllerMe', 'loc:base', ...Array.from({ length: MAX_BF }, (_, i) => `loc:bf${i}`),
  'exhausted', 'faceDown', 'damage', 'stunned', 'empowered', 'enteredThisTurn', 'movedThisTurn', 'isToken', 'attached',
  'attachments', 'attacker', 'defender', 'playedFromHidden', 'hiddenPlayable', 'revealed',
  'counter:buff', 'counter:xp', 'counter:other', 'modifiers',
  'hasChars', 'might', 'mightDelta', 'mightLeft', 'lethal', ...KEYWORDS.map(k => `kw:${k}`),
  ...CARD_TYPES.map(t => `curType:${t}`), 'untargetable', 'grants',
  'cost:energy', 'cost:power', 'cost:known',
  'chain:on', 'chain:pos', 'chain:fromTop', 'chain:mine', ...CHAIN_KINDS.map(k => `chain:${k}`), 'chain:pendingItem', 'chain:targets',
  'bf:card', 'bf:mine', 'bf:theirs', 'bf:contested', 'bf:contestedByMe', 'bf:scoredMe', 'bf:scoredOpp', 'bf:ownerMe',
  'bf:myUnits', 'bf:oppUnits', 'bf:myFacedown', 'bf:oppFacedown',
  'unseen:count',
  'opt:inMyDecision', 'opt:isSource', 'order',
]);

export interface Observation {
  version: number;
  player: PlayerId;
  global: Float32Array;          // GLOBAL.dim
  nEntities: number;
  entities: Float32Array;        // nEntities * ENTITY.dim (row-major)
  cardIdx: Int32Array;           // nEntities: index into the static card table / embedding (0 pad, 1 unknown)
  /** pointer map: objId -> entity row (only visible objects; hidden objects have no row) */
  entityOf: Map<ObjId, number>;
  /** chain item id -> entity row (abilities/triggers; spells point at their object row) */
  chainEntityOf: Map<string, number>;
  /** battlefield slot -> entity row of the battlefield card */
  bfEntity: number[];
}

/** The state `player` actually observes (UI-CANCEL: the pre-play board while an opponent can still cancel). */
export function observedState(state: GameState, player: PlayerId): { g: GameState; pending: Decision | null } {
  const cf = state.ex.cancelFor;
  if (cf !== undefined && cf !== player && state.pending?.inStep && state.ex.unit) {
    const g = cancelBase(state);
    return { g, pending: { kind: state.pending.kind, player: state.pending.player, prompt: '', inStep: true } };
  }
  const pd = state.pending;
  return { g: state, pending: pd && pd.player !== player ? { kind: pd.kind, player: pd.player, prompt: '', inStep: pd.inStep } : pd };
}

const SCRATCH = new Float32Array(MAX_ENTITIES * ENTITY.dim);
const ZONE_AT = Object.fromEntries(ZONES.map(z => [z, ENTITY.at[`zone:${z}`]])) as Record<ZoneKind, number>;
const LOC_AT = Array.from({ length: MAX_BF }, (_, i) => ENTITY.at[`loc:bf${i}`]);
const KW_AT: Record<string, number> = Object.fromEntries(KEYWORDS.map(k => [k, ENTITY.at[`kw:${k}`]]));
const TYPE_AT: Record<string, number> = Object.fromEntries(CARD_TYPES.map(t => [t, ENTITY.at[`curType:${t}`]]));

const clip = (x: number, hi: number) => (x > hi ? hi : x < -hi ? -hi : x) / hi;

export function encodeObservation(state: GameState, player: PlayerId, opts: { costs?: boolean } = {}): Observation {
  const { g, pending } = observedState(state, player);
  return withCharsMemo(g, () => encodeInner(g, player, pending, opts.costs !== false));
}

function encodeInner(g: GameState, me: PlayerId, pending: Decision | null, withCosts: boolean): Observation {
  const hidden = hiddenIdsFor(g, me);
  const F = ENTITY.dim, EA = ENTITY.at;
  SCRATCH.fill(0);
  const rows = { length: 0 }; const idxs: number[] = [];
  const entityOf = new Map<ObjId, number>(); const chainEntityOf = new Map<string, number>();
  const bfEntity: number[] = Array(MAX_BF).fill(-1);
  const isMe = (pl: PlayerId | null | undefined) => pl === me;
  const myOpts = new Set<ObjId>();
  if (pending && pending.player === me) for (const o of pending.options ?? []) for (const id of o.objIds ?? []) myOpts.add(id);
  const pendSource = pending?.player === me ? pending.source : undefined;
  const bfObj = new Map<ObjId, number>(); g.battlefields.forEach((b, i) => bfObj.set(b.objId, i));
  const revealed = new Set(g.ex.revealed);

  // per-battlefield tallies (visible facts only; facedown counts are public)
  const nb = g.battlefields.length;
  const tally = Array.from({ length: Math.max(nb, MAX_BF) }, () => ({ myU: 0, opU: 0, myM: 0, opM: 0, myF: 0, opF: 0 }));
  const all = Object.values(g.objects);
  const byZone = new Map<ZoneKind, GameObject[]>();
  const zc = new Map<string, number>();
  const attachN = new Map<ObjId, number>();
  for (const o of all) {
    const id = o.id;
    let zl = byZone.get(o.zone); if (!zl) byZone.set(o.zone, zl = []); zl.push(o);
    const zk = o.zone + o.controller; zc.set(zk, (zc.get(zk) ?? 0) + 1);
    if (o.attachedTo) attachN.set(o.attachedTo, (attachN.get(o.attachedTo) ?? 0) + 1);
    const bi = o.battlefieldIndex;
    if (bi === undefined || bi >= tally.length) continue;
    if (o.zone === 'facedown') { if (isMe(o.controller)) tally[bi].myF++; else tally[bi].opF++; }
    else if (o.zone === 'battlefield' && !bfObj.has(id) && !hidden.has(id)) {
      let isU = false, m = 0;
      try { const c = chars(g, id); isU = c.type === 'Unit'; m = Math.max(0, c.might ?? 0); } catch { /* ignore */ }
      if (!isU) continue;
      if (isMe(o.controller)) { tally[bi].myU++; tally[bi].myM += m; } else { tally[bi].opU++; tally[bi].opM += m; }
    }
  }

  const chainPosOf = new Map<ObjId, number>();
  g.chain.forEach((it, i) => { if (it.kind === 'spell') chainPosOf.set(it.source, i); });

  const addObject = (o: GameObject) => {
    if (rows.length >= MAX_ENTITIES || entityOf.has(o.id)) return;
    const r = SCRATCH.subarray(rows.length * F, (rows.length + 1) * F);
    const known = !hidden.has(o.id);
    r[EA['kind:object']] = 1; r[EA.known] = known ? 1 : 0;
    r[ZONE_AT[o.zone]] = 1;
    r[EA.ownerMe] = isMe(o.owner) ? 1 : 0; r[EA.controllerMe] = isMe(o.controller) ? 1 : 0;
    if (o.zone === 'base') r[EA['loc:base']] = 1;
    if ((o.zone === 'battlefield' || o.zone === 'facedown') && o.battlefieldIndex !== undefined && o.battlefieldIndex < MAX_BF) r[LOC_AT[o.battlefieldIndex]] = 1;
    r[EA.exhausted] = o.exhausted ? 1 : 0; r[EA.faceDown] = o.faceDown ? 1 : 0;
    if (known) {
      r[EA.damage] = clip(o.damage, 10); r[EA.stunned] = o.stunned ? 1 : 0; r[EA.empowered] = clip(o.empowered ?? 0, 3);
      r[EA.enteredThisTurn] = o.enteredThisTurn ? 1 : 0; r[EA.movedThisTurn] = o.movedThisTurn ? 1 : 0;
      r[EA.isToken] = o.isToken ? 1 : 0; r[EA.attached] = o.attachedTo ? 1 : 0; r[EA.attachments] = clip(attachN.get(o.id) ?? 0, 4);
      r[EA.attacker] = o.combatRole === 'attacker' ? 1 : 0; r[EA.defender] = o.combatRole === 'defender' ? 1 : 0;
      r[EA.playedFromHidden] = o.playedFromHidden ? 1 : 0;
      r[EA.hiddenPlayable] = o.zone === 'facedown' && o.hiddenTurn !== undefined && o.hiddenTurn < g.turn ? 1 : 0;
      r[EA.revealed] = revealed.has(o.id) ? 1 : 0;
      let other = 0; for (const k in o.counters) if (k !== 'buff' && k !== 'xp') other += o.counters[k] ?? 0;
      r[EA['counter:buff']] = clip(o.counters.buff ?? 0, 5); r[EA['counter:xp']] = clip(o.counters.xp ?? 0, 10);
      r[EA['counter:other']] = clip(other, 10); r[EA.modifiers] = clip(o.modifiers.length, 8);
      const charsZone = o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone' || o.zone === 'chain' || o.zone === 'championZone' || o.zone === 'facedown';
      if (charsZone) {
        try {
          const c = chars(g, o.id); const d = g.cards[o.cardId];
          r[EA.hasChars] = 1;
          if (c.might !== null) {
            r[EA.might] = clip(c.might, 12); r[EA.mightDelta] = clip(c.might - (d?.might ?? 0), 6);
            r[EA.mightLeft] = clip(c.might - o.damage, 12); r[EA.lethal] = c.might - o.damage <= 0 ? 1 : 0;
          }
          for (const [k, v] of c.keywords) { const at = KW_AT[k]; if (at !== undefined && v) r[at] = Math.min(v, 10) / 5; }
          r[TYPE_AT[c.type] ?? TYPE_AT.Token] = 1;
          r[EA.untargetable] = c.cantBeChosenByEnemy ? 1 : 0; r[EA.grants] = clip(c.grants.length, 4);
        } catch { /* chars can throw on odd transient objects */ }
      }
      if (withCosts && isMe(o.owner) && (o.zone === 'hand' || o.zone === 'championZone')) {
        try { const c = effectivePlayCost(g, me, o.id); if (c) { r[EA['cost:energy']] = clip(c.energy, 12); r[EA['cost:power']] = clip(c.power.length, 4); r[EA['cost:known']] = 1; } } catch { /* ignore */ }
      }
      const cp = chainPosOf.get(o.id);
      if (cp !== undefined) setChain(r, cp, g.chain[cp]);
      const bi = bfObj.get(o.id);
      if (bi !== undefined) {
        const b = g.battlefields[bi]; const t = tally[bi];
        r[EA['bf:card']] = 1; r[EA['bf:mine']] = isMe(b.controller) ? 1 : 0; r[EA['bf:theirs']] = b.controller !== null && !isMe(b.controller) ? 1 : 0;
        r[EA['bf:contested']] = b.contested ? 1 : 0; r[EA['bf:contestedByMe']] = isMe(b.contestedBy) ? 1 : 0;
        r[EA['bf:scoredMe']] = b.scoredThisTurnBy.includes(me) ? 1 : 0; r[EA['bf:scoredOpp']] = b.scoredThisTurnBy.some(x => x !== me) ? 1 : 0;
        r[EA['bf:ownerMe']] = isMe(b.owner) ? 1 : 0;
        r[EA['bf:myUnits']] = clip(t.myU, 6); r[EA['bf:oppUnits']] = clip(t.opU, 6); r[EA['bf:myFacedown']] = clip(t.myF, 3); r[EA['bf:oppFacedown']] = clip(t.opF, 3);
        if (bi < MAX_BF) bfEntity[bi] = rows.length;
      }
      r[EA['opt:inMyDecision']] = myOpts.has(o.id) ? 1 : 0; r[EA['opt:isSource']] = pendSource === o.id ? 1 : 0;
    }
    r[EA.order] = clip(rows.length, MAX_ENTITIES);
    entityOf.set(o.id, rows.length);
    rows.length++; idxs.push(known ? cardIdxOf(o.cardId) : UNKNOWN_IDX);
  };
  function setChain(r: Float32Array, i: number, it: GameState['chain'][number]) {
    r[EA['chain:on']] = 1; r[EA['chain:pos']] = clip(i, 8); r[EA['chain:fromTop']] = clip(g.chain.length - 1 - i, 8);
    r[EA['chain:mine']] = isMe(it.controller) ? 1 : 0; r[EA[`chain:${it.kind}`]] = 1; r[EA['chain:pendingItem']] = it.pending ? 1 : 0;
    let n = 0; for (const t of it.targets) n += t.length; r[EA['chain:targets']] = clip(n, 4);
  }
  const zoneCount = (pl: PlayerId, z: ZoneKind) => zc.get(z + pl) ?? 0;
  const byTs = (a: GameObject, b: GameObject) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : 1);
  for (const zl of byZone.values()) zl.sort(byTs);
  const inZone = (z: ZoneKind) => byZone.get(z) ?? [];
  const objs = (pred: (o: GameObject) => boolean) => all.filter(pred).sort(byTs);
  const visible = (o: GameObject) => !hidden.has(o.id);
  const opp = (pl: PlayerId) => !isMe(pl);

  // 1. battlefields (slot order), legends, champion zones
  g.battlefields.forEach(b => { const o = g.objects[b.objId]; if (o) addObject(o); });
  for (const pl of [me, ...g.players.map(p => p.id).filter(opp)]) {
    const P = g.players[pl]; const L = g.objects[P.legend]; if (L) addObject(L);
    for (const id of P.championZone) if (g.objects[id] && visible(g.objects[id])) addObject(g.objects[id]);
  }
  // 2. board: battlefield units / gear (slot, then timestamp), facedown (hidden ones as unknown), base
  for (const o of inZone('battlefield')) if (!bfObj.has(o.id)) addObject(o);
  for (const o of inZone('facedown')) addObject(o);
  for (const o of inZone('base')) addObject(o);
  // 3. chain (bottom -> top): spells are objects; abilities / triggers are chain-item entities
  g.chain.forEach((it, i) => {
    if (it.kind === 'spell' && g.objects[it.source]) { addObject(g.objects[it.source]); return; }
    if (rows.length >= MAX_ENTITIES) return;
    const r = SCRATCH.subarray(rows.length * F, (rows.length + 1) * F); const src = g.objects[it.source];
    const known = !!src && !hidden.has(src.id);
    r[EA['kind:chainItem']] = 1; r[EA.known] = known ? 1 : 0; r[EA['zone:chain']] = 1;
    r[EA.controllerMe] = isMe(it.controller) ? 1 : 0; r[EA.ownerMe] = src && isMe(src.owner) ? 1 : 0;
    setChain(r, i, it); r[EA.order] = clip(rows.length, MAX_ENTITIES);
    chainEntityOf.set(it.id, rows.length); rows.length++; idxs.push(known ? cardIdxOf(src!.cardId) : UNKNOWN_IDX);
  });
  // 4. my hand (hand order), opponents' revealed hand cards, rune pools
  for (const id of g.players[me].hand) if (g.objects[id]) addObject(g.objects[id]);
  for (const P of g.players) if (opp(P.id)) for (const id of P.hand) if (g.objects[id] && visible(g.objects[id])) addObject(g.objects[id]);
  for (const pl of [me, ...g.players.map(p => p.id).filter(opp)]) for (const id of g.players[pl].runesInPlay) if (g.objects[id]) addObject(g.objects[id]);
  for (const o of inZone('runePool')) if (!entityOf.has(o.id)) addObject(o);
  // 5. other visible objects outside the usual zones (revealed deck cards, revealed set-aside cards, decision objects)
  for (const z of ['mainDeck', 'setAside', 'runeDeck', 'hand'] as ZoneKind[]) for (const o of inZone(z)) if (!entityOf.has(o.id) && visible(o)) addObject(o);
  // 6. unseen multisets (decklist minus everything seen): one count entity per distinct card, per player
  const unseenTotal: number[] = g.players.map(() => 0);
  const unseenRows: { pl: PlayerId; idx: number; n: number }[] = [];
  for (const P of g.players) {
    const cnt = new Map<number, number>();
    for (const id of hidden) {
      const o = g.objects[id];
      if (o.owner !== P.id || o.zone === 'runeDeck') continue;
      if (o.zone === 'setAside') { const t = g.cards[o.cardId]?.type; if (t === 'Battlefield' || t === 'Legend' || t === 'Rune') continue; }
      const k = cardIdxOf(o.cardId); cnt.set(k, (cnt.get(k) ?? 0) + 1); unseenTotal[P.id]++;
    }
    for (const [idx, n] of [...cnt].sort((a, b) => a[0] - b[0])) unseenRows.push({ pl: P.id, idx, n });
  }
  // 7. trash / banishment: most recent first, with the remaining budget (unseen rows are reserved first)
  const pile: GameObject[] = [];
  for (const pl of [me, ...g.players.map(p => p.id).filter(opp)]) {
    const P = g.players[pl];
    for (const id of [...P.trash].reverse()) if (g.objects[id]) pile.push(g.objects[id]);
    for (const id of [...P.banishment].reverse()) if (g.objects[id] && visible(g.objects[id])) pile.push(g.objects[id]);
  }
  // anything else visible that no group covered (banishment of non-owners, transient zones)
  const inPile = new Set(pile.map(o => o.id));
  for (const o of all) if (!entityOf.has(o.id) && !inPile.has(o.id) && visible(o)) pile.push(o);
  let truncated = 0;
  const budget = MAX_ENTITIES - unseenRows.length;
  for (const o of pile) { if (rows.length >= budget) { truncated++; continue; } addObject(o); }
  for (const u of unseenRows) {
    if (rows.length >= MAX_ENTITIES) { truncated++; continue; }
    const r = SCRATCH.subarray(rows.length * F, (rows.length + 1) * F);
    r[EA['kind:unseen']] = 1; r[EA.known] = 1; r[EA.ownerMe] = isMe(u.pl) ? 1 : 0; r[EA.controllerMe] = r[EA.ownerMe];
    r[EA['unseen:count']] = clip(u.n, 3); r[EA.order] = clip(rows.length, MAX_ENTITIES);
    rows.length++; idxs.push(u.idx);
  }

  // ---------------- global ----------------
  const G = new Float32Array(GLOBAL.dim); const GA = GLOBAL.at;
  G[GA.myTurn] = isMe(g.activePlayer) ? 1 : 0; G[GA.iAmFirst] = isMe(g.firstPlayer) ? 1 : 0;
  G[GA.turn] = clip(g.turn, 30); G[GA.victoryScore] = clip(g.victoryScore, 12);
  if (GA[`phase:${g.phase}`] !== undefined) G[GA[`phase:${g.phase}`]] = 1;
  if (!pending) G[GA['pending:none']] = 1;
  else {
    G[GA['pending:mine']] = isMe(pending.player) ? 1 : 0;
    if (GA[`pending:${pending.kind}`] !== undefined) G[GA[`pending:${pending.kind}`]] = 1;
    G[GA['pending:inStep']] = pending.inStep ? 1 : 0;
    if (isMe(pending.player)) {
      G[GA['pending:min']] = clip(pending.min ?? 0, 8); G[GA['pending:max']] = clip(pending.max ?? 0, 8);
      G[GA['pending:nOptions']] = clip(pending.options?.length ?? 0, 16);
      if (pending.hint) G[GA[`pending:hint:${pending.hint}`]] = 1;
      G[GA['pending:hasSource']] = pending.source ? 1 : 0;
      G[GA['pending:canCancel']] = g.ex.cancelFor === me ? 1 : 0;
    }
  }
  const sd = g.showdown;
  if (sd) {
    G[GA['showdown:active']] = 1; G[GA['showdown:combat']] = sd.isCombat ? 1 : 0; G[GA['showdown:closing']] = sd.stage === 'closing' ? 1 : 0;
    G[GA['showdown:focusMe']] = isMe(sd.focus) ? 1 : 0; G[GA['showdown:iAttack']] = isMe(sd.attacker) ? 1 : 0; G[GA['showdown:iDefend']] = isMe(sd.defender) ? 1 : 0;
    if (sd.battlefieldIndex < MAX_BF) G[GA[`showdown:bf${sd.battlefieldIndex}`]] = 1;
    G[GA['showdown:passedMe']] = sd.passes.includes(me) ? 1 : 0; G[GA['showdown:passedOpp']] = sd.passes.some(x => !isMe(x)) ? 1 : 0;
  }
  G[GA['chain:len']] = clip(g.chain.length, 8);
  G[GA['chain:topMine']] = g.chain.length && isMe(g.chain[g.chain.length - 1].controller) ? 1 : 0;
  G[GA['chain:openerMine']] = isMe(g.ex.chainOpener?.player) ? 1 : 0; G[GA['chain:passes']] = clip(g.ex.passes.length, 4);
  const oppId = g.players.find(p => !isMe(p.id))?.id ?? me;
  for (const [who, pl] of [['me', me], ['opp', oppId]] as const) {
    const P = g.players[pl]; const s = (k: string, v: number) => { G[GA[`${who}:${k}`]] = v; };
    s('points', clip(P.points, 12)); s('toWin', clip(g.victoryScore - P.points, 12));
    s('hand', clip(P.hand.length, 12)); s('mainDeck', clip(P.mainDeck.length, 40)); s('runeDeck', clip(P.runeDeck.length, 12));
    s('runesInPlay', clip(P.runesInPlay.length, 12));
    s('runesReady', clip(P.runesInPlay.filter(id => g.objects[id] && !g.objects[id].exhausted).length, 12));
    s('trash', clip(P.trash.length, 40)); s('banishment', clip(P.banishment.length, 12));
    s('baseUnits', clip(zoneCount(pl, 'base'), 10));
    s('bfUnits', clip(tally.reduce((a, t) => a + (isMe(pl) ? t.myU : t.opU), 0), 10));
    s('facedown', clip(zoneCount(pl, 'facedown'), 3)); s('xp', clip(P.xp ?? 0, 10)); s('turnsTaken', clip(P.turnsTaken ?? 0, 20));
    s('energy', clip(P.pool.energy, 12));
    for (const d of DOMAINS) s(`power:${d}`, clip(P.pool.power[d] ?? 0, 6));
    s('restricted', clip((P.poolRestricted ?? []).reduce((a, x) => a + x.amount, 0), 6));
    s('unseen', clip(unseenTotal[pl] ?? 0, 40));
    const rd: Record<string, number> = {};
    for (const id of P.runeDeck) { const d = g.cards[g.objects[id]?.cardId]?.domains[0]; if (d) rd[d] = (rd[d] ?? 0) + 1; }
    for (const d of DOMAINS) s(`runeDeck:${d}`, clip(rd[d] ?? 0, 12));
    s('mulliganDone', P.mulliganDone ? 1 : 0); s('legendExhausted', g.objects[P.legend]?.exhausted ? 1 : 0);
  }
  for (let i = 0; i < MAX_BF; i++) {
    const b = g.battlefields[i]; if (!b) continue; const t = tally[i]; const s = (k: string, v: number) => { G[GA[`bf${i}:${k}`]] = v; };
    s('exists', 1); s('mine', isMe(b.controller) ? 1 : 0); s('theirs', b.controller !== null && !isMe(b.controller) ? 1 : 0);
    s('contested', b.contested ? 1 : 0); s('scoredMe', b.scoredThisTurnBy.includes(me) ? 1 : 0); s('scoredOpp', b.scoredThisTurnBy.some(x => !isMe(x)) ? 1 : 0);
    s('myUnits', clip(t.myU, 6)); s('oppUnits', clip(t.opU, 6)); s('myMight', clip(t.myM, 20)); s('oppMight', clip(t.opM, 20));
  }
  G[GA.entitiesTruncated] = clip(truncated, 20);

  const n = rows.length;
  const entities = SCRATCH.slice(0, n * F);
  return { version: ENCODER_VERSION, player: me, global: G, nEntities: n, entities, cardIdx: Int32Array.from(idxs), entityOf, chainEntityOf, bfEntity };
}

/** Pad an observation to MAX_ENTITIES rows (+ mask), for consumers that want fixed shapes. */
export function toPadded(o: Observation): { entities: Float32Array; cardIdx: Int32Array; mask: Uint8Array } {
  const F = ENTITY.dim;
  const entities = new Float32Array(MAX_ENTITIES * F); entities.set(o.entities);
  const cardIdx = new Int32Array(MAX_ENTITIES); cardIdx.set(o.cardIdx);
  const mask = new Uint8Array(MAX_ENTITIES); mask.fill(1, 0, o.nEntities);
  return { entities, cardIdx, mask };
}

export type { Action };
