// B4: attack / defend / conquer / hold / win-combat triggers and combat-damage rules.
import { test } from 'node:test';
import {
  assert, game, put, runes, handCard, setController, play, mightOf, kwVal, answer, pend, settle, passAll, optIds, choose,
  zoneOf, loc, combatSetup, attack, toNextTurn, setBattlefield, domainRunes, drainRunes, handSize, activate, act, resolveAll,
  getLegalActions, log, move, toTurnOf, passChain,
} from './_util.ts';

// ---------------------------------------------------------------- conquer

test('Tryndamere: conquering after an attack with 5+ excess damage assigned scores 1 more point', () => {
  let g = game();
  const { atk } = combatSetup(g, ['ogn-034-298'], ['t-u2']);
  g = settle(attack(g, atk));
  assert.equal(g.players[0].points, 2);         // conquer + Tryndamere (8 into a 2-Might unit = 6 excess)
});

test('Tryndamere: only 2 excess damage -> no bonus point', () => {
  let g = game();
  const { atk } = combatSetup(g, ['ogn-034-298'], ['t-u3', 't-u3']);
  g = settle(attack(g, atk));
  assert.equal(g.players[0].points, 1);
});

test('Tryndamere: conquering without an attack (empty battlefield) gives no bonus', () => {
  let g = game();
  const t = put(g, 0, 'ogn-034-298', 'base');
  g = settle(move(g, 0, [t], 1));
  assert.equal(g.players[0].points, 1);
});

test('Vayne: when she conquers you may pay [1] to return her to hand (accept, decline, unaffordable)', () => {
  let g = game();
  runes(g, 0, 1);
  const { atk } = combatSetup(g, ['ogn-035-298'], ['t-u1']);
  g = passChain(attack(g, atk));
  g = settle(g);
  // conquer trigger asks
  let h = game();
  runes(h, 0, 1);
  const r = combatSetup(h, ['ogn-035-298'], ['t-u1']);
  h = attack(h, r.atk);
  for (let i = 0; i < 20 && !(h.pending?.kind === 'optional'); i++) h = h.pending?.inStep ? choose(h, optIds(h)[0]) : act(h, { type: 'pass', player: h.pending!.player });
  assert.equal(pend(h).kind, 'optional');
  const ready0 = h.players[0].runesInPlay.filter(x => !h.objects[x].exhausted).length;
  h = settle(answer(h, 'optional', 'yes'));
  assert.equal(zoneOf(h, r.atk[0]), 'hand');
  assert.equal(h.players[0].runesInPlay.filter(x => !h.objects[x].exhausted).length, ready0 - 1);
  // decline
  let k = game();
  const r2 = combatSetup(k, ['ogn-035-298'], ['t-u1']);
  k = attack(k, r2.atk);
  for (let i = 0; i < 20 && !(k.pending?.kind === 'optional'); i++) k = k.pending?.inStep ? choose(k, optIds(k)[0]) : act(k, { type: 'pass', player: k.pending!.player });
  k = settle(answer(k, 'optional', 'no'));
  assert.equal(loc(k, r2.atk[0]), 0);
  // can't pay: no prompt
  let m = game();
  drainRunes(m, 0);
  const r3 = combatSetup(m, ['ogn-035-298'], ['t-u1']);
  m = attack(m, r3.atk);
  m = settle(m);
  assert.equal(loc(m, r3.atk[0]), 0);
  assert.ok(!log(m).some(l => l.includes('return Vayne')));
  void g;
});

test("Kai'Sa, Survivor: draws 1 when she conquers", () => {
  let g = game();
  const k = put(g, 0, 'ogn-039-298', 'base');
  const n = handSize(g, 0);
  g = settle(move(g, 0, [k], 1));
  assert.equal(handSize(g, 0), n + 1);
});

test('Qiyana: on conquer, choose draw 1 or channel 1 rune exhausted', () => {
  let g = game();
  const q = put(g, 0, 'ogn-155-298', 'base');
  g = passAll(move(g, 0, [q], 1));
  g = passAll(g);
  assert.equal(pend(g).kind, 'chooseMode');
  const runes0 = g.players[0].runesInPlay.length;
  g = choose(g, '1');
  g = settle(g);
  assert.equal(g.players[0].runesInPlay.length, runes0 + 1);
  assert.equal(g.objects[g.players[0].runesInPlay.at(-1)!].exhausted, true);
});

test('Sneaky Zeebles: conquering adds [A] immediately (no chain)', () => {
  let g = game();
  const z = put(g, 0, 'rad-076-167', 'base');
  g = settle(move(g, 0, [z], 1));
  const pool = g.players[0].pool.power;
  assert.equal(Object.values(pool).reduce((s, n) => s + (n ?? 0), 0), 1);
});

