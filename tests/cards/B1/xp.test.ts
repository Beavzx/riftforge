// B1: Unleashed cards — XP, Hunt, Level and XP costs.
import { test } from 'node:test';
import {
  assert, game, setRunes, readyRunes, put, handCard, playAct, answer, isAsking, resolveAll, zoneOf, canPlayNow, setController,
  hand, legend, m, attack, resolveCombat, optionIds, hasKw, kwVal, nextTurn, xp, setXp, abilities, activate, putFacedown, act,
} from './_util.ts';
import { makeCtx } from '../../../src/engine/context.ts';
import { chars } from '../../../src/engine/chars.ts';
import { getLegalActions } from '../../fixtures/helpers.ts';

test('unl-013 Lotus Trap: doubles all damage dealt to the chosen unit this turn only; Hidden + Reaction', () => {
  let g = game();
  setRunes(g, 0, { Fury: 2 });
  const e = put(g, 1, 't-u5', 0);
  const s = handCard(g, 0, 'unl-013-219');
  assert.ok(hasKw(g, s, 'Hidden') && hasKw(g, s, 'Reaction'));
  g = playAct(g, 0, s);
  g = resolveAll(g);
  makeCtx(g, s, 0).deal(2, e);
  assert.equal(g.objects[e].damage, 4);
  g.objects[e].damage = 0;
  g = nextTurn(g);
  makeCtx(g, s, 0).deal(2, e);
  assert.equal(g.objects[e].damage, 2, 'expired at end of turn');
});

test('unl-015 Right of Conquest: draw 1 plus 1 per battlefield you control', () => {
  let g = game();
  setRunes(g, 0, { Fury: 4 });
  setController(g, 0, 0); setController(g, 1, 0);
  const s = handCard(g, 0, 'unl-015-219');
  const h0 = hand(g, 0).length;
  g = playAct(g, 0, s);
  g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0 - 1 + 3);
});

test('unl-016 Scorchclaw: Level 3 gives +1 and enters ready; Hunt 2 on conquer', () => {
  let g = game();
  setRunes(g, 0, { Fury: 8 });
  const a = handCard(g, 0, 'unl-016-219');
  g = playAct(g, 0, a, 'base'); g = resolveAll(g);
  assert.equal(g.objects[a].exhausted, true);
  assert.equal(m(g, a), 3);
  setXp(g, 0, 3);
  g.ex.dirty = true;
  assert.equal(m(g, a), 4);
  const b = handCard(g, 0, 'unl-016-219');
  g = playAct(g, 0, b, 'base'); g = resolveAll(g);
  assert.equal(g.objects[b].exhausted, false);
  g = attack(g, 0, [b], 0);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(xp(g, 0), 5, 'Hunt 2: +2 XP on conquer');
});

test('unl-017 Square Up: Assault 4 this turn; Repeat by discarding 1 gives a second unit Assault 4', () => {
  let g = game();
  setRunes(g, 0, { Fury: 4 });
  const u1 = put(g, 0, 't-u1', 'base'), u2 = put(g, 0, 't-u2', 'base');
  const junk = handCard(g, 0, 't-u3');
  const s = handCard(g, 0, 'unl-017-219');
  g = playAct(g, 0, s);
  g = answer(g, 'chooseTargets', u1);
  g = answer(g, 'optional', 'yes');                 // pay Discard 1 to Repeat
  g = answer(g, 'chooseTargets', u2);               // CR 820.2: the repeat's choice is made as the spell is played
  if (isAsking(g, 'chooseCards')) g = answer(g, 'chooseCards', junk);
  g = resolveAll(g);
  assert.equal(zoneOf(g, junk), 'trash');
  assert.equal(kwVal(g, u1, 'Assault'), 4);
  assert.equal(kwVal(g, u2, 'Assault'), 4);
  g = nextTurn(g);
  assert.equal(kwVal(g, u1, 'Assault'), 0);
});

test('unl-031 Combat Experience: +1, or +3 instead at Level 6', () => {
  for (const [x, want] of [[0, 3], [6, 5]] as const) {
    let g = game();
    setRunes(g, 0, { Calm: 1 });
    setXp(g, 0, x);
    const u = put(g, 0, 't-u2', 'base');
    const s = handCard(g, 0, 'unl-031-219');
    g = playAct(g, 0, s);
    g = resolveAll(g);
    assert.equal(m(g, u), want);
  }
});

test('unl-034 Herald of Spring: gain 2 XP when played; Hunt (1) on conquer', () => {
  let g = game();
  setRunes(g, 0, { Calm: 5 });
  const h = handCard(g, 0, 'unl-034-219');
  g = playAct(g, 0, h, 'base'); g = resolveAll(g);
  assert.equal(xp(g, 0), 2);
  g.objects[h].exhausted = false;
  g = attack(g, 0, [h], 0);
  assert.equal(xp(g, 0), 3);
});

