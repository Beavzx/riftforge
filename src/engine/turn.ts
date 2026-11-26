// Setup (CR 104-118), turn structure (301-317) and the task runner.
import type { GameState, PlayerId, Task, ObjId } from './types.ts';
import { draw, channel, ready, recycle, kill, heal, allUnits, emptyPool, trackMighty } from './actions.ts';
import { emit } from './events.ts';
import { chooseOptions, chooseOne } from './ask.ts';
import { randInt, shuffle } from './rng.ts';
import { log, cardName, nextPlayer, turnOrderFrom, activePlayers } from './util.ts';
import { moveToZone } from './state.ts';
import { hasKw } from './chars.ts';
import { score, combatDamageTask, combatCleanupTask, combatResultTask, combatControlTask, combatEndTask, showdownEndTask, expire, startShowdown } from './showdown.ts';
import { cleanupSteps } from './cleanup.ts';
import { ruleApplies, ruleOverride } from './rules.ts';

export function runTask(g: GameState, t: Task): void {
  switch (t.t) {
    case 'chooseBattlefields': return chooseBattlefields(g);
    case 'firstPlayer': return decideFirst(g);
    case 'openingDraw': for (const p of turnOrderFrom(g, g.firstPlayer)) draw(g, p, 4); return;
    case 'mulligan': return mulligan(g, t.player as PlayerId);
    case 'startGame': log(g, null, 'The game begins'); g.ex.tasks.push({ t: 'startTurn', player: g.firstPlayer }); return;
    case 'startTurn': return startTurn(g, t.player as PlayerId);
    case 'awaken': return awaken(g);
    case 'beginning': return beginning(g);
    case 'hold': return holdStep(g);
    case 'channel': return channelPhase(g);
    case 'draw': return drawPhase(g);
    case 'mainStart': return mainStart(g);
    case 'endPhase': return endPhase(g);
    case 'expiration': return expiration(g, Number(t.n ?? 0));
    case 'nextTurn': return nextTurn(g);
    case 'combatDamage': return combatDamageTask(g);
    case 'combatCleanup': return combatCleanupTask(g);
    case 'combatResult': return combatResultTask(g);
    case 'combatControl': return combatControlTask(g);
    case 'combatEnd': return combatEndTask(g);
    case 'showdownEnd': return showdownEndTask(g);
    case 'startShowdown': return startShowdown(g, t.bf as number, t.kind === 'combat');
    default: throw new Error(`unknown task ${t.t}`);
  }
}

// ---------------- setup ----------------

function chooseBattlefields(g: GameState): void {
  // CR 485.3 (duel): each player randomly keeps one of their three. 486 (match): each player chooses.
  const keep: ObjId[] = [];
  for (const p of turnOrderFrom(g, 0 as PlayerId)) {
    const cands = g.ex.setAsideBattlefields[p];
    if (!cands.length) continue;
    let pick: ObjId;
    // hidden + simultaneous: choices are only recorded in the replay unit until everyone has chosen
    if (g.ex.bfChoice === 'choose') pick = chooseOne(g, p, 'chooseBattlefield', 'Choose your battlefield for this game', cands.map(id => ({ id, label: cardName(g, id), objIds: [id] })), { data: { private: true } });
    else pick = cands[randInt(g, cands.length)];
    keep.push(pick);
  }
  const n = g.mode === '1v1' ? 2 : 3;
  keep.slice(0, n).forEach((id, i) => {
    const o = g.objects[id];
    o.zone = 'battlefield';
    o.battlefieldIndex = i;
    g.battlefields.push({ objId: id, controller: null, contested: false, scoredThisTurnBy: [], contestedBy: null, owner: o.owner });
    g.ex.setAsideBattlefields[o.owner] = g.ex.setAsideBattlefields[o.owner].filter(x => x !== id);
    log(g, o.owner, `Battlefield: ${cardName(g, id)}`, [id]);
  });
}