test('Jarvan IV, Martial Paragon: conquer with a friendly Deploy gear here channels 1 exhausted', () => {
  let g = game();
  const j = put(g, 0, 'rad-091-167', 'base');
  put(g, 0, 'rad-156-167', 1);
  const n = g.players[0].runesInPlay.length;
  g = settle(move(g, 0, [j], 1));
  assert.equal(g.players[0].runesInPlay.length, n + 1);
  let h = game();
  const j2 = put(h, 0, 'rad-091-167', 'base');
  const n2 = h.players[0].runesInPlay.length;
  h = settle(move(h, 0, [j2], 1));
  assert.equal(h.players[0].runesInPlay.length, n2);
});

test('Jarvan IV, Martial Paragon: your Deploy gear can be played at Action speed (showdown)', () => {
  let g = game();
  put(g, 0, 'rad-091-167', 'base');
  const u = put(g, 0, 't-u1', 'base');
  runes(g, 0, 2); domainRunes(g, 0, 1, 'Body');
  const std = handCard(g, 0, 'rad-156-167');
  g = move(g, 0, [u], 1);                       // non-combat showdown at the empty battlefield, P0 focus
  assert.equal(pend(g).kind, 'showdownAction');
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === std));
  let h = game();
  const u2 = put(h, 0, 't-u1', 'base');
  runes(h, 0, 2); domainRunes(h, 0, 1, 'Body');
  const std2 = handCard(h, 0, 'rad-156-167');
  h = move(h, 0, [u2], 1);
  assert.ok(!getLegalActions(h, 0).some(a => a.type === 'playCard' && a.obj === std2));
});

test('Swain: conquer scores 1 if you played a non-token unit, a non-token gear and a spell this turn', () => {
  let g = game();
  const s = put(g, 0, 'ven-065-166', 'base');
  runes(g, 0, 6);
  const tgt = put(g, 1, 't-u3', 'base');
  g = play(g, 0, handCard(g, 0, 't-u1'), 'base');
  g = play(g, 0, handCard(g, 0, 't-gold'), 'base');
  g = play(g, 0, handCard(g, 0, 'ts-zap'));
  if (pend(g).kind === 'chooseTargets') g = choose(g, tgt);
  g = resolveAll(g);
  g = settle(move(g, 0, [s], 1));
  assert.equal(g.players[0].points, 2);
  let h = game();
  const s2 = put(h, 0, 'ven-065-166', 'base');
  runes(h, 0, 3);
  h = play(h, 0, handCard(h, 0, 't-u1'), 'base');
  h = settle(move(h, 0, [s2], 1));
  assert.equal(h.players[0].points, 1);
});

// ---------------------------------------------------------------- hold

test('Ahri, Alluring: when she holds, score 1 point', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 'ogn-066-298', 0);
  g = settle(toNextTurn(g));
  assert.equal(g.players[0].points, 2);
});

test('Blitzcrank: played to a battlefield may pull an enemy unit there; returns to hand when he holds', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const e = put(g, 1, 't-u2', 'base');
  runes(g, 0, 5); domainRunes(g, 0, 1, 'Calm');
  const b = handCard(g, 0, 'ogn-067-298');
  g = play(g, 0, b, 0);
  g = answer(g, 'chooseTargets', e);
  g = passChain(g);
  assert.equal(loc(g, e), 0);
  // hold: return to hand
  let h = game();
  setController(h, 0, 0);
  const b2 = put(h, 0, 'ogn-067-298', 0);
  h = settle(toNextTurn(h));
  assert.equal(zoneOf(h, b2), 'hand');
});

test('Blitzcrank: the pull is optional', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const e = put(g, 1, 't-u2', 'base');
  runes(g, 0, 5); domainRunes(g, 0, 1, 'Calm');
  const b = handCard(g, 0, 'ogn-067-298');
  g = play(g, 0, b, 0);
  g = answer(g, 'chooseTargets');
  g = resolveAll(g);
  assert.equal(loc(g, e), 'base');
});

test("K'Sante, Courageous: hold channels 1 rune (ready)", () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 'rad-086-167', 0);
  g = toNextTurn(g);
  g = settle(g);
  // turn start channel (2) + hold channel (1)
  assert.ok(g.players[0].runesInPlay.length >= 2 + 2 + 1);
});

test('Evelynn, In Control: hold scores 1 more only if you control a facedown card here', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 'rad-109-167', 0);
  const fd = put(g, 0, 't-hidden', 0);
  g.objects[fd].zone = 'facedown'; g.objects[fd].faceDown = true; g.objects[fd].hiddenTurn = 0;
  g = settle(toNextTurn(g));
  assert.equal(g.players[0].points, 2);
  let h = game();
  setController(h, 0, 0);
  put(h, 0, 'rad-109-167', 0);
  h = settle(toNextTurn(h));
  assert.equal(h.players[0].points, 1);
});