test('unl-035 Monch: if an opponent controls a stunned unit, costs [2] less and enters ready', () => {
  let g = game();
  setRunes(g, 0, { Calm: 4 });
  const mo = handCard(g, 0, 'unl-035-219');
  const e = put(g, 1, 't-u2', 0);
  assert.equal(canPlayNow(g, 0, mo), false);
  g.objects[e].stunned = true;
  assert.ok(canPlayNow(g, 0, mo));
  g = playAct(g, 0, mo, 'base'); g = resolveAll(g);
  assert.equal(g.objects[mo].exhausted, false);
  assert.equal(readyRunes(g, 0), 0);
  // without a stunned enemy: full cost, enters exhausted
  let h = game();
  setRunes(h, 0, { Calm: 6 });
  const mo2 = handCard(h, 0, 'unl-035-219');
  h = playAct(h, 0, mo2, 'base'); h = resolveAll(h);
  assert.equal(h.objects[mo2].exhausted, true);
});

test('unl-038 Skyward Strike: move an enemy unit (destination chosen); Level 6 also stuns an enemy unit', () => {
  let g = game();
  setRunes(g, 0, { Calm: 3 });
  setXp(g, 0, 6);
  const e1 = put(g, 1, 't-u2', 0), e2 = put(g, 1, 't-u3', 1);
  const s = handCard(g, 0, 'unl-038-219');
  g = playAct(g, 0, s);
  g = answer(g, 'chooseTargets', e1);
  // R-2 (CR 355.4): the destination is chosen as the spell is played, before the next choice
  assert.ok(optionIds(g).includes('base') && optionIds(g).includes('1') && !optionIds(g).includes('0'));
  g = answer(g, 'chooseDestination', 'base');
  g = answer(g, 'chooseTargets', e2);
  g = resolveAll(g);
  assert.equal(zoneOf(g, e1), 'base');
  assert.equal(g.objects[e2].stunned, true);
});

test('unl-038 Skyward Strike: below Level 6 no stun choice is offered', () => {
  let g = game();
  setRunes(g, 0, { Calm: 3 });
  const e1 = put(g, 1, 't-u2', 0);
  const s = handCard(g, 0, 'unl-038-219');
  g = playAct(g, 0, s);
  g = resolveAll(g);                                   // single target auto-chosen, no stun group
  g = answer(g, 'chooseDestination', '1');
  g = resolveAll(g);
  assert.equal(g.objects[e1].battlefieldIndex, 1);
  assert.equal(!!g.objects[e1].stunned, false);
});

test('unl-040 Wuju Apprentice: Level 6 — draw 1 when played; Hunt', () => {
  for (const [x, draws] of [[0, 0], [6, 1]] as const) {
    let g = game();
    setRunes(g, 0, { Calm: 2 });
    setXp(g, 0, x);
    const w = handCard(g, 0, 'unl-040-219');
    const h0 = hand(g, 0).length;
    g = playAct(g, 0, w, 'base'); g = resolveAll(g);
    assert.equal(hand(g, 0).length, h0 - 1 + draws);
    assert.equal(kwVal(g, w, 'Hunt'), 1);
  }
});

test('unl-047 Mosstomper: Level 3 — +1 and Deflect', () => {
  const g = game();
  const u = put(g, 0, 'unl-047-219', 'base');
  assert.equal(m(g, u), 3); assert.equal(hasKw(g, u, 'Deflect'), false);
  setXp(g, 0, 3); g.ex.dirty = true;
  assert.equal(m(g, u), 4); assert.ok(hasKw(g, u, 'Deflect'));
  assert.equal(kwVal(g, u, 'Hunt'), 2);
});

test('unl-053 Scuttle Crab: draw 1 when played; Deathknell reveals the opponent\'s hand and gains 1 XP', () => {
  let g = game();
  setRunes(g, 0, { Calm: 2, Order: 3 });
  const cr = handCard(g, 0, 'unl-053-219');
  const h0 = hand(g, 0).length;
  g = playAct(g, 0, cr, 'base'); g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0);
  const lac = handCard(g, 0, 'ven-127-166');          // Lacerate: kill a unit with 3 or less
  g = playAct(g, 0, lac);
  if (isAsking(g, 'chooseTargets')) g = answer(g, 'chooseTargets', cr);
  g = resolveAll(g);
  assert.equal(zoneOf(g, cr), 'trash');
  assert.equal(xp(g, 0), 1);
  const oppHand = g.players[1].hand;
  assert.ok(g.log.some(e => e.text.startsWith('Revealed') && oppHand.every(id => e.ref?.includes(id))), "opponent's hand revealed");
});