function decideFirst(g: GameState): void {
  if (g.firstPlayer === undefined || g.firstPlayer === null || (g.firstPlayer as number) < 0) {
    // TR 407: a random method designates a player (or the previous game's loser) who chooses first/second
    const chooser = (g.ex.firstChooser ?? randInt(g, g.players.length)) as PlayerId;
    const r = chooseOne(g, chooser, 'chooseMode', 'Do you want to go first or second?', [{ id: 'first', label: 'Go first' }, { id: 'second', label: 'Go second' }]);
    g.firstPlayer = r === 'first' ? chooser : nextPlayer(g, chooser);
  }
  g.activePlayer = g.firstPlayer;
  log(g, g.firstPlayer, `${g.players[g.firstPlayer].name} goes first`);
}

function mulligan(g: GameState, p: PlayerId): void {
  // CR 117: set aside up to two cards, draw that many, recycle the set-aside cards
  const pl = g.players[p];
  const ids = chooseOptions(g, p, 'mulligan', 'Mulligan: choose up to 2 cards to replace', pl.hand.map(id => ({ id, label: cardName(g, id), objIds: [id] })), 0, Math.min(2, pl.hand.length), { data: { noAuto: true } });
  pl.mulliganDone = true;
  if (ids.length === 0) { log(g, p, `${pl.name} keeps their hand`); return; }
  for (const id of ids) moveToZone(g, id, 'setAside');
  draw(g, p, ids.length);
  recycle(g, ids);
  log(g, p, `${pl.name} mulligans ${ids.length}`);
}

// ---------------- turn ----------------

function startTurn(g: GameState, p: PlayerId): void {
  g.turn += 1;
  g.activePlayer = p;
  g.phase = 'awaken';
  g.ex.usage = {};
  g.ex.playedThisTurn = g.players.map(() => []);
  g.ex.counts = {};
  g.ex.turnFacts = {};
  for (const b of g.battlefields) b.scoredThisTurnBy = [];
  for (const id in g.objects) { const o = g.objects[id]; o.enteredThisTurn = false; o.movedThisTurn = false; o.movesThisTurn = 0; }
  log(g, p, `--- Turn ${g.turn}: ${g.players[p].name} ---`);
  emit(g, { type: 'turnStart', player: p, turn: g.turn });
  g.ex.tasks.push({ t: 'awaken' }, { t: 'beginning' }, { t: 'hold' }, { t: 'channel' }, { t: 'draw' }, { t: 'mainStart' });
}

function awaken(g: GameState): void {
  // CR 315.1: ready everything the turn player controls
  const p = g.activePlayer;
  const ids: ObjId[] = [];
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.controller !== p) continue;
    if (o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'runePool' || o.zone === 'legendZone') ids.push(id);
  }
  ready(g, ids, p, true);                 // R-3: the turn player performs the Awaken readies (CR 315.1.b)
  emit(g, { type: 'awaken', player: p });
}

function beginning(g: GameState): void {
  g.phase = 'beginning';
  const p = g.activePlayer;
  emit(g, { type: 'beginningPhase', player: p });
  // CR 816 Temporary is a triggered ability ("At the start of your Beginning Phase, kill this"): builtin.ts queues one per
  // permanent on the beginningPhase event; it goes on the chain (respondable) and resolves before the hold step (RJ#81/7900)
}

function holdStep(g: GameState): void {
  const p = g.activePlayer;
  // CR 491.8.b.1 (2v2): battlefields the turn player's teammate controls now are disqualified for their team this turn
  if (g.mode === '2v2') g.battlefields.forEach((b, i) => {
    if (b.controller !== null && b.controller !== p && b.controller % 2 === p % 2) g.ex.turnFacts[`teamDisq:${i}`] = [p % 2];
    // CR 491.8.g.1: battlefields occupied (controlled, or with their units) by a member of the turn player's team now are
    // excepted from that member's teammates' final-point "score every battlefield" requirement this turn
    for (const q of g.players.map(x => x.id).filter(x => x % 2 === p % 2)) {
      if (b.controller === q || allUnits(g).some(u => g.objects[u].zone === 'battlefield' && g.objects[u].battlefieldIndex === i && g.objects[u].controller === q)) {
        const k = `allyOcc2v2:${q}`; g.ex.turnFacts[k] = [...((g.ex.turnFacts[k] as number[] | undefined) ?? []), i];
      }
    }
  });
  g.battlefields.forEach((b, i) => { if (b.controller === p) score(g, p, i, 'hold'); });
}