test('Dunebreaker: hold draws 2', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 'sfd-027-221', 0);
  const n = handSize(g, 0);
  g = settle(toNextTurn(g));
  assert.equal(handSize(g, 0), n + 1 /* draw phase */ + 2);
});

test('Vilemaw: hold draws 1', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 'unl-060-219', 0);
  const n = handSize(g, 0);
  g = settle(toNextTurn(g));
  assert.equal(handSize(g, 0), n + 2);
});

test('Shen, Scourge of Shadows / Shen, Leader: hold rewards need exactly one other unit you control here', () => {
  let g = game();
  setController(g, 0, 0); setController(g, 1, 0);
  put(g, 0, 'ven-042-166', 0); put(g, 0, 't-u1', 0);
  put(g, 0, 'ven-138-166', 1); put(g, 0, 't-u1', 1); put(g, 0, 't-u1', 1);
  const n = handSize(g, 0);
  g = settle(toNextTurn(g));
  assert.equal(handSize(g, 0), n + 2);           // draw phase + Scourge
  assert.equal(g.players[0].points, 2);          // two holds, Leader has 2 others: no bonus
  let h = game();
  setController(h, 0, 0);
  put(h, 0, 'ven-138-166', 0); put(h, 0, 't-u1', 0);
  h = settle(toNextTurn(h));
  assert.equal(h.players[0].points, 2);
});

test('Iascylla: when she holds, at the start of your Main Phase you may move an enemy unit to her battlefield', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 'unl-050-219', 0);
  const e = put(g, 1, 't-u2', 'base');
  g = toNextTurn(g);
  for (let i = 0; i < 20 && !(g.pending?.kind === 'chooseTargets'); i++) g = g.pending!.inStep ? choose(g, optIds(g)[0]) : act(g, { type: 'pass', player: g.pending!.player });
  assert.equal(g.phase, 'action');
  g = answer(g, 'chooseTargets', e);
  g = settle(g);
  assert.equal(loc(g, e) === 0 || zoneOf(g, e) === 'trash', true);
});

test('Amateur Recital: when you hold here you may move a unit at a battlefield to its base (battlefield owned by the opponent)', () => {
  let g = game();
  setBattlefield(g, 0, 'unl-207-219', 1);
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const e = put(g, 1, 't-u2', 1);
  setController(g, 1, 1);
  g = toNextTurn(g);
  for (let i = 0; i < 20 && !(g.pending?.kind === 'chooseTargets'); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  assert.equal(pend(g).player, 0, 'the holding player decides');
  g = answer(g, 'chooseTargets', e);
  g = settle(g);
  assert.equal(loc(g, e), 'base');
});

test('Demacian Standard: when you hold here you may return it to hand', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const s = put(g, 0, 'rad-156-167', 0);
  g = toNextTurn(g);
  for (let i = 0; i < 20 && !(g.pending?.kind === 'optional'); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  g = settle(answer(g, 'optional', 'yes'));
  assert.equal(zoneOf(g, s), 'hand');
});

// ---------------------------------------------------------------- attack / defend triggers

test('Leona, Determined: attacking stuns an enemy unit here (stunned units deal no combat damage)', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['ogn-238-298'], ['t-u5']);
  g = attack(g, atk);
  g = passChain(g);
  assert.equal(g.objects[def[0]].stunned, true);
  g = settle(g);
  assert.equal(zoneOf(g, atk[0]), 'base');       // survived (t-u5 dealt nothing), recalled
});

test('Vi, Peacekeeper: attacking stuns an enemy unit here (chosen among several)', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['unl-176-219'], ['t-u2', 't-u3']);
  g = attack(g, atk);
  g = answer(g, 'chooseTargets', def[1]);
  g = passChain(g);
  assert.equal(g.objects[def[1]].stunned, true);
  assert.ok(!g.objects[def[0]].stunned);
});

test('Ahri, Inquisitive: attacking gives an enemy here -2 this turn, to a minimum of 1', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['ogn-119-298'], ['t-u2']);
  g = passChain(attack(g, atk));
  assert.equal(mightOf(g, def[0]), 1);
  let h = game();
  const r = combatSetup(h, ['ogn-119-298'], ['t-u5']);
  h = passChain(attack(h, r.atk));
  assert.equal(mightOf(h, r.def[0]), 3);
});

test('Ahri, Inquisitive: also triggers when defending', () => {
  let g = game();
  const { atk } = combatSetup(g, ['t-u4'], ['ogn-119-298']);
  g = passChain(attack(g, atk));
  assert.equal(mightOf(g, atk[0]), 2);
});