test('unl-059 Master Yi, Unstoppable: Level cost ladder and Level 16 untargetability', () => {
  let g = game();
  setRunes(g, 0, { Calm: 9 });
  const y = handCard(g, 0, 'unl-059-219');
  assert.equal(canPlayNow(g, 0, y), false);
  setXp(g, 0, 3);
  assert.equal(canPlayNow(g, 0, y), false, '[10][C][C] needs 10 runes');
  setXp(g, 0, 6);
  assert.ok(canPlayNow(g, 0, y), '[8][C] with 9 Calm runes');
  setRunes(g, 0, { Calm: 6 });
  assert.equal(canPlayNow(g, 0, y), false);
  setXp(g, 0, 11);
  assert.ok(canPlayNow(g, 0, y), '[6] at Level 11');
  g = playAct(g, 0, y, 'base'); g = resolveAll(g);
  assert.equal(zoneOf(g, y), 'base');
  assert.equal(chars(g, y).cantBeChosenByEnemy, false);
  setXp(g, 0, 16); g.ex.dirty = true;
  assert.equal(chars(g, y).cantBeChosenByEnemy, true);
});

test('unl-063 Eclipse: -4 this turn, then Predict', () => {
  let g = game();
  setRunes(g, 0, { Mind: 3 });
  const e = put(g, 1, 't-u5', 0);
  const s = handCard(g, 0, 'unl-063-219');
  const top = g.players[0].mainDeck[0];
  g = playAct(g, 0, s);
  g = resolveAll(g);
  assert.ok(isAsking(g, 'chooseCards'), 'Predict asks which cards to recycle');
  g = answer(g, 'chooseCards', top);
  g = resolveAll(g);
  assert.equal(m(g, e), 1);
  assert.equal(g.players[0].mainDeck[g.players[0].mainDeck.length - 1], top);
});

test('unl-075 Gustwalker: Level 3 — +1 and Ganking; Hunt 2', () => {
  const g = game();
  const u = put(g, 0, 'unl-075-219', 'base');
  setXp(g, 0, 3); g.ex.dirty = true;
  assert.equal(m(g, u), 4); assert.ok(hasKw(g, u, 'Ganking'));
  assert.equal(kwVal(g, u, 'Hunt'), 2);
});

test('unl-091 Concentrate: draw 2; [2] less at Level 6, [4] less at Level 11', () => {
  let g = game();
  setRunes(g, 0, { Body: 3 });
  const s = handCard(g, 0, 'unl-091-219');
  assert.equal(canPlayNow(g, 0, s), false);
  setXp(g, 0, 6);
  assert.ok(canPlayNow(g, 0, s));
  setRunes(g, 0, { Body: 1 });
  assert.equal(canPlayNow(g, 0, s), false);
  setXp(g, 0, 11);
  assert.ok(canPlayNow(g, 0, s));
  const h0 = hand(g, 0).length;
  g = playAct(g, 0, s); g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0 - 1 + 2);
});

test('unl-092 Demacian Diplomat: gain 1 XP when played', () => {
  let g = game();
  setRunes(g, 0, { Body: 2 });
  const d = handCard(g, 0, 'unl-092-219');
  g = playAct(g, 0, d, 'base'); g = resolveAll(g);
  assert.equal(xp(g, 0), 1);
});

test('unl-094 Gemhand Hunter: Level 6 — +1; Hunt', () => {
  const g = game();
  const u = put(g, 0, 'unl-094-219', 'base');
  assert.equal(m(g, u), 2);
  setXp(g, 0, 6); g.ex.dirty = true;
  assert.equal(m(g, u), 3);
  assert.equal(kwVal(g, u, 'Hunt'), 1);
});

test('unl-095 Grim Resolve: +3 this turn; gain 2 XP when it wins a combat this turn', () => {
  let g = game();
  setRunes(g, 0, { Body: 2 });
  const u = put(g, 0, 't-u1', 'base');
  setController(g, 0, 1);
  const e = put(g, 1, 't-u3', 0);
  const s = handCard(g, 0, 'unl-095-219');
  assert.ok(hasKw(g, s, 'Action'));
  g = playAct(g, 0, s); g = resolveAll(g);
  assert.equal(m(g, u), 4);
  g = attack(g, 0, [u], 0);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(xp(g, 0), 2);
});

test('unl-095 Grim Resolve: no XP if the unit does not win', () => {
  let g = game();
  setRunes(g, 0, { Body: 2 });
  const u = put(g, 0, 't-u1', 'base');
  setController(g, 0, 1);
  put(g, 1, 't-u5', 0); put(g, 1, 't-u5', 0);
  const s = handCard(g, 0, 'unl-095-219');
  g = playAct(g, 0, s); g = resolveAll(g);
  g = attack(g, 0, [u], 0);
  assert.equal(xp(g, 0), 0);
});

test('unl-098 Targonian Visionary: Level 11 — +4', () => {
  const g = game();
  const u = put(g, 0, 'unl-098-219', 'base');
  setXp(g, 0, 10); g.ex.dirty = true; assert.equal(m(g, u), 6);
  setXp(g, 0, 11); g.ex.dirty = true; assert.equal(m(g, u), 10);
});

