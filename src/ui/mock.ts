// MOCK ENGINE — a deliberately simplified Riftbound-like game that conforms to src/engine/types.ts.
// Used by the UI/net layers (and their tests) until src/engine/game.ts exists. NOT the rules engine.
// Pure: never mutates input. Seeded RNG in state.rng.
import type {
  Action, CardDef, CardId, Decision, DeckList, Domain, GameEvent, GameObject, GameSetup, GameState,
  ObjId, PaymentPlan, PlayerId, PlayerView, ZoneKind,
} from '../engine/types';

export const IS_MOCK = true;

const rnd = (s: GameState) => { // mulberry32
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
function shuffle<T>(s: GameState, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd(s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function mk(s: GameState, cardId: CardId, owner: PlayerId, zone: ZoneKind): ObjId {
  const id = 'o' + s.nextObj++;
  s.objects[id] = {
    id, cardId, owner, controller: owner, zone, exhausted: false, faceDown: false, damage: 0,
    counters: {}, modifiers: [], enteredThisTurn: false, timestamp: s.timestamp++,
  };
  return id;
}
const def = (s: GameState, o: ObjId): CardDef => s.cards[s.objects[o].cardId];
const log = (s: GameState, player: PlayerId | null, text: string, ref?: ObjId[]) => s.log.push({ turn: s.turn, player, text, ref });
const nm = (s: GameState, o: ObjId) => def(s, o)?.name ?? '?';
export const mightOf = (s: GameState, o: ObjId) => {
  const ob = s.objects[o]; const d = s.cards[ob.cardId];
  return (d?.might ?? 0) + ob.modifiers.reduce((a, m) => a + (m.might ?? 0), 0) + (ob.counters.buff ?? 0);
};

export function createGame(setup: GameSetup): GameState {
  const s: GameState = {
    version: 1, seed: setup.seed, rng: setup.seed | 0, nextObj: 1, timestamp: 1, cards: {}, objects: {}, players: [],
    battlefields: [], turn: 0, activePlayer: 0, firstPlayer: 0, phase: 'setup', priority: null, chain: [], showdown: null,
    pending: null, triggerQueue: [], winner: null, log: [], actionCount: 0, mode: '1v1', victoryScore: setup.victoryScore ?? 8,
    ex: {} as GameState['ex'],
  };
  const used = new Set<CardId>();
  setup.players.forEach(p => [p.deck.legend, p.deck.champion, ...p.deck.main, ...p.deck.runes, ...p.deck.battlefields].forEach(c => used.add(c)));
  for (const c of used) if (setup.cardDb[c]) s.cards[c] = setup.cardDb[c];
  setup.players.slice(0, 2).forEach((p, i) => {
    const id = i as PlayerId;
    const ps = {
      id, name: p.name, points: 0, legend: '', championZone: [] as ObjId[], hand: [] as ObjId[], mainDeck: [] as ObjId[],
      runeDeck: [] as ObjId[], trash: [] as ObjId[], banishment: [] as ObjId[], base: [] as ObjId[], runesInPlay: [] as ObjId[],
      pool: { energy: 0, power: {} }, mulliganDone: false, conceded: false, xp: 0, poolRestricted: [], turnsTaken: 0,
    };
    s.players.push(ps);
    ps.legend = mk(s, p.deck.legend, id, 'legendZone');
    ps.championZone.push(mk(s, p.deck.champion, id, 'championZone'));
    ps.mainDeck = shuffle(s, p.deck.main.filter(c => s.cards[c]).map(c => mk(s, c, id, 'mainDeck')));
    ps.runeDeck = shuffle(s, p.deck.runes.filter(c => s.cards[c]).map(c => mk(s, c, id, 'runeDeck')));
    const bf = p.deck.battlefields[Math.floor(rnd(s) * p.deck.battlefields.length)];
    const bo = mk(s, bf, id, 'battlefield');
    s.objects[bo].battlefieldIndex = s.battlefields.length;
    s.battlefields.push({ objId: bo, controller: null, contested: false, scoredThisTurnBy: [] });
  });
  const coin = (rnd(s) < 0.5 ? 0 : 1) as PlayerId;
  s.firstPlayer = setup.firstPlayer ?? coin;
  s.activePlayer = s.firstPlayer;
  log(s, null, `${s.players[s.firstPlayer].name} goes first.`);
  for (const p of s.players) for (let i = 0; i < 4; i++) draw(s, p.id);
  s.phase = 'mulligan';
  s.pending = mulliganDecision(s, s.firstPlayer);
  return s;
}

function mulliganDecision(s: GameState, p: PlayerId): Decision {
  return { kind: 'mulligan', player: p, prompt: 'Choose up to 2 cards to recycle', min: 0, max: 2,
    options: s.players[p].hand.map(o => ({ id: o, label: nm(s, o), objIds: [o] })) };
}

function moveTo(s: GameState, o: ObjId, zone: ZoneKind, bf?: number) {
  const ob = s.objects[o]; const pl = s.players[ob.owner];
  for (const k of ['hand', 'mainDeck', 'runeDeck', 'trash', 'banishment', 'base', 'runesInPlay', 'championZone'] as const) {
    const i = pl[k].indexOf(o); if (i >= 0) pl[k].splice(i, 1);
  }
  ob.zone = zone; ob.battlefieldIndex = zone === 'battlefield' ? bf : undefined;
  const list: Partial<Record<ZoneKind, ObjId[]>> = { hand: pl.hand, mainDeck: pl.mainDeck, trash: pl.trash, base: pl.base, runePool: pl.runesInPlay, runeDeck: pl.runeDeck, banishment: pl.banishment };
  if (zone === 'battlefield') { /* tracked via battlefieldIndex */ } else list[zone]?.push(o);
  if (zone === 'trash' || zone === 'hand' || zone === 'mainDeck') { ob.damage = 0; ob.exhausted = false; ob.modifiers = []; }
}

function draw(s: GameState, p: PlayerId) {
  const pl = s.players[p];
  if (!pl.mainDeck.length) { // burn out (simplified): opponent scores 1, trash shuffled back
    if (!pl.trash.length) return;
    pl.mainDeck = shuffle(s, pl.trash.splice(0)); pl.mainDeck.forEach(o => (s.objects[o].zone = 'mainDeck'));
    score(s, (1 - p) as PlayerId, 'burn out');
  }
  const o = pl.mainDeck.shift()!; s.objects[o].zone = 'hand'; pl.hand.push(o);
}

function channel(s: GameState, p: PlayerId, n: number) {
  const pl = s.players[p];
  for (let i = 0; i < n && pl.runeDeck.length; i++) { const o = pl.runeDeck.shift()!; s.objects[o].zone = 'runePool'; s.objects[o].exhausted = false; pl.runesInPlay.push(o); }
}

function score(s: GameState, p: PlayerId, why: string) {
  s.players[p].points++;
  log(s, p, `${s.players[p].name} scores (${why}) — ${s.players[p].points}/${s.victoryScore}`);
  if (s.players[p].points >= s.victoryScore && s.winner === null) { s.winner = p; s.phase = 'gameOver'; s.pending = null; log(s, p, `${s.players[p].name} wins!`); }
}

const unitsAt = (s: GameState, bf: number, p?: PlayerId) => Object.values(s.objects).filter(o => o.zone === 'battlefield' && o.battlefieldIndex === bf && def(s, o.id).type !== 'Battlefield' && (p === undefined || o.controller === p)).map(o => o.id);

function startTurn(s: GameState, p: PlayerId) {
  s.turn++; s.activePlayer = p; s.phase = 'awaken';
  for (const o of Object.values(s.objects)) if (o.controller === p) { o.exhausted = false; o.enteredThisTurn = false; }
  s.battlefields.forEach(b => (b.scoredThisTurnBy = []));
  s.phase = 'beginning';
  s.battlefields.forEach((b, i) => { if (b.controller === p && s.winner === null) { b.scoredThisTurnBy.push(p); score(s, p, `hold ${nm(s, b.objId)}`); void i; } });
  if (s.winner !== null) return;
  s.phase = 'channel';
  channel(s, p, s.turn === 2 && p !== s.firstPlayer ? 3 : 2);
  s.phase = 'draw'; draw(s, p);
  if (s.winner !== null) return;
  s.phase = 'action';
  s.players[p].pool = { energy: 0, power: {} };
  log(s, p, `Turn ${s.turn}: ${s.players[p].name}`);
  s.pending = mainDecision(s, p);
}
const mainDecision = (s: GameState, p: PlayerId): Decision => ({ kind: 'mainAction', player: p, prompt: 'Your turn: play cards, move units, or end your turn' });

interface Cost { energy: number; power: Partial<Record<Domain, number>> }
const costOf = (d: CardDef): Cost => {
  const dom = d.domains.find(x => x !== 'Colorless');
  return { energy: d.energy ?? 0, power: d.power && dom ? { [dom]: d.power } : {} };
};
function autoPlan(s: GameState, p: PlayerId, c: Cost): PaymentPlan | null {
  const pl = s.players[p]; const recycle: ObjId[] = []; const exhaust: ObjId[] = [];
  for (const [dom, n] of Object.entries(c.power)) {
    const cand = pl.runesInPlay.filter(r => s.cards[s.objects[r].cardId].domains.includes(dom as Domain) && !recycle.includes(r))
      .sort((a, b) => Number(s.objects[b].exhausted) - Number(s.objects[a].exhausted));
    if (cand.length < (n ?? 0)) return null;
    recycle.push(...cand.slice(0, n));
  }
  const need = Math.max(0, c.energy - pl.pool.energy);
  const ready = pl.runesInPlay.filter(r => !s.objects[r].exhausted && !recycle.includes(r));
  if (ready.length < need) {
    // allow exhausting a rune and then recycling it
    const ready2 = pl.runesInPlay.filter(r => !s.objects[r].exhausted);
    if (ready2.length < need) return null;
    exhaust.push(...ready2.slice(0, need));
  } else exhaust.push(...ready.slice(0, need));
  return { exhaust, recycle };
}
function planOk(s: GameState, p: PlayerId, c: Cost, plan: PaymentPlan): boolean {
  const pl = s.players[p];
  if (!Array.isArray(plan.exhaust) || !Array.isArray(plan.recycle)) return false;
  if (new Set(plan.exhaust).size !== plan.exhaust.length || new Set(plan.recycle).size !== plan.recycle.length) return false;
  if (![...plan.exhaust, ...plan.recycle].every(r => pl.runesInPlay.includes(r))) return false;
  if (plan.exhaust.some(r => s.objects[r].exhausted)) return false;
  if (plan.exhaust.length + pl.pool.energy < c.energy) return false;
  for (const [dom, n] of Object.entries(c.power)) if (plan.recycle.filter(r => s.cards[s.objects[r].cardId].domains.includes(dom as Domain)).length < (n ?? 0)) return false;
  return true;
}
function pay(s: GameState, p: PlayerId, c: Cost, plan: PaymentPlan) {
  const pl = s.players[p];
  for (const r of plan.exhaust) s.objects[r].exhausted = true;
  pl.pool.energy = Math.max(0, pl.pool.energy + plan.exhaust.length - c.energy);
  for (const r of plan.recycle) { moveTo(s, r, 'runeDeck'); s.objects[r].exhausted = false; }
}

const isTargeted = (d: CardDef) => d.type === 'Spell' && /deal|kill|stun/i.test(d.text);
const spellDmg = (d: CardDef) => Math.max(1, Math.min(4, Number(/deal (\d+)/i.exec(d.text)?.[1] ?? 2)));
const allUnits = (s: GameState) => Object.values(s.objects).filter(o => (o.zone === 'base' || o.zone === 'battlefield') && ['Unit', 'Token'].includes(s.cards[o.cardId]?.type)).map(o => o.id);

function canPlayNow(s: GameState, p: PlayerId, o: ObjId, reaction: boolean) {
  const d = def(s, o);
  if (reaction && !(d.type === 'Spell' && /Reaction|Action/.test(d.keywords.join(' ')))) return false;
  if (d.type === 'Spell' && isTargeted(d) && !allUnits(s).length) return false;
  return !!autoPlan(s, p, costOf(d));
}

export function getPending(state: GameState): Decision | null { return state.pending; }

export function getLegalActions(s: GameState, player: PlayerId): Action[] {
  const d = s.pending; if (!d || d.player !== player) return [];
  const out: Action[] = [];
  const pl = s.players[player];
  if (d.kind === 'mainAction') {
    for (const o of [...pl.hand, ...pl.championZone]) {
      if (!canPlayNow(s, player, o, false)) continue;
      const cd = def(s, o);
      if (cd.type === 'Unit') {
        out.push({ type: 'playCard', player, obj: o, destination: 'base' });
        s.battlefields.forEach((b, i) => { if (b.controller === player) out.push({ type: 'playCard', player, obj: o, destination: i }); });
        if (cd.keywords.includes('Hidden')) s.battlefields.forEach((b, i) => { if (b.controller === player) out.push({ type: 'hide', player, obj: o, battlefieldIndex: i }); });
      } else out.push({ type: 'playCard', player, obj: o });
    }
    if (!s.objects[pl.legend].exhausted) out.push({ type: 'activate', player, obj: pl.legend, abilityIndex: 0 });
    const ready = (o: GameObject) => !o.exhausted && o.controller === player && ['Unit', 'Token'].includes(s.cards[o.cardId]?.type);
    const baseUnits = pl.base.filter(o => ready(s.objects[o]));
    s.battlefields.forEach((_, i) => {
      for (const u of baseUnits) out.push({ type: 'move', player, units: [u], to: i });
      if (baseUnits.length > 1) out.push({ type: 'move', player, units: [...baseUnits], to: i });
    });
    for (const u of Object.values(s.objects)) if (u.zone === 'battlefield' && ready(u)) out.push({ type: 'move', player, units: [u.id], to: 'base' });
    out.push({ type: 'endTurn', player });
    out.push({ type: 'concede', player });
    return out;
  }
  if (d.kind === 'chainResponse' || d.kind === 'showdownAction') {
    for (const o of pl.hand) if (canPlayNow(s, player, o, true)) out.push({ type: 'playCard', player, obj: o });
    out.push({ type: 'pass', player }, { type: 'concede', player });
    return out;
  }
  if (d.kind === 'assignDamage') {
    const targets = (d.data?.targets as ObjId[]) ?? []; const amt = Number(d.data?.amount ?? 0);
    const a: Record<ObjId, number> = {}; let left = amt;
    for (const t of targets) { const lethal = Math.max(0, mightOf(s, t) - s.objects[t].damage); const x = Math.min(left, lethal); a[t] = x; left -= x; }
    if (targets.length) a[targets[targets.length - 1]] += left;
    out.push({ type: 'assignDamage', player, assignment: a });
    return out;
  }
  if (d.kind === 'payment') {
    out.push({ type: 'choose', player, optionIds: ['auto'] });
    return out;
  }
  const opts = d.options ?? [];
  const min = d.min ?? 1, max = d.max ?? 1;
  if (d.kind === 'orderTriggers') { out.push({ type: 'choose', player, optionIds: opts.map(o => o.id) }); return out; }
  if (d.kind === 'chooseX' || d.kind === 'chooseNumber') {
    const lo = Number(d.data?.min ?? 0), hi = Number(d.data?.max ?? 0);
    for (let x = lo; x <= hi; x++) out.push({ type: 'choose', player, optionIds: [String(x)], data: x });
    return out;
  }
  if (max <= 1) { for (const o of opts) out.push({ type: 'choose', player, optionIds: [o.id] }); if (min === 0) out.push({ type: 'choose', player, optionIds: [] }); }
  else {
    // enumerate subsets up to size max (cap)
    const ids = opts.map(o => o.id);
    const rec = (start: number, cur: string[]) => {
      if (cur.length >= min) out.push({ type: 'choose', player, optionIds: [...cur] });
      if (cur.length === max || out.length > 200) return;
      for (let i = start; i < ids.length; i++) rec(i + 1, [...cur, ids[i]]);
    };
    rec(0, []);
  }
  return out;
}

function fail(msg: string): never { throw new Error('Illegal action: ' + msg); }

export function applyAction(input: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const s: GameState = structuredClone(input);
  const events: GameEvent[] = [];
  const d = s.pending;
  if (action.type === 'concede') {
    const p = action.player; s.players[p].conceded = true; s.winner = (1 - p) as PlayerId; s.phase = 'gameOver'; s.pending = null;
    log(s, p, `${s.players[p].name} concedes.`); s.actionCount++; return { state: s, events: [{ type: 'concede', player: p }] };
  }
  if (!d || d.player !== action.player) fail('not your decision');
  const p = action.player; const pl = s.players[p];
  const st = s as GameState & { mockCtx?: Ctx };
  const ctx = st.mockCtx;
  switch (d.kind) {
    case 'mulligan': {
      if (action.type !== 'choose') fail('expected choose');
      const ids = action.optionIds.filter(id => pl.hand.includes(id)).slice(0, 2);
      for (const o of ids) moveTo(s, o, 'mainDeck');
      for (let i = 0; i < ids.length; i++) draw(s, p);
      pl.mulliganDone = true; log(s, p, `${pl.name} mulligans ${ids.length}.`);
      const other = (1 - p) as PlayerId;
      if (!s.players[other].mulliganDone) s.pending = mulliganDecision(s, other);
      else { s.pending = null; startTurn(s, s.firstPlayer); }
      break;
    }
    case 'mainAction': {
      const legal = getLegalActions(input, p);
      if (action.type === 'endTurn') { endTurn(s, p, events); break; }
      if (action.type === 'move') {
        const units = [...new Set(action.units)];
        if (!units.length) fail('no units');
        for (const u of units) {
          const ok = legal.some(a => a.type === 'move' && a.units.includes(u) && a.to === action.to);
          if (!ok) fail('unit cannot move there');
        }
        doMove(s, p, units, action.to, events);
        break;
      }
      if (action.type === 'activate') {
        if (!legal.some(a => a.type === 'activate' && a.obj === action.obj)) fail('cannot activate');
        s.objects[action.obj].exhausted = true;
        // Mock legend ability: look at top 3, put 1 in hand.
        const top = pl.mainDeck.slice(0, 3);
        log(s, p, `${pl.name} activates ${nm(s, action.obj)}.`, [action.obj]);
        if (!top.length) { s.pending = mainDecision(s, p); break; }
        st.mockCtx = { kind: 'look', obj: action.obj };
        s.pending = { kind: 'chooseCards', player: p, prompt: 'Look at the top 3 cards of your Main Deck. Put 1 into your hand.', source: action.obj, min: 1, max: 1,
          options: top.map(o => ({ id: o, label: nm(s, o), objIds: [o] })), data: { zone: 'mainDeck' } };
        break;
      }
      if (action.type === 'playCard' || action.type === 'hide') {
        const match = legal.find(a => (a.type === 'playCard' || a.type === 'hide') && a.obj === action.obj && a.type === action.type &&
          (a.type !== 'playCard' || action.type !== 'playCard' || (a.destination ?? 'base') === (action.destination ?? 'base')));
        if (!match) fail('cannot play that');
        startPlay(s, p, action, events);
        break;
      }
      fail('unexpected ' + action.type);
    }
    // eslint-disable-next-line no-fallthrough
    case 'chooseTargets': {
      if (d.kind !== 'chooseTargets') break;
      if (action.type !== 'choose' || action.optionIds.length !== 1 || !d.options?.some(o => o.id === action.optionIds[0])) fail('bad target');
      ctx!.targets = [action.optionIds[0]];
      toPayment(s, p);
      break;
    }
    case 'payment': {
      if (action.type !== 'choose') fail('expected choose');
      const c = ctx!.cost!;
      let plan: PaymentPlan | null = null;
      if (action.optionIds[0] === 'auto' || !action.data) plan = autoPlan(s, p, c);
      else plan = action.data as PaymentPlan;
      if (!plan || !planOk(s, p, c, plan)) fail('payment does not cover cost');
      pay(s, p, c, plan);
      finishPlay(s, p, events);
      break;
    }
    case 'chainResponse': {
      if (action.type === 'pass') { resolveChain(s, events); break; }
      if (action.type === 'playCard') {
        if (!getLegalActions(input, p).some(a => a.type === 'playCard' && a.obj === action.obj)) fail('cannot react with that');
        startPlay(s, p, action, events); break;
      }
      fail('expected pass or reaction');
      break;
    }
    case 'assignDamage': {
      if (action.type !== 'assignDamage') fail('expected assignDamage');
      const targets = (d.data?.targets as ObjId[]) ?? []; const amt = Number(d.data?.amount ?? 0);
      const vals = targets.map(t => Number(action.assignment[t] ?? 0));
      if (vals.some(v => !Number.isInteger(v) || v < 0) || vals.reduce((a, b) => a + b, 0) !== amt) fail('assignment must total ' + amt);
      // lethal-before-next rule
      for (let i = 0; i < targets.length - 1; i++) if (vals[i + 1] > 0 && vals[i] < Math.max(0, mightOf(s, targets[i]) - s.objects[targets[i]].damage)) fail('assign lethal damage in order');
      targets.forEach((t, i) => (ctx!.assign![t] = vals[i]));
      finishCombat(s, events);
      break;
    }
    case 'optional': {
      if (action.type !== 'choose') fail('expected choose');
      if (action.optionIds[0] === 'yes') { draw(s, p); log(s, p, `${pl.name} draws a card.`); events.push({ type: 'draw', player: p }); }
      s.pending = mainDecision(s, s.activePlayer); st.mockCtx = undefined;
      break;
    }
    case 'chooseCards': {
      if (action.type !== 'choose' || action.optionIds.length !== 1 || !d.options?.some(o => o.id === action.optionIds[0])) fail('choose one card');
      const o = action.optionIds[0]; moveTo(s, o, 'hand');
      // others to bottom
      for (const other of d.options!.map(x => x.id).filter(x => x !== o)) { moveTo(s, other, 'mainDeck'); }
      log(s, p, `${pl.name} puts a card into hand.`); events.push({ type: 'draw', player: p });
      st.mockCtx = undefined; s.pending = mainDecision(s, p);
      break;
    }
    default: fail('mock engine does not handle ' + d.kind);
  }
  s.actionCount++;
  if (s.winner !== null) { s.pending = null; s.phase = 'gameOver'; }
  return { state: s, events };
}

interface Ctx {
  kind: 'play' | 'look' | 'combat' | 'conquer';
  obj?: ObjId; action?: Action; cost?: { energy: number; power: Partial<Record<Domain, number>> }; targets?: ObjId[];
  bf?: number; assign?: Record<ObjId, number>; attacker?: PlayerId; stack?: Ctx[];
}

function startPlay(s: GameState, p: PlayerId, action: Action & { obj: ObjId }, _events: GameEvent[]) {
  const st = s as GameState & { mockCtx?: Ctx };
  const cd = def(s, action.obj);
  const prev = st.mockCtx;
  st.mockCtx = { kind: 'play', obj: action.obj, action, cost: costOf(cd), stack: prev ? [prev] : [] };
  if (isTargeted(cd)) {
    s.pending = { kind: 'chooseTargets', player: p, prompt: `${cd.name}: choose a unit to deal ${spellDmg(cd)} to`, source: action.obj, min: 1, max: 1,
      options: allUnits(s).map(u => ({ id: u, label: nm(s, u), objIds: [u] })) };
    return;
  }
  toPayment(s, p);
}
function toPayment(s: GameState, p: PlayerId) {
  const ctx = (s as GameState & { mockCtx?: Ctx }).mockCtx!;
  const c = ctx.cost!;
  if (c.energy === 0 && !Object.keys(c.power).length) { finishPlay(s, p, []); return; }
  const auto = autoPlan(s, p, c);
  s.pending = { kind: 'payment', player: p, prompt: `Pay for ${nm(s, ctx.obj!)}`, source: ctx.obj,
    options: [{ id: 'auto', label: 'Auto-pay' }],
    data: { cost: c, auto, runes: s.players[p].runesInPlay, poolEnergy: s.players[p].pool.energy } };
}
function finishPlay(s: GameState, p: PlayerId, events: GameEvent[]) {
  const st = s as GameState & { mockCtx?: Ctx };
  const ctx = st.mockCtx!; const o = ctx.obj!; const cd = def(s, o); const a = ctx.action!;
  events.push({ type: 'play', player: p, obj: o });
  if (cd.type === 'Spell') {
    moveTo(s, o, 'trash'); s.objects[o].zone = 'chain';
    const i = s.players[p].trash.indexOf(o); if (i >= 0) s.players[p].trash.splice(i, 1);
    s.chain.push({ id: 'c' + s.timestamp++, kind: 'spell', source: o, controller: p, targets: [ctx.targets ?? []], choices: {}, pending: false });
    log(s, p, `${s.players[p].name} plays ${cd.name}.`, [o, ...(ctx.targets ?? [])]);
    st.mockCtx = ctx.stack?.[0];
    const opp = (1 - p) as PlayerId;
    s.priority = opp;
    s.pending = { kind: 'chainResponse', player: opp, prompt: `${cd.name} is on the chain. Respond or pass.` };
    return;
  }
  const dest = a.type === 'playCard' ? a.destination ?? 'base' : a.type === 'hide' ? a.battlefieldIndex : 'base';
  if (dest === 'base' || cd.type !== 'Unit') moveTo(s, o, 'base'); else moveTo(s, o, 'battlefield', dest);
  s.objects[o].controller = p; s.objects[o].enteredThisTurn = true;
  s.objects[o].exhausted = !(cd.keywords.includes('Accelerate'));
  if (a.type === 'hide') s.objects[o].faceDown = true;
  log(s, p, `${s.players[p].name} plays ${cd.name}.`, [o]);
  st.mockCtx = undefined;
  s.pending = mainDecision(s, p);
}
function resolveChain(s: GameState, events: GameEvent[]) {
  while (s.chain.length) {
    const item = s.chain.pop()!; const cd = def(s, item.source);
    const t = item.targets[0]?.[0];
    if (t && s.objects[t] && (s.objects[t].zone === 'base' || s.objects[t].zone === 'battlefield')) {
      const n = spellDmg(cd); s.objects[t].damage += n; events.push({ type: 'damage', obj: t, amount: n });
      log(s, item.controller, `${cd.name} deals ${n} to ${nm(s, t)}.`, [t]);
    } else if (!isTargeted(cd)) { draw(s, item.controller); log(s, item.controller, `${cd.name}: draw 1.`); }
    moveTo(s, item.source, 'trash');
  }
  checkDeaths(s, events);
  s.priority = null;
  s.pending = s.winner === null ? mainDecision(s, s.activePlayer) : null;
}
function checkDeaths(s: GameState, events: GameEvent[]) {
  for (const o of Object.values(s.objects)) {
    if ((o.zone === 'base' || o.zone === 'battlefield') && ['Unit', 'Token'].includes(s.cards[o.cardId]?.type) && o.damage >= Math.max(1, mightOf(s, o.id))) {
      log(s, o.controller, `${nm(s, o.id)} dies.`, [o.id]); events.push({ type: 'death', obj: o.id }); moveTo(s, o.id, 'trash');
    }
  }
  s.battlefields.forEach((b, i) => { b.contested = unitsAt(s, i, 0).length > 0 && unitsAt(s, i, 1).length > 0; });
}

function doMove(s: GameState, p: PlayerId, units: ObjId[], to: number | 'base', events: GameEvent[]) {
  for (const u of units) { s.objects[u].exhausted = true; moveTo(s, u, to === 'base' ? 'base' : 'battlefield', to === 'base' ? undefined : to); }
  log(s, p, `${s.players[p].name} moves ${units.map(u => nm(s, u)).join(', ')} to ${to === 'base' ? 'base' : nm(s, s.battlefields[to].objId)}.`, units);
  events.push({ type: 'move', units, to });
  if (to === 'base') { s.pending = mainDecision(s, p); return; }
  const enemies = unitsAt(s, to, (1 - p) as PlayerId);
  if (enemies.length) {
    s.battlefields[to].contested = true;
    s.showdown = { battlefieldIndex: to, focus: p, passes: [], isCombat: true, attacker: p, defender: (1 - p) as PlayerId };
    const st = s as GameState & { mockCtx?: Ctx };
    st.mockCtx = { kind: 'combat', bf: to, attacker: p, assign: {} };
    const atk = unitsAt(s, to, p).reduce((a, u) => a + mightOf(s, u), 0);
    if (enemies.length > 1 && atk > 0) {
      s.pending = { kind: 'assignDamage', player: p, prompt: `Assign ${atk} combat damage`, source: s.battlefields[to].objId, data: { amount: atk, targets: enemies } };
      return;
    }
    if (enemies.length === 1) st.mockCtx.assign![enemies[0]] = atk;
    finishCombat(s, events);
    return;
  }
  conquerCheck(s, p, to, events);
  if (!s.pending || s.pending.kind !== 'optional') s.pending = s.winner === null ? mainDecision(s, p) : null;
}
function finishCombat(s: GameState, events: GameEvent[]) {
  const st = s as GameState & { mockCtx?: Ctx };
  const ctx = st.mockCtx!; const bf = ctx.bf!; const p = ctx.attacker!; const q = (1 - p) as PlayerId;
  for (const [t, n] of Object.entries(ctx.assign ?? {})) if (n) { s.objects[t].damage += n; events.push({ type: 'damage', obj: t, amount: n }); }
  let def = unitsAt(s, bf, q).reduce((a, u) => a + mightOf(s, u), 0);
  for (const u of unitsAt(s, bf, p)) { if (!def) break; const x = Math.min(def, Math.max(0, mightOf(s, u) - s.objects[u].damage)) || def; s.objects[u].damage += x; def -= x; events.push({ type: 'damage', obj: u, amount: x }); }
  log(s, p, `Combat at ${nm(s, s.battlefields[bf].objId)}.`);
  checkDeaths(s, events);
  s.showdown = null; st.mockCtx = undefined;
  const a = unitsAt(s, bf, p), dd = unitsAt(s, bf, q);
  if (a.length && dd.length) { for (const u of a) moveTo(s, u, 'base'); log(s, p, 'Attackers are recalled.'); }
  s.battlefields[bf].contested = false;
  if (a.length && !dd.length) conquerCheck(s, p, bf, events);
  else if (!a.length && dd.length) s.battlefields[bf].controller = q;
  if (s.winner === null && (!s.pending || s.pending.kind !== 'optional')) s.pending = mainDecision(s, s.activePlayer);
}
function conquerCheck(s: GameState, p: PlayerId, bf: number, events: GameEvent[]) {
  const b = s.battlefields[bf];
  if (b.controller === p) return;
  b.controller = p;
  events.push({ type: 'conquer', player: p, battlefield: bf });
  log(s, p, `${s.players[p].name} conquers ${nm(s, b.objId)}!`, [b.objId]);
  if (!b.scoredThisTurnBy.includes(p)) {
    b.scoredThisTurnBy.push(p); score(s, p, 'conquer'); events.push({ type: 'score', player: p });
    if (s.winner === null && s.players[p].mainDeck.length) {
      s.pending = { kind: 'optional', player: p, prompt: 'Conquer bonus: draw a card?', source: b.objId, options: [{ id: 'yes', label: 'Draw' }, { id: 'no', label: 'No thanks' }] };
    }
  }
}
function endTurn(s: GameState, p: PlayerId, events: GameEvent[]) {
  s.phase = 'end';
  for (const o of Object.values(s.objects)) { o.damage = 0; o.modifiers = o.modifiers.filter(m => m.duration !== 'endOfTurn'); }
  for (const pl of s.players) pl.pool = { energy: 0, power: {} };
  log(s, p, `${s.players[p].name} ends the turn.`);
  events.push({ type: 'endTurn', player: p });
  startTurn(s, (1 - p) as PlayerId);
}

export function getView(s: GameState, player: PlayerId): PlayerView {
  const v: GameState = structuredClone(s);
  const reveal = new Set<ObjId>();
  if (s.pending?.player === player) for (const o of s.pending.options ?? []) for (const id of o.objIds ?? []) reveal.add(id);
  for (const o of Object.values(v.objects)) {
    const hidden = (o.zone === 'hand' && o.owner !== player) || o.zone === 'mainDeck' || o.zone === 'runeDeck' || (o.faceDown && o.controller !== player);
    if (hidden && !reveal.has(o.id)) v.objects[o.id] = { ...o, cardId: 'hidden' };
  }
  delete (v as Record<string, unknown>).mockCtx;
  v.ex = {} as GameState['ex'];
  v.rng = 0;
  const pending = s.pending && s.pending.player === player ? v.pending : s.pending ? { kind: s.pending.kind, player: s.pending.player, prompt: `Waiting for ${s.players[s.pending.player].name}…` } : null;
  v.pending = pending;
  return { you: player, state: v, pending, legal: getLegalActions(s, player) };
}

export function validateDeck(deck: DeckList, db: Record<CardId, CardDef>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const L = db[deck.legend];
  if (!L || L.type !== 'Legend') errors.push('Choose a legend.');
  const C = db[deck.champion];
  if (!C || !C.supertypes.includes('Champion')) errors.push('Choose a champion unit.');
  if (deck.main.length < 39) errors.push(`Main deck needs 40 cards incl. champion (has ${deck.main.length + 1}).`);
  if (deck.runes.length !== 12) errors.push(`Rune deck needs exactly 12 runes (has ${deck.runes.length}).`);
  if (deck.battlefields.length !== 3) errors.push(`Choose 3 battlefields (has ${deck.battlefields.length}).`);
  const counts = new Map<string, number>();
  for (const c of [...deck.main, deck.champion]) { const n = db[c]?.name ?? c; counts.set(n, (counts.get(n) ?? 0) + 1); if (!db[c]) errors.push(`Unknown card ${c}.`); }
  for (const [n, k] of counts) if (k > 3) errors.push(`Too many copies of ${n} (${k}/3).`);
  if (L) for (const c of [...deck.main, ...deck.runes, deck.champion]) {
    const cd = db[c]; if (!cd) continue;
    if (cd.domains.some(x => x !== 'Colorless' && !L.domains.includes(x))) { errors.push(`${cd.name} is outside ${L.name}'s domains.`); break; }
  }
  return { ok: !errors.length, errors: [...new Set(errors)] };
}

/** Mock bot: simple, aggressive, always legal. */
export function chooseBotAction(view: PlayerView): Action | null {
  const legal = view.legal.filter(a => a.type !== 'concede');
  if (!legal.length) return null;
  const s = view.state; const me = view.you;
  const d = view.pending!;
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  if (d.kind === 'mainAction') {
    const plays = legal.filter(a => a.type === 'playCard' && (a.destination ?? 'base') === 'base');
    if (plays.length) return pick(plays);
    const moves = legal.filter(a => a.type === 'move' && a.to !== 'base' && a.units.length > 1);
    const singles = legal.filter(a => a.type === 'move' && a.to !== 'base');
    const good = [...moves, ...singles].filter(a => a.type === 'move' && typeof a.to === 'number' && s.battlefields[a.to].controller !== me);
    if (good.length) return good[0];
    const act = legal.find(a => a.type === 'activate'); if (act) return act;
    return legal.find(a => a.type === 'endTurn') ?? legal[0];
  }
  if (d.kind === 'mulligan') return { type: 'choose', player: me, optionIds: [] };
  if (d.kind === 'chainResponse' || d.kind === 'showdownAction') return legal.find(a => a.type === 'pass') ?? legal[0];
  if (d.kind === 'chooseTargets') {
    const enemy = legal.find(a => a.type === 'choose' && s.objects[a.optionIds[0]]?.controller !== me);
    return enemy ?? legal[0];
  }
  return legal[0];
}