test('Dune Drake: +2 when attacking only if there is a ready enemy unit here', () => {
  let g = game();
  const { atk } = combatSetup(g, ['ogn-131-298'], ['t-u1']);
  g = passChain(attack(g, atk));
  assert.equal(mightOf(g, atk[0]), 7);
  let h = game();
  const r = combatSetup(h, ['ogn-131-298'], ['t-u1']);
  h.objects[r.def[0]].exhausted = true;
  h = passChain(attack(h, r.atk));
  assert.equal(mightOf(h, r.atk[0]), 5);
});

test('Warwick: attacking kills all damaged enemy units here', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['ogn-159-298'], ['t-u5', 't-u5', 't-u1']);
  g.objects[def[0]].damage = 1;
  put(g, 1, 't-u2', 1, { damage: 1 });
  g = passChain(attack(g, atk));
  assert.equal(zoneOf(g, def[0]), 'trash');
  assert.equal(zoneOf(g, def[1]), 'battlefield');
});

test('Mask of Foresight: a friendly unit attacking alone gets +1 this turn; not when not alone', () => {
  let g = game();
  put(g, 0, 'ogn-060-298', 'base');
  const { atk } = combatSetup(g, ['t-u3'], ['t-u1']);
  g = passChain(attack(g, atk));
  assert.equal(mightOf(g, atk[0]), 4);
  let h = game();
  put(h, 0, 'ogn-060-298', 'base');
  const r = combatSetup(h, ['t-u3', 't-u3'], ['t-u5']);
  h = passChain(attack(h, r.atk));
  assert.equal(mightOf(h, r.atk[0]), 3);
});

test('Mask of Foresight: also for a friendly unit defending alone (opponent attacks)', () => {
  let g = game();
  put(g, 1, 'ogn-060-298', 'base');
  const { atk, def } = combatSetup(g, ['t-u3'], ['t-u2']);
  g = passChain(attack(g, atk));
  assert.equal(mightOf(g, def[0]), 3);
});

test('Lucian: attacking deals damage equal to his Assault to an enemy unit here', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['sfd-028-221'], ['t-u2']);
  g = passChain(attack(g, atk));
  assert.equal(g.objects[def[0]].damage, 1);
});

test('Ezreal, Dashing: attack/defend deals his Might to an enemy here; he deals no combat damage; [C]: Action move to base', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['sfd-082-221'], ['t-u5']);
  g = passChain(attack(g, atk));
  assert.equal(g.objects[def[0]].damage, 3);
  g = settle(g);
  assert.equal(zoneOf(g, def[0]), 'battlefield', 'no combat damage from Ezreal: 3 < 5');
  // activated: move to base at Action speed during a showdown
  let h = game();
  runes(h, 0, 1); domainRunes(h, 0, 1, 'Mind');
  const ez = put(h, 0, 'sfd-082-221', 'base');
  h = move(h, 0, [ez], 1);
  assert.equal(pend(h).kind, 'showdownAction');
  const a = getLegalActions(h, 0).find(x => x.type === 'activate' && x.obj === ez);
  assert.ok(a);
  h = resolveAll(act(h, a!));
  assert.equal(loc(h, ez), 'base');
});

test('Graves: attack deals his Might to all enemy units here; he deals no combat damage', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['rad-085-167'], ['t-u3', 't-u2']);
  g = settle(attack(g, atk));
  assert.equal(zoneOf(g, def[0]), 'trash');
  assert.equal(zoneOf(g, def[1]), 'trash');
  assert.equal(g.players[0].points, 1);
  let h = game();
  const r = combatSetup(h, ['rad-085-167'], ['t-u5']);
  h = settle(attack(h, r.atk));
  assert.equal(zoneOf(h, r.def[0]), 'battlefield', '4 from the trigger, 0 combat damage');
  assert.equal(zoneOf(h, r.atk[0]), 'trash');
});

test("K'Sante, Dauntless: defending doubles the Shield of a unit you control here", () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['t-u1'], ['rad-045-167', 't-shield']);
  g = attack(g, atk);
  g = answer(g, 'chooseTargets', def[1]);
  g = passChain(g);
  assert.equal(kwVal(g, def[1], 'Shield'), 4);
  assert.equal(mightOf(g, def[1]), 6);
});

test('Fiora, Peerless: attacking one on one doubles her Might this combat (not when outnumbered)', () => {
  let g = game();
  const { atk } = combatSetup(g, ['sfd-110-221'], ['t-u5']);
  g = passChain(attack(g, atk));
  assert.equal(mightOf(g, atk[0]), 6);
  g = settle(g);
  assert.equal(loc(g, atk[0]), 0);               // 6 vs 5: Fiora survives and conquers
  let h = game();
  const r = combatSetup(h, ['sfd-110-221'], ['t-u1', 't-u1']);
  h = passChain(attack(h, r.atk));
  assert.equal(mightOf(h, r.atk[0]), 3);
});