for (const [id, name] of [['unl-102-219', 'Crowd Favorite'], ['unl-162-219', 'Enthralling Protector']] as const) {
  test(`${id} ${name}: Spend 2 XP: Buff me; Hunt`, () => {
    let g = game();
    const u = put(g, 0, id, 'base');
    setXp(g, 0, 1);
    assert.equal(abilities(g, 0, u).length, 0, 'not enough XP');
    setXp(g, 0, 2);
    const [idx] = abilities(g, 0, u);
    g = activate(g, 0, u, idx); g = resolveAll(g);
    assert.equal(xp(g, 0), 0);
    assert.equal(g.objects[u].counters.buff, 1);
    assert.equal(kwVal(g, u, 'Hunt'), 1);
  });
}

test('unl-103 Disposal Order: recycle up to 3 cards from opponents\' trashes, or draw 1', () => {
  let g = game();
  setRunes(g, 0, { Body: 4 });
  const t1 = put(g, 1, 't-u1', 'trash'), t2 = put(g, 1, 't-u2', 'trash'), mine = put(g, 0, 't-u3', 'trash');
  const s = handCard(g, 0, 'unl-103-219');
  g = playAct(g, 0, s);
  g = answer(g, 'chooseMode', 'recycle');
  assert.ok(!optionIds(g).includes(mine));
  g = answer(g, 'chooseTargets', t1, t2);
  g = resolveAll(g);
  assert.equal(zoneOf(g, t1), 'mainDeck'); assert.equal(zoneOf(g, t2), 'mainDeck');
  assert.equal(zoneOf(g, mine), 'trash');
  const s2 = handCard(g, 0, 'unl-103-219');
  const h0 = hand(g, 0).length;
  g = playAct(g, 0, s2);
  g = answer(g, 'chooseMode', 'draw');
  g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0);
});

test('unl-107 Stare Down: enemy units with less Might than the chosen unit move to base; gain 1 XP', () => {
  let g = game();
  setRunes(g, 0, { Body: 2 });
  const f = put(g, 0, 't-u3', 'base');
  const small = put(g, 1, 't-u2', 0), big = put(g, 1, 't-u4', 0);
  const s = handCard(g, 0, 'unl-107-219');
  g = playAct(g, 0, s);
  g = answer(g, 'chooseTargets', g.battlefields[0].objId);
  g = resolveAll(g);
  assert.equal(zoneOf(g, small), 'base');
  assert.equal(zoneOf(g, big), 'battlefield');
  assert.equal(xp(g, 0), 1);
  void f;
});

test('unl-108 Wily Newtfish: +1 and Ganking only if you gained XP this turn', () => {
  let g = game();
  setRunes(g, 0, { Body: 2 });
  const w = put(g, 0, 'unl-108-219', 'base');
  assert.equal(m(g, w), 4); assert.equal(hasKw(g, w, 'Ganking'), false);
  const d = handCard(g, 0, 'unl-092-219');               // Demacian Diplomat: gain 1 XP
  g = playAct(g, 0, d, 'base'); g = resolveAll(g);
  assert.equal(m(g, w), 5); assert.ok(hasKw(g, w, 'Ganking'));
  g = nextTurn(g);
  assert.equal(m(g, w), 4);
});

test('unl-109 Blood Rose: may pay [1] to gain 1 XP when you play a unit; Spend 3 XP, [T]: ready a unit', () => {
  let g = game();
  setRunes(g, 0, { Fury: 2 });
  const br = put(g, 0, 'unl-109-219', 'base');
  const u = handCard(g, 0, 't-u1');
  g = playAct(g, 0, u, 'base');
  g = resolveAll(g);
  g = answer(g, 'optional', 'yes');
  g = resolveAll(g);
  assert.equal(xp(g, 0), 1);
  assert.equal(readyRunes(g, 0), 0);
  // declining
  const u2 = handCard(g, 0, 't-u1');
  setRunes(g, 0, { Fury: 2 });
  g = playAct(g, 0, u2, 'base'); g = resolveAll(g);
  g = answer(g, 'optional', 'no'); g = resolveAll(g);
  assert.equal(xp(g, 0), 1);
  assert.equal(readyRunes(g, 0), 1);
  // can't pay: not asked
  setRunes(g, 0, { Fury: 1 });
  g = playAct(g, 0, handCard(g, 0, 't-u1'), 'base'); g = resolveAll(g);
  assert.equal(isAsking(g, 'optional'), false);
  // activated ability
  assert.equal(abilities(g, 0, br).length, 0);
  setXp(g, 0, 3);
  const [idx] = abilities(g, 0, br);
  g = activate(g, 0, br, idx);
  g = answer(g, 'chooseTargets', u);
  g = resolveAll(g);
  assert.equal(g.objects[u].exhausted, false);
  assert.equal(g.objects[br].exhausted, true);
  assert.equal(xp(g, 0), 0);
});