function channelPhase(g: GameState): void {
  g.phase = 'channel';
  const p = g.activePlayer;
  const pl = g.players[p];
  let n = ruleOverride(g, 'channelCount', 2, p);
  // CR 485/486: second player channels an extra rune in their first Channel Phase (FFA: last player)
  if (pl.turnsTaken === 0) {
    const order = turnOrderFrom(g, g.firstPlayer);
    if (g.mode === '1v1' && p !== g.firstPlayer) n += 1;
    if (g.mode !== '1v1' && order[order.length - 1] === p) n += 1;
  }
  const got = channel(g, p, n);
  if (got.length) log(g, p, `${pl.name} channels ${got.length} rune${got.length > 1 ? 's' : ''}`);
}

function drawPhase(g: GameState): void {
  g.phase = 'draw';
  const p = g.activePlayer;
  // FFA/2v2: first player skips their first draw (CR 487.6)
  if (g.mode !== '1v1' && p === g.firstPlayer && g.players[p].turnsTaken === 0) return;
  if (ruleApplies(g, 'skipDraw', p)) { log(g, p, `${g.players[p].name} skips their draw`); return; }
  draw(g, p, 1);
}

function mainStart(g: GameState): void {
  const p = g.activePlayer;
  for (const q of g.players) emptyPool(g, q.id);       // CR 316.1: pools empty at the start of the Main Phase
  g.phase = 'action';
  emit(g, { type: 'mainStart', player: p });
}

/** Turn player declares they're done (CR 316.9). */
export function endMainPhase(g: GameState): void {
  g.phase = 'end';
  g.ex.tasks.push({ t: 'endPhase' }, { t: 'expiration', n: 0 }, { t: 'nextTurn' });
}

function endPhase(g: GameState): void {
  // "this turn" / "until your next Ending Phase" play permissions end as the Ending phase begins
  g.ex.playPermissions = g.ex.playPermissions.filter(x => x.until === 'never' || (x.until === 'nextEnding' && x.player !== g.activePlayer));
  emit(g, { type: 'endOfTurn', player: g.activePlayer });
}

function expiration(g: GameState, n: number): void {
  // CR 317.2: cleanup, heal all units, "this turn" effects expire, stuns end, pools empty
  cleanupSteps(g, { noStart: true });
  heal(g, allUnits(g));
  for (const id in g.objects) if (g.objects[id].stunned) g.objects[id].stunned = false;
  expire(g, 'endOfTurn');
  for (const q of g.players) emptyPool(g, q.id);
  // RJ#358 (CR 317.2.f): changes made by this step ("this turn" -N [S] ending → a unit becomes Mighty) can trigger now, so the
  // step is repeated for the responses to those triggers
  trackMighty(g);
  g.ex.dirty = true;
  // FEPR loop-back: if something was put on the chain / queued, run this step again
  if (((g.triggerQueue as unknown[]).length > 0 || g.chain.length > 0) && n < 5) {
    const i = g.ex.tasks.findIndex(t => t.t === 'nextTurn');
    g.ex.tasks.splice(i >= 0 ? i : g.ex.tasks.length, 0, { t: 'expiration', n: n + 1 });
  }
}

function nextTurn(g: GameState): void {
  const p = g.activePlayer;
  g.players[p].turnsTaken += 1;
  // CR 737-738: additional turns don't change the Turn Order — after them the queue resumes with the turn after the last
  // regular one ([> A > B* > D* > B > C > D >]; RJ#523: P0 → P1* → P1 → P0 when P1 steals P0's Time Warp)
  const m = g.ex.memo;
  if (!m.__inExtraTurn) m.__lastRegularTurn = p;
  let next: PlayerId;
  if (g.ex.extraTurns.length) { next = g.ex.extraTurns.shift()!; m.__inExtraTurn = true; }
  else { next = nextPlayer(g, (m.__lastRegularTurn as PlayerId | undefined) ?? p); delete m.__inExtraTurn; delete m.__lastRegularTurn; }
  g.ex.tasks.push({ t: 'startTurn', player: next });
}

export { shuffle, activePlayers };