test('Jarvan IV, Royal Heir: when he attacks you may move a unit you control to his battlefield', () => {
  let g = game();
  const { atk } = combatSetup(g, ['rad-133-167'], ['t-u5']);
  const helper = put(g, 0, 't-u2', 'base');
  g = attack(g, atk);
  g = answer(g, 'chooseTargets', helper);
  g = passChain(g);
  assert.equal(loc(g, helper), 0);
  assert.equal(g.objects[helper].combatRole, 'attacker');
});

test('Demacian Standard: when friendly units attack here, give one of them +2 this turn', () => {
  let g = game();
  put(g, 0, 'rad-156-167', 0);
  const { atk } = combatSetup(g, ['t-u2', 't-u3'], ['t-u5']);
  g = attack(g, atk);
  g = answer(g, 'chooseTargets', atk[0]);
  g = passChain(g);
  assert.equal(mightOf(g, atk[0]), 4);
  assert.equal(mightOf(g, atk[1]), 3);
});

test('Icevale Archer: may pay [1] when attacking to give a unit here -1 (decline / accept)', () => {
  let g = game();
  runes(g, 0, 1);
  const { atk, def } = combatSetup(g, ['unl-065-219'], ['t-u3']);
  g = attack(g, atk);
  g = answer(g, 'optional', 'no');
  g = passChain(g);
  assert.equal(mightOf(g, def[0]), 3);
  let h = game();
  runes(h, 0, 1);
  const r = combatSetup(h, ['unl-065-219'], ['t-u3']);
  h = attack(h, r.atk);
  h = answer(h, 'optional', 'yes');
  h = answer(h, 'chooseTargets', r.def[0]);
  h = passChain(h);
  assert.equal(mightOf(h, r.def[0]), 2);
});

test('Sinister Poro: may pay [1] when attacking to move an enemy unit here to its base', () => {
  let g = game();
  runes(g, 0, 1);
  const { atk, def } = combatSetup(g, ['unl-137-219'], ['t-u5']);
  g = attack(g, atk);
  g = answer(g, 'optional', 'yes');
  g = settle(g);
  assert.equal(loc(g, def[0]), 'base');
  assert.equal(loc(g, atk[0]), 0);
  assert.equal(g.battlefields[0].controller, 0);
});

test('Baccai Reaper: may pay [C] when attacking for [Assault 2] this turn', () => {
  let g = game();
  domainRunes(g, 0, 1, 'Fury');
  const { atk } = combatSetup(g, ['ven-009-166'], ['t-u5']);
  g = attack(g, atk);
  g = answer(g, 'optional', 'yes');
  g = passChain(g);
  assert.equal(kwVal(g, atk[0], 'Assault'), 2);
  assert.equal(mightOf(g, atk[0]), 6);
});

test('Renekton: attacking with 4 or fewer runes deals 2 to all enemy units here; not with 5+', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['ven-019-166'], ['t-u2', 't-u3']);
  g = passChain(attack(g, atk));
  assert.equal(zoneOf(g, def[0]), 'trash');
  assert.equal(g.objects[def[1]].damage, 2);
  let h = game();
  runes(h, 0, 3);
  const r = combatSetup(h, ['ven-019-166'], ['t-u2']);
  h = passChain(attack(h, r.atk));
  assert.equal(h.objects[r.def[0]].damage, 0);
});

test('Twilight Reveler: attacking readies another friendly unit', () => {
  let g = game();
  const { atk } = combatSetup(g, ['ven-020-166'], ['t-u5']);
  const tired = put(g, 0, 't-u2', 'base', { ready: false });
  g = attack(g, atk);
  if (pend(g).kind === 'chooseTargets') g = choose(g, tired);
  g = passChain(g);
  assert.equal(g.objects[tired].exhausted, false);
});

test('Corrupted Dragon: attacking may move any number of enemy units here with 5 or less Might to base', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['ven-091-166'], ['t-u2', 't-u5', 'unl-060-219']);
  g = attack(g, atk);
  assert.deepEqual(optIds(g).sort(), [def[0], def[1]].sort(), 'Vilemaw (8) is not eligible');
  g = choose(g, def[0], def[1]);
  g = passChain(g);
  assert.equal(loc(g, def[0]), 'base');
  assert.equal(loc(g, def[1]), 'base');
  assert.equal(loc(g, def[2]), 0);
});

test('Kennen: when played or attacking, may pay [2] to stun a unit', () => {
  let g = game();
  runes(g, 0, 5); domainRunes(g, 0, 1, 'Order');
  const e = put(g, 1, 't-u3', 'base');
  const k = handCard(g, 0, 'ven-135-166');
  g = play(g, 0, k, 'base');
  g = answer(g, 'optional', 'yes');
  g = answer(g, 'chooseTargets', e);
  g = resolveAll(g);
  assert.equal(g.objects[e].stunned, true);
  let h = game();
  runes(h, 0, 2);
  const r = combatSetup(h, ['ven-135-166'], ['t-u3']);
  h = attack(h, r.atk);
  h = answer(h, 'optional', 'yes');
  assert.deepEqual(optIds(h).sort(), [r.atk[0], r.def[0]].sort(), 'any unit');
  h = answer(h, 'chooseTargets', r.def[0]);
  h = passChain(h);
  assert.equal(h.objects[r.def[0]].stunned, true);
  assert.equal(mightOf(h, r.atk[0]), 4, '+2 while a stunned enemy unit is here');
});