test('unl-113 Master Yi, Tempered: Level 6 — Deflect and Ganking; Hunt 2', () => {
  const g = game();
  const u = put(g, 0, 'unl-113-219', 'base');
  assert.equal(hasKw(g, u, 'Deflect'), false);
  setXp(g, 0, 6); g.ex.dirty = true;
  assert.ok(hasKw(g, u, 'Deflect') && hasKw(g, u, 'Ganking'));
  assert.equal(kwVal(g, u, 'Hunt'), 2);
});

test('unl-115 Nilah: gain 1 XP when she moves; Accelerate + Ganking', () => {
  let g = game();
  const n = put(g, 0, 'unl-115-219', 'base');
  assert.ok(hasKw(g, n, 'Accelerate') && hasKw(g, n, 'Ganking'));
  g = act(g, { type: 'move', player: 0, units: [n], to: 0 });
  g = resolveCombat(g, 0);
  assert.equal(xp(g, 0), 1);
});

test('unl-116 Poppy (Body): readies and gains 3 XP only if an opponent is near victory; Deflect', () => {
  for (const near of [true, false]) {
    let g = game();
    setRunes(g, 0, { Body: 5 });
    if (near) g.players[1].points = g.victoryScore - 2;
    const p = handCard(g, 0, 'unl-116-219');
    g = playAct(g, 0, p, 'base'); g = resolveAll(g);
    assert.equal(g.objects[p].exhausted, !near);
    assert.equal(xp(g, 0), near ? 3 : 0);
    assert.equal(kwVal(g, p, 'Deflect'), 1);
  }
});

test('unl-117 Arachnoid Horror: friendly units can be played to a battlefield where an enemy unit is alone', () => {
  let g = game();
  setRunes(g, 0, { Fury: 2 });
  put(g, 0, 'unl-117-219', 'base');
  const e = put(g, 1, 't-u2', 0);
  put(g, 1, 't-u1', 1); put(g, 1, 't-u1', 1);
  const u = handCard(g, 0, 't-u1');
  assert.ok(getLegalDest(g, u).includes(0));
  assert.ok(!getLegalDest(g, u).includes(1), 'two enemy units: not alone');
  g = playAct(g, 0, u, 0);
  g = resolveCombat(g, 0);
  assert.ok(zoneOf(g, u) !== 'hand');
  void e;
});

test('unl-117 Arachnoid Horror: can itself be played to a battlefield where an enemy unit is alone', () => {
  const g = game();
  setRunes(g, 0, { Body: 7 });
  put(g, 1, 't-u2', 0);
  const a = handCard(g, 0, 'unl-117-219');
  assert.ok(getLegalDest(g, a).includes(0));
});

function getLegalDest(g: ReturnType<typeof game>, obj: string): (number | 'base')[] {
  return (getLegal(g)).filter(a => a.type === 'playCard' && a.obj === obj).map(a => (a as { destination?: number | 'base' }).destination ?? 'base');
}
function getLegal(g: ReturnType<typeof game>) { return getLegalActions(g, 0); }

test("unl-119 Kha'Zix (Body): when attacking, may spend 3 XP to deal damage equal to his Might to an enemy unit here", () => {
  let g = game();
  setXp(g, 0, 3);
  const k = put(g, 0, 'unl-119-219', 'base');
  setController(g, 0, 1);
  const big = put(g, 1, 't-u5', 0), small = put(g, 1, 't-u2', 0);
  g = act(g, { type: 'move', player: 0, units: [k], to: 0 });
  g = resolveCombat(g, 0);
  g = answer(g, 'optional', 'yes');
  g = answer(g, 'chooseTargets', big);
  g = resolveCombat(g, 0);
  assert.equal(zoneOf(g, big), 'trash');
  assert.equal(zoneOf(g, small), 'trash');
  assert.equal(xp(g, 0), 1, '3 spent, then Hunt +1 on conquer');
});

test("unl-119 Kha'Zix (Body): no prompt without 3 XP", () => {
  let g = game();
  setXp(g, 0, 2);
  const k = put(g, 0, 'unl-119-219', 'base');
  setController(g, 0, 1);
  put(g, 1, 't-u2', 0);
  g = act(g, { type: 'move', player: 0, units: [k], to: 0 });
  g = resolveCombat(g, 0);
  assert.equal(isAsking(g, 'optional'), false);
  assert.equal(xp(g, 0), 3);
});

test('unl-122 Crescent Guardian: if you played a spell this turn, may pay [C] to enter ready', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 5 });
  const c1 = handCard(g, 0, 'unl-122-219');
  g = playAct(g, 0, c1, 'base');
  assert.equal(isAsking(g, 'optional'), false, 'no spell played yet');
  g = resolveAll(g);
  assert.equal(g.objects[c1].exhausted, true);
  let h = game();
  setRunes(h, 0, { Chaos: 5 });
  h.ex.counts['spells:0'] = 1;
  const c2 = handCard(h, 0, 'unl-122-219');
  h = playAct(h, 0, c2, 'base');
  h = answer(h, 'optional', 'yes');
  h = resolveAll(h);
  assert.equal(h.objects[c2].exhausted, false);
  assert.equal(h.players[0].runesInPlay.length, 4);
});

test('unl-125 Lunar Boon: discard 1, then draw 2', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 3 });
  const s = handCard(g, 0, 'unl-125-219');
  const d = hand(g, 0)[0];
  const h0 = hand(g, 0).length;
  g = playAct(g, 0, s); g = resolveAll(g);
  g = answer(g, 'chooseCards', d);
  g = resolveAll(g);
  assert.equal(zoneOf(g, d), 'trash');
  assert.equal(hand(g, 0).length, h0 - 1 - 1 + 2);
});

test('unl-126 Megatusk: Spend 3 XP: your units here gain Ganking this turn', () => {
  let g = game();
  setXp(g, 0, 3);
  const mt = put(g, 0, 'unl-126-219', 0), a = put(g, 0, 't-u1', 0), b = put(g, 0, 't-u1', 'base');
  const [idx] = abilities(g, 0, mt);
  g = activate(g, 0, mt, idx); g = resolveAll(g);
  assert.ok(hasKw(g, mt, 'Ganking') && hasKw(g, a, 'Ganking'));
  assert.equal(hasKw(g, b, 'Ganking'), false);
  assert.equal(xp(g, 0), 0);
});

test('unl-127 Mister Root: gain 2 XP when moving to a battlefield (not to base); Accelerate', () => {
  let g = game();
  const r = put(g, 0, 'unl-127-219', 'base');
  assert.ok(hasKw(g, r, 'Accelerate'));
  g = act(g, { type: 'move', player: 0, units: [r], to: 1 });
  g = resolveCombat(g, 0);
  assert.equal(xp(g, 0), 2);
  makeCtx(g, r, 0).move(r, 'base');
  assert.equal(xp(g, 0), 2);
});

test('unl-129 Vicious Snapjaws: gain 1 XP when another friendly unit dies', () => {
  let g = game();
  setRunes(g, 0, { Order: 6 });
  put(g, 0, 'unl-129-219', 'base');
  const f = put(g, 0, 't-u1', 'base'), e = put(g, 1, 't-u1', 0);
  const l1 = handCard(g, 0, 'ven-127-166');
  g = playAct(g, 0, l1); g = answer(g, 'chooseTargets', e); g = resolveAll(g);
  assert.equal(xp(g, 0), 0, 'enemy death');
  const l2 = handCard(g, 0, 'ven-127-166');
  g = playAct(g, 0, l2); g = answer(g, 'chooseTargets', f); g = resolveAll(g);
  assert.equal(xp(g, 0), 1);
});

test('unl-132 Angler Beast: returns all units with 2 Might or less to their owners\' hands', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 6 });
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 1, 't-u1', 0), c3 = put(g, 1, 't-u3', 0);
  const ab = handCard(g, 0, 'unl-132-219');
  g = playAct(g, 0, ab, 'base'); g = resolveAll(g);
  assert.equal(zoneOf(g, a), 'hand'); assert.equal(zoneOf(g, b), 'hand'); assert.equal(zoneOf(g, c3), 'battlefield');
  assert.equal(zoneOf(g, ab), 'base');
});

test('unl-135 Insightful Investigator: reveal; may spend 2 XP to make them discard a chosen card and draw 1', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 3 });
  setXp(g, 0, 2);
  const card = g.players[1].hand[0];
  const h1 = g.players[1].hand.length;
  const ii = handCard(g, 0, 'unl-135-219');
  g = playAct(g, 0, ii, 'base'); g = resolveAll(g);
  g = answer(g, 'optional', 'yes');
  g = answer(g, 'chooseCards', card);
  g = resolveAll(g);
  assert.equal(zoneOf(g, card), 'trash');
  assert.equal(g.players[1].hand.length, h1);
  assert.equal(xp(g, 0), 0);
  // without XP: no offer
  let h = game();
  setRunes(h, 0, { Chaos: 3 });
  const ii2 = handCard(h, 0, 'unl-135-219');
  h = playAct(h, 0, ii2, 'base'); h = resolveAll(h);
  assert.equal(isAsking(h), false);
});

test("unl-136 Scryer's Bloom: enters exhausted; Kill this, [1], [T]: Predict 2, then draw 1, gain 1 XP", () => {
  let g = game();
  setRunes(g, 0, { Chaos: 2 });
  const sb = handCard(g, 0, 'unl-136-219');
  g = playAct(g, 0, sb, 'base'); g = resolveAll(g);
  assert.equal(g.objects[sb].exhausted, true);
  assert.equal(abilities(g, 0, sb).length, 0);
  g.objects[sb].exhausted = false;
  const [idx] = abilities(g, 0, sb);
  const h0 = hand(g, 0).length;
  g = activate(g, 0, sb, idx);
  assert.equal(zoneOf(g, sb), 'trash');
  g = resolveAll(g);
  g = answer(g, 'chooseCards');                       // predict: recycle none
  if (isAsking(g, 'chooseOrder')) g = answer(g, 'chooseOrder', optionIds(g)[0]);
  g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0 + 1);
  assert.equal(xp(g, 0), 1);
});