test('Daisy!: attacking stuns an enemy here only while your units have Bird, Cat, Dog and Poro', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['unl-196-219'], ['t-u5']);
  for (const id of ['unl-154-219', 'sfd-006-221', 'unl-137-219', 'unl-114-219']) put(g, 0, id, 'base');
  g = passChain(attack(g, atk));
  assert.equal(g.objects[def[0]].stunned, true);
  let h = game();
  const r = combatSetup(h, ['unl-196-219'], ['t-u5']);
  for (const id of ['unl-154-219', 'sfd-006-221', 'unl-137-219']) put(h, 0, id, 'base');
  h = passChain(attack(h, r.atk));
  assert.ok(!h.objects[r.def[0]].stunned);
});

test('Atakhan: when he attacks, the defender must kill one of their units here (their choice)', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['unl-170-219'], ['t-u2', 't-u3']);
  g = passChain(attack(g, atk));
  assert.equal(pend(g).player, 1);
  g = answer(g, 'chooseCards', def[1]);
  assert.equal(zoneOf(g, def[1]), 'trash');
  assert.equal(zoneOf(g, def[0]), 'battlefield');
  assert.ok(kwVal(g, atk[0], 'Ganking') > 0);
});

test('Atakhan: optional additional cost kills a friendly unit and discounts by its Energy and Power', () => {
  let g = game();
  const have = g.players[0].runesInPlay.length;
  runes(g, 0, 6 - have); domainRunes(g, 0, 2, 'Order');   // 8 runes
  const fodder = put(g, 0, 'ogn-035-298', 'base');          // Vayne: [4] + 1 power
  const a = handCard(g, 0, 'unl-170-219');
  g = play(g, 0, a, 'base');
  // only affordable with the discount: the kill is required and Vayne is the only candidate (chosen automatically)
  g = settle(g);
  assert.equal(zoneOf(g, fodder), 'trash');
  assert.equal(zoneOf(g, a), 'base');
  // declining the additional cost: full cost [10] + 3 power can't be paid -> "none" isn't offered (CR 355.16, F-3c)
  let h = game();
  const have2 = h.players[0].runesInPlay.length;
  runes(h, 0, 6 - have2); domainRunes(h, 0, 2, 'Order');
  put(h, 0, 'ogn-035-298', 'base');
  const a2 = handCard(h, 0, 'unl-170-219');
  h = play(h, 0, a2, 'base');
  h = settle(h);
  assert.equal(zoneOf(h, a2), 'base', 'played with the required kill (no "none" option to fail on)');
});

test('Crimson Pigeons / Galio: Galio deals no combat damage', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['t-u2'], ['unl-171-219']);
  g = settle(attack(g, atk));
  assert.equal(zoneOf(g, atk[0]), 'base', 'attacker survived Galio');
  assert.equal(zoneOf(g, def[0]), 'battlefield');
});

test("Orianna: deals no combat damage unless there's a friendly gear here", () => {
  let g = game();
  const { atk } = combatSetup(g, ['t-u2'], ['rad-042-167']);
  g = settle(attack(g, atk));
  assert.equal(zoneOf(g, atk[0]), 'base');
  let h = game();
  const r = combatSetup(h, ['t-u2'], ['rad-042-167']);
  put(h, 1, 'rad-156-167', 0);
  h = settle(attack(h, r.atk));
  assert.equal(zoneOf(h, r.atk[0]), 'trash');
});

test('Vilemaw: enemy units here with less Might than it deal no combat damage', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['t-u5'], ['unl-060-219']);
  g.objects[def[0]].damage = 4;
  g = settle(attack(g, atk));
  assert.equal(zoneOf(g, def[0]), 'battlefield', '5 Might attacker dealt nothing');
  assert.equal(zoneOf(g, atk[0]), 'trash');
});

test('Loyal Pup: when you defend at a battlefield, you may move it there', () => {
  let g = game();
  const { atk } = combatSetup(g, ['t-u2'], ['t-u5']);
  const pup = put(g, 1, 'sfd-126-221', 'base');
  g = attack(g, atk);
  g = answer(g, 'optional', 'yes');
  g = passChain(g);
  assert.equal(loc(g, pup), 0);
});

test('Overzealous Fan: when it defends you may kill it to move an attacking unit to its base', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['t-u5'], ['sfd-128-221']);
  g = attack(g, atk);
  g = answer(g, 'optional', 'yes');
  g = settle(g);
  assert.equal(zoneOf(g, def[0]), 'trash');
  assert.equal(loc(g, atk[0]), 'base');
  let h = game();
  const r = combatSetup(h, ['t-u1'], ['sfd-128-221']);
  h = attack(h, r.atk);
  h = answer(h, 'optional', 'no');
  h = settle(h);
  assert.equal(zoneOf(h, r.atk[0]), 'trash');
});

test('Soraka: another unit you control here with less Might is saved (healed, exhausted, recalled); stronger ones die', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['t-u5'], ['sfd-173-221', 't-u2']);
  g = settle(attack(g, atk));
  assert.equal(loc(g, def[1]), 'base');
  assert.equal(g.objects[def[1]].exhausted, true);
  assert.equal(g.objects[def[1]].damage, 0);
  let h = game();
  const r = combatSetup(h, ['t-u5'], ['sfd-173-221', 't-u4']);
  h = settle(attack(h, r.atk));
  assert.equal(zoneOf(h, r.def[1]), 'trash');
});

test('Azir: when he attacks, you may move any number of your token units to this battlefield', () => {
  let g = game();
  const { atk } = combatSetup(g, ['sfd-177-221'], ['t-u5']);
  const t1 = put(g, 0, 't-recruit', 'base'); g.objects[t1].isToken = true;
  const t2 = put(g, 0, 't-recruit', 'base'); g.objects[t2].isToken = true;
  const nt = put(g, 0, 't-u1', 'base');
  g = attack(g, atk);
  assert.ok(!optIds(g).includes(nt));
  g = choose(g, t1, t2);
  g = passChain(g);
  assert.equal(loc(g, t1), 0);
  assert.equal(loc(g, t2), 0);
});

// ---------------------------------------------------------------- win combat / die in combat / combat end

test('Corrupt Enforcer / Nidalee: winning a combat draws 1; losing does not', () => {
  for (const id of ['sfd-123-221', 'unl-114-219']) {
    let g = game();
    const { atk } = combatSetup(g, [id], ['t-u1']);
    const n = handSize(g, 0);
    g = settle(attack(g, atk));
    assert.equal(handSize(g, 0), n + 1 - (id === 'sfd-123-221' ? 1 : 0), id);   // Enforcer also discarded 1 when it moved
    let h = game();
    const r = combatSetup(h, [id], ['t-u5']);
    const n2 = handSize(h, 0);
    h = settle(attack(h, r.atk));
    assert.equal(handSize(h, 0), n2 - (id === 'sfd-123-221' ? 1 : 0), id);
  }
});

test('Draven, Audacious: first combat won each turn scores 1; dying in combat makes an opponent score 1', () => {
  let g = game();
  const { atk } = combatSetup(g, ['sfd-148-221'], ['t-u1']);
  g = settle(attack(g, atk));
  assert.equal(g.players[0].points, 2);          // conquer + Draven
  let h = game();
  const r = combatSetup(h, ['sfd-148-221'], ['t-u5', 't-u5']);
  h = settle(attack(h, r.atk));
  assert.equal(zoneOf(h, r.atk[0]), 'trash');
  assert.equal(h.players[1].points, 1);
  // dying outside combat: no point
  let k = game();
  runes(k, 0, 1);
  const d = put(k, 1, 'sfd-148-221', 'base', { damage: 4 });
  k = play(k, 0, handCard(k, 0, 'ts-zap'));
  if (pend(k).kind === 'chooseTargets') k = choose(k, d);
  k = settle(k);
  assert.equal(zoneOf(k, d), 'trash');
  assert.equal(k.players[0].points, 0);
});

test('Draven, Audacious: only the first combat won each turn scores', () => {
  let g = game();
  const d = put(g, 0, 'sfd-148-221', 'base');
  put(g, 1, 't-u1', 0); setController(g, 0, 1);
  put(g, 1, 't-u1', 1); setController(g, 1, 1);
  g = settle(move(g, 0, [d], 0));
  assert.equal(g.players[0].points, 2);
  g.objects[d].exhausted = false;
  g.objects[d].modifiers.push({ source: null, layer: 2, duration: 'endOfTurn', addKeywords: ['Ganking'], timestamp: ++g.timestamp });
  g = settle(move(g, 0, [d], 1));
  assert.equal(g.players[0].points, 3);          // second conquer, no second Draven point
});