test('unl-140 Conscription: Might 3 or less; spending 5 XP lets you take any enemy unit at a battlefield', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 7 });
  const small = put(g, 1, 't-u3', 0), big = put(g, 1, 't-u5', 1);
  const s = handCard(g, 0, 'unl-140-219');
  g = playAct(g, 0, s);
  g = resolveAll(g);
  assert.equal(g.objects[small].controller, 0);
  assert.equal(zoneOf(g, small), 'base');
  assert.equal(g.objects[small].exhausted, true);
  // with XP
  let h = game();
  setRunes(h, 0, { Chaos: 7 });
  setXp(h, 0, 5);
  const small2 = put(h, 1, 't-u3', 0), big2 = put(h, 1, 't-u5', 1);
  const s2 = handCard(h, 0, 'unl-140-219');
  h = playAct(h, 0, s2);
  h = answer(h, 'optional', 'yes');
  assert.ok(optionIds(h).includes(big2) && optionIds(h).includes(small2));
  h = answer(h, 'chooseTargets', big2);
  h = resolveAll(h);
  assert.equal(h.objects[big2].controller, 0);
  assert.equal(xp(h, 0), 0);
  void big;
});

test("unl-143 Kha'Zix (Chaos): attacking an enemy unit that is alone: +2 this turn and gain 2 XP; Ambush", () => {
  let g = game();
  const k = put(g, 0, 'unl-143-219', 'base');
  assert.ok(hasKw(g, k, 'Ambush'));
  setController(g, 0, 1);
  const e = put(g, 1, 't-u5', 0);
  g = attack(g, 0, [k], 0);
  assert.equal(xp(g, 0), 2);
  assert.equal(zoneOf(g, e), 'trash', '6 Might beats 5');
  assert.equal(zoneOf(g, k), 'battlefield');
});

test('unl-151 Bandle Soldier: Level 3 — enters ready', () => {
  for (const x of [0, 3]) {
    let g = game();
    setRunes(g, 0, { Order: 5 });
    setXp(g, 0, x);
    const b = handCard(g, 0, 'unl-151-219');
    g = playAct(g, 0, b, 'base'); g = resolveAll(g);
    assert.equal(g.objects[b].exhausted, x < 3);
  }
});

test('unl-157 Scrutinizing Sergeant: gain 1 XP for each friendly unit', () => {
  let g = game();
  setRunes(g, 0, { Order: 6 });
  put(g, 0, 't-u1', 'base'); put(g, 0, 't-u1', 0); put(g, 1, 't-u1', 1);
  const s = handCard(g, 0, 'unl-157-219');
  g = playAct(g, 0, s, 'base'); g = resolveAll(g);
  assert.equal(xp(g, 0), 3);
});

test('unl-163 Mageseeker Investigator: opponents pay [A] per extra unit moved to my battlefield', () => {
  let g = game();
  put(g, 0, 'unl-163-219', 0);
  setRunes(g, 1, {});
  g = nextTurn(g);
  setRunes(g, 1, {});
  const a = put(g, 1, 't-u1', 'base'), b = put(g, 1, 't-u1', 'base');
  const moves = (h: typeof g) => getLegalActions(h, 1).filter(x => x.type === 'move' && x.to === 0) as { units: string[] }[];
  assert.equal(moves(g).some(x => x.units.length === 2), false, 'two units need [A]');
  assert.equal(moves(g).some(x => x.units.length === 1), true, 'a single unit moves freely');
  setRunes(g, 1, { Fury: 1 });
  assert.equal(moves(g).some(x => x.units.length === 2), true, 'affordable with one rune');
  void a; void b;
});

test('unl-164 Safety Inspector: each player kills one of their units; paying 3 XP exempts you', () => {
  let g = game();
  setRunes(g, 0, { Order: 6 });
  const mine1 = put(g, 0, 't-u1', 'base');
  const opp1 = put(g, 1, 't-u1', 0), opp2 = put(g, 1, 't-u2', 0);
  const si = handCard(g, 0, 'unl-164-219');
  g = playAct(g, 0, si, 'base');
  g = resolveAll(g);
  assert.equal(g.pending?.player, 0);
  g = answer(g, 'chooseCards', mine1);
  assert.equal(g.pending?.player, 1, 'the opponent chooses their own unit');
  g = answer(g, 'chooseCards', opp2);
  g = resolveAll(g);
  assert.equal(zoneOf(g, mine1), 'trash'); assert.equal(zoneOf(g, opp2), 'trash'); assert.equal(zoneOf(g, opp1), 'battlefield');
  // paid
  let h = game();
  setRunes(h, 0, { Order: 6 });
  setXp(h, 0, 3);
  const m1 = put(h, 0, 't-u1', 'base');
  const o1 = put(h, 1, 't-u1', 0);
  const si2 = handCard(h, 0, 'unl-164-219');
  h = playAct(h, 0, si2, 'base');
  h = answer(h, 'optional', 'yes');
  h = resolveAll(h);
  assert.equal(zoneOf(h, m1), 'base'); assert.equal(zoneOf(h, o1), 'trash');
  assert.equal(xp(h, 0), 0);
});