test("Affectionate Poro: when a combat it was in ends, draw 1 if it wasn't dealt damage this turn", () => {
  let g = game();
  const { atk } = combatSetup(g, ['ven-024-166', 't-u5'], ['t-u1']);
  const n = handSize(g, 0);
  g = attack(g, atk);
  g = settle(g);
  // P0 assigns; P1 (1 Might) must damage someone: suggested assignment hits the first unit
  const poroHit = log(g).some(l => /deals 1 to Affectionate Poro/.test(l));
  assert.equal(handSize(g, 0), n + (poroHit ? 0 : 1));
  let h = game();
  const r = combatSetup(h, ['ven-024-166'], ['t-u1']);
  const n2 = handSize(h, 0);
  h = settle(attack(h, r.atk));
  assert.equal(handSize(h, 0), n2, 'it was dealt damage');
  let k = game();
  const r2 = combatSetup(k, ['ven-024-166'], []);
  put(k, 1, 'unl-171-219', 0); setController(k, 0, 1);   // Galio deals no combat damage
  const n3 = handSize(k, 0);
  k = settle(attack(k, r2.atk));
  assert.equal(handSize(k, 0), n3 + 1);
});

test('Black Rose Dignitary: Deathknell channels 1 rune exhausted', () => {
  let g = game();
  const { atk } = combatSetup(g, ['unl-152-219'], ['t-u5']);
  const n = g.players[0].runesInPlay.length;
  g = settle(attack(g, atk));
  assert.equal(zoneOf(g, atk[0]), 'trash');
  assert.equal(g.players[0].runesInPlay.length, n + 1);
  assert.equal(g.objects[g.players[0].runesInPlay.at(-1)!].exhausted, true);
});

// ---------------------------------------------------------------- Reaver's Row / Shadow (opponent's turn)

test("Reaver's Row: when you defend here you may move a friendly unit here to base (the defender decides, whoever owns the card)", () => {
  let g = game();
  setBattlefield(g, 0, 'ogn-285-298', 0);
  const { atk, def } = combatSetup(g, ['t-u5'], ['t-u2', 't-u1']);
  g = attack(g, atk);
  for (let i = 0; i < 10 && !(g.pending?.kind === 'chooseTargets'); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  assert.equal(pend(g).player, 1);
  g = answer(g, 'chooseTargets', def[0]);
  g = settle(g);
  assert.equal(loc(g, def[0]), 'base');
});

test('Shadow: [Action] [1][A], [T]: stun an enemy unit attacking here', () => {
  let g = game();
  g = toTurnOf(g, 1);
  setController(g, 0, 0);
  const s = put(g, 0, 'unl-194-219', 0);
  runes(g, 0, 2);
  const a = put(g, 1, 't-u3', 'base');
  g = move(g, 1, [a], 0);
  for (let i = 0; i < 10 && !(g.pending?.kind === 'showdownAction' && g.pending.player === 0); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  const act0 = getLegalActions(g, 0).find(x => x.type === 'activate' && x.obj === s);
  assert.ok(act0, 'Shadow can be activated in the showdown');
  g = passChain(act(g, act0!));
  assert.equal(g.objects[a].stunned, true);
  assert.equal(g.objects[s].exhausted, true);
});

// ---------------------------------------------------------------- "next time it would die"

test('Tactical Retreat / Highlander, Yi: the next time the unit would die this turn it is healed, exhausted and recalled instead', () => {
  for (const [id, dom] of [['unl-175-219', 'Order'], ['ogs-020-024', 'Calm']] as const) {
    let g = game();
    runes(g, 0, 6); domainRunes(g, 0, 1, dom);
    setController(g, 0, 0);
    const u = put(g, 0, 't-u2', 0);
    g = play(g, 0, handCard(g, 0, id));
    if (pend(g).kind === 'chooseTargets') g = choose(g, u);
    g = resolveAll(g);
    g = play(g, 0, handCard(g, 0, 'ts-zap'));
    if (pend(g).kind === 'chooseTargets') g = choose(g, u);
    g = resolveAll(g);
    assert.equal(loc(g, u), 'base', id);
    assert.equal(g.objects[u].exhausted, true);
    assert.equal(g.objects[u].damage, 0);
    // second death this turn is not prevented
    g = play(g, 0, handCard(g, 0, 'ts-zap'));
    if (pend(g).kind === 'chooseTargets') g = choose(g, u);
    g = resolveAll(g);
    assert.equal(zoneOf(g, u), 'trash', id);
  }
});

test("Zhonya's Hourglass: a friendly unit that would die is saved and the Hourglass dies instead", () => {
  let g = game();
  const z = put(g, 1, 'ogn-077-298', 'base');
  const u = put(g, 1, 't-u2', 0);
  setController(g, 0, 1);
  runes(g, 0, 1);
  g = play(g, 0, handCard(g, 0, 'ts-zap'));
  if (pend(g).kind === 'chooseTargets') g = choose(g, u);
  g = resolveAll(g);
  assert.equal(loc(g, u), 'base');
  assert.equal(g.objects[u].exhausted, true);
  assert.equal(zoneOf(g, z), 'trash');
});