test('unl-178 Poppy (Order): may spend 3 XP to cost [3] less; Ambush and Tank', () => {
  let g = game();
  setRunes(g, 0, { Order: 3 });
  const p = handCard(g, 0, 'unl-178-219');
  assert.equal(canPlayNow(g, 0, p), false);
  setXp(g, 0, 3);
  assert.ok(canPlayNow(g, 0, p));
  g = playAct(g, 0, p, 'base');
  // CR 355.16 / F-3c: only affordable with the discount, so the optional cost is required (not offered as a choice)
  g = resolveAll(g);
  assert.equal(zoneOf(g, p), 'base');
  assert.equal(xp(g, 0), 0);
  assert.ok(hasKw(g, p, 'Ambush') && hasKw(g, p, 'Tank'));
});

test('unl-191 Wuju Master: Level 6 — your units +1; Level 11 — your units enter ready', () => {
  let g = game();
  legend(g, 0, 'unl-191-219');
  setRunes(g, 0, { Fury: 2 });
  const u = put(g, 0, 't-u2', 'base'), e = put(g, 1, 't-u2', 0);
  g.ex.dirty = true;
  assert.equal(m(g, u), 2);
  setXp(g, 0, 6); g.ex.dirty = true;
  assert.equal(m(g, u), 3); assert.equal(m(g, e), 2);
  const n1 = handCard(g, 0, 't-u1');
  g = playAct(g, 0, n1, 'base'); g = resolveAll(g);
  assert.equal(g.objects[n1].exhausted, true);
  setXp(g, 0, 11);
  const n2 = handCard(g, 0, 't-u1');
  g = playAct(g, 0, n2, 'base'); g = resolveAll(g);
  assert.equal(g.objects[n2].exhausted, false);
});

test('unl-192 Alpha Strike: a friendly unit deals its Might split among enemy units; gain 1 XP per kill', () => {
  let g = game();
  setRunes(g, 0, { Calm: 2, Body: 2 });
  const f = put(g, 0, 't-u5', 'base');
  const e1 = put(g, 1, 't-u2', 0), e2 = put(g, 1, 't-u4', 1);
  const s = handCard(g, 0, 'unl-192-219');
  g = playAct(g, 0, s);
  g = answer(g, 'chooseTargets', e1, e2);
  g = resolveAll(g);
  assert.ok(isAsking(g, 'chooseNumber'));
  g = answer(g, 'chooseNumber', '2');
  g = resolveAll(g);
  assert.equal(zoneOf(g, e1), 'trash');
  assert.equal(g.objects[e2].damage, 3);
  assert.equal(xp(g, 0), 1);
  void f;
});

test('unl-201 Voidreaver: gain 1 XP when you win a combat; Spend 1 XP, [T]: buff; Spend 2 XP, [T]: move an exhausted friendly unit to base', () => {
  let g = game();
  const l = legend(g, 0, 'unl-201-219');
  const a = put(g, 0, 't-u3', 'base');
  setController(g, 0, 1);
  put(g, 1, 't-u1', 0);
  g = attack(g, 0, [a], 0);
  assert.equal(xp(g, 0), 1);
  const idx = abilities(g, 0, l);
  assert.equal(idx.length, 1, 'only the 1 XP ability is affordable');
  g = activate(g, 0, l, idx[0]);
  g = resolveAll(g);
  assert.equal(g.objects[a].counters.buff, 1);
  assert.equal(g.objects[l].exhausted, true);
  g.objects[l].exhausted = false;
  setXp(g, 0, 2);
  const idx2 = abilities(g, 0, l).filter(i => i !== idx[0]);
  g = activate(g, 0, l, idx2[0]);
  g = resolveAll(g);
  assert.equal(zoneOf(g, a), 'base');
  assert.equal(xp(g, 0), 0);
});

test('unl-203 Keeper of the Hammer: gain 1 XP when you hold; Spend 3 XP, [T]: draw 1', () => {
  let g = game();
  legend(g, 1, 'unl-203-219');
  setController(g, 0, 1);
  put(g, 1, 't-u2', 0);
  g = nextTurn(g);
  assert.equal(xp(g, 1), 1);
  setXp(g, 1, 3);
  const l = g.players[1].legend;
  const [idx] = abilities(g, 1, l);
  const h0 = hand(g, 1).length;
  g = activate(g, 1, l, idx); g = resolveAll(g);
  assert.equal(hand(g, 1).length, h0 + 1);
  assert.equal(xp(g, 1), 0);
});

void readyRunes; void putFacedown; void canPlayNow;
