// B2: Equipment (Equip / Quick-Draw / Weaponmaster / Temporary / Unique) and equipment-matters cards.
import { test } from 'node:test';
import {
  game, mana, run, play, playNew, activate, canActivate, canPlay, put, handCard, zoneOf, assert, expectDecision, atMain, setController,
  hideAt, handSize, m, act, EQUIP, attachNow, hasKw, kwVal, real, db, RUNE, runes, type Dom,
} from './util.ts';
import { chars } from '../../../src/engine/chars.ts';
import { validateDeck } from '../../../src/engine/deck.ts';
import { deck } from '../../fixtures/cards.ts';
import type { GameState, ObjId } from '../../../src/engine/types.ts';

const endTurn = (g: GameState) => run(act(g, { type: 'endTurn', player: g.pending!.player }));

/** Equipment whose whole text is keywords: Equip cost, attach, Might bonus. */
const KEYWORD_EQUIPMENT = [
  'rad-071-167', 'rad-123-167', 'sfd-009-221', 'sfd-016-221', 'sfd-022-221', 'sfd-030-221', 'sfd-033-221', 'sfd-042-221',
  'sfd-051-221', 'sfd-056-221', 'sfd-064-221', 'sfd-073-221', 'sfd-086-221', 'sfd-095-221', 'sfd-102-221', 'sfd-108-221',
  'sfd-115-221', 'sfd-118-221', 'sfd-124-221', 'sfd-133-221', 'sfd-134-221', 'sfd-153-221', 'sfd-161-221', 'sfd-172-221',
  'sfd-186-221', 'sfd-190-221', 'sfd-191-221', 'unl-019-219', 'unl-039-219', 'unl-096-219', 'ven-011-166', 'ven-027-166',
  'ven-073-166',
];

/** give exactly the resources an "[N][C]..." cost needs (C = the card's first domain) */
function payFor(g: GameState, costStr: string, domains: string[]): void {
  const energy = [...costStr.matchAll(/\[(\d+)\]/g)].reduce((s, x) => s + Number(x[1]), 0);
  const cs = (costStr.match(/\[[CA]\]/g) ?? []).length;     // [A] (any domain) is paid like [C] here
  const dom = (domains.find(d => d !== 'Colorless') ?? 'Fury') as Dom;
  for (let i = 0; i < Math.max(energy, cs); i++) runes(g, 0, 1, RUNE[i < cs ? dom : 'Fury']);
}

for (const id of KEYWORD_EQUIPMENT) {
  const d = real[id] as typeof real[string] & { keywordCosts: Record<string, string> };
  test(`${d.name} (${id}): [Equip] ${d.keywordCosts?.Equip} attaches to a unit you control, +${d.might} Might`, () => {
    let g = game();
    const eq = put(g, 0, id, 'base');
    const u = put(g, 0, 't-u2', 'base');
    put(g, 1, 't-u2', 'base');
    assert.ok(!canActivate(g, 0, eq, EQUIP), 'cannot pay yet');
    payFor(g, d.keywordCosts!.Equip!, d.domains);
    g = run(activate(g, 0, eq, EQUIP));      // only one unit you control: auto-targeted
    assert.equal(g.objects[eq].attachedTo, u);
    // Brutalizer's band: +2 more while it was attached this turn (tests/cards/B2/bands.test.ts)
    assert.equal(m(g, u), 2 + (d.might ?? 0) + (id === 'sfd-042-221' ? 2 : 0));
    assert.ok(!canActivate(g, 0, eq, EQUIP), 'attached: Equip (rules text) is inactive');
  });
}

test('Equip targets only units you control', () => {
  let g = game();
  mana(g, 0, 0, 'Order');
  const bf = put(g, 0, 'sfd-161-221', 'base');
  const mine = put(g, 0, 't-u2', 'base'), mine2 = put(g, 0, 't-u1', 'base');
  const theirs = put(g, 1, 't-u3', 'base');
  g = activate(g, 0, bf, EQUIP);
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.deepEqual(opts.sort(), [mine, mine2].sort());
  void theirs;
});

test('Quick-Draw (Long Sword): Reaction timing; when played it attaches to a unit you control (your choice)', () => {
  let g = game();
  mana(g, 0, 2, 'Fury');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u3', 'base');
  const sw = handCard(g, 0, 'sfd-022-221');
  g = play(g, 0, handCard(g, 0, 'ts-pump'));         // open a chain: only Reaction-speed cards can be played now
  g = act(g, { type: 'choose', player: 0, optionIds: [a] });
  assert.equal(g.chain.length, 1);
  assert.ok(canPlay(g, 0, sw), 'Quick-Draw gives Reaction');
  g = play(g, 0, sw);
  g = run(g);
  assert.deepEqual(expectDecision(g, 'chooseCards', 0).sort(), [a, b].sort());
  g = run(g, b);
  assert.equal(g.objects[sw].attachedTo, b);
  assert.equal(m(g, b), 5);
});

test('Temporary (Spinning Axe): killed at the start of your Beginning Phase only while unattached', () => {
  let g = game();
  const loose = put(g, 0, 'sfd-186-221', 'base');
  const worn = put(g, 0, 'sfd-186-221', 'base');
  const u = put(g, 0, 't-u2', 'base');
  attachNow(g, worn, u);
  g = endTurn(endTurn(g));
  assert.equal(zoneOf(g, loose), 'trash');
  assert.equal(zoneOf(g, worn), 'base');
  assert.equal(m(g, u), 5);
});

test('Unique (Forgefire Cape): at most one copy in a deck', () => {
  const d1 = deck({ main: ['sfd-190-221'] });
  const d2 = deck({ main: ['sfd-190-221', 'sfd-190-221'] });
  assert.ok(!validateDeck(d1, db).some(p => p.code === 'unique'));
  assert.ok(validateDeck(d2, db).some(p => p.code === 'unique'));
});

test('Blade of the Exile: [Equip] — [A] or exhaust a friendly unit (payer chooses)', () => {
  let g = game();
  mana(g, 0, 0, 'Mind');
  const bl = put(g, 0, 'rad-150-167', 'base');
  const u = put(g, 0, 't-u2', 'base');
  const helper = put(g, 0, 't-u1', 'base');
  g = activate(g, 0, bl, EQUIP);
  g = run(g, u);
  assert.deepEqual(expectDecision(g, 'chooseMode', 0).sort(), ['A', 'exhaust']);
  g = run(g, 'exhaust', helper);
  assert.equal(g.objects[helper].exhausted, true);
  assert.equal(g.objects[bl].attachedTo, u);
  assert.equal(g.players[0].runesInPlay.length, 1, 'no rune spent');
  assert.equal(m(g, u), 5);
  // [A] option
  let h = game();
  mana(h, 0, 0, 'Mind');
  const bl2 = put(h, 0, 'rad-150-167', 'base');
  const u2 = put(h, 0, 't-u2', 'base', { ready: false });
  h = run(activate(h, 0, bl2, EQUIP));          // the only ready unit... none: only [A] is possible
  assert.equal(h.objects[bl2].attachedTo, u2);
  assert.equal(h.players[0].runesInPlay.length, 0, 'rune recycled for [A]');
});

test('Blade of the Exile: neither [A] nor a ready friendly unit -> cannot Equip', () => {
  const g = game();
  const bl = put(g, 0, 'rad-150-167', 'base');
  put(g, 0, 't-u2', 'base', { ready: false });
  assert.ok(!canActivate(g, 0, bl, EQUIP));
});

test('Blade of the Ruined King: [Equip] — [C], kill a friendly unit', () => {
  let g = game();
  mana(g, 0, 0, 'Order');
  const bl = put(g, 0, 'sfd-178-221', 'base');
  const u = put(g, 0, 't-u2', 'base');
  const victim = put(g, 0, 't-u1', 'base');
  g = run(activate(g, 0, bl, EQUIP), u, victim);
  assert.equal(zoneOf(g, victim), 'trash');
  assert.equal(g.objects[bl].attachedTo, u);
  assert.equal(m(g, u), 6);
});

test('Last Rites: [Equip] — [C], recycle 2 cards from your trash', () => {
  let g = game();
  mana(g, 0, 0, 'Chaos');
  const lr = put(g, 0, 'sfd-150-221', 'base');
  const u = put(g, 0, 't-u2', 'base');
  put(g, 0, 't-u1', 'trash');
  assert.ok(!canActivate(g, 0, lr, EQUIP), 'needs 2 cards in trash');
  put(g, 0, 't-u1', 'trash');
  g = run(activate(g, 0, lr, EQUIP));
  assert.equal(g.players[0].trash.length, 0);
  assert.equal(g.objects[lr].attachedTo, u);
});

test('Hextech Gauntlets: [Equip] [3][A], Energy reduced by the chosen unit\'s Might', () => {
  let g = game();
  mana(g, 0, 0, 'Fury');
  const hg = put(g, 0, 'unl-188-219', 'base');
  const big = put(g, 0, 't-u3', 'base');
  g = run(activate(g, 0, hg, EQUIP));
  assert.equal(g.objects[hg].attachedTo, big, '[3] - 3 Might = [0]: only [A]');
  let h = game();
  mana(h, 0, 2, 'Fury');
  const hg2 = put(h, 0, 'unl-188-219', 'base');
  const small = put(h, 0, 't-u1', 'base');
  h = run(activate(h, 0, hg2, EQUIP));
  assert.equal(h.objects[hg2].attachedTo, small, '[2][A] for a 1-Might unit');
  // rules-decisions #65: a recycled ready rune is exhausted first, its [1] floats: the [A] rune's [1] pays part of the [2], so one rune stays ready
  assert.equal(h.players[0].runesInPlay.length, 2, 'one rune recycled for [A]');
  assert.equal(h.players[0].runesInPlay.filter(r => !h.objects[r].exhausted).length, 1);
  assert.equal(h.players[0].pool.energy, 0);
});

test('Shurelya\'s Requiem: when you play it, ready your units', () => {
  let g = game();
  mana(g, 0, 4, 'Calm', 'Mind');
  const a = put(g, 0, 't-u2', 'base', { ready: false }), b = put(g, 0, 't-u2', 'base', { ready: false });
  const e = put(g, 1, 't-u2', 'base', { ready: false });
  g = run(playNew(g, 0, 'sfd-192-221')[0]);
  assert.deepEqual([a, b, e].map(x => g.objects[x].exhausted), [false, false, true]);
});

test('Edge of Night: played from face down, it attaches to a unit you control there', () => {
  let g = game();
  setController(g, 0, 0);
  const here1 = put(g, 0, 't-u2', 0), here2 = put(g, 0, 't-u1', 0);
  put(g, 0, 't-u3', 'base');
  const eon = hideAt(g, 0, 'sfd-139-221', 0);
  g = play(g, 0, eon);
  g = run(g);
  // RULINGS sweep / CR 403.2: a target chosen as the trigger goes on the chain
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0).sort(), [here1, here2].sort(), 'only units here');
  g = run(g, here1);
  assert.equal(g.objects[eon].attachedTo, here1);
  assert.equal(g.objects[eon].battlefieldIndex, 0);
  assert.equal(m(g, here1), 4);
});

test('Edge of Night: played from hand it does not attach (stays unattached at base)', () => {
  let g = game();
  mana(g, 0, 3);
  put(g, 0, 't-u2', 'base');
  let eon: ObjId;
  [g, eon] = playNew(g, 0, 'sfd-139-221');
  g = run(g);
  assert.equal(g.objects[eon].attachedTo, undefined);
  atMain(g);
});

test('Svellsongur: the equipped unit has its own text twice (Deathknell triggers twice, Assault doubles)', () => {
  let g = game();
  setController(g, 0, 0);
  const dk = put(g, 0, 'ts-dk', 0);
  const sv = put(g, 0, 'sfd-059-221', 0);
  attachNow(g, sv, dk);
  mana(g, 0, 1);
  const hand = handSize(g, 0);
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')));
  assert.equal(zoneOf(g, dk), 'trash');
  assert.equal(handSize(g, 0), hand + 2, 'Deathknell: draw 1 twice');
  const as = put(g, 0, 't-assault', 'base');
  const sv2 = put(g, 0, 'sfd-059-221', 'base');
  attachNow(g, sv2, as);
  assert.equal(kwVal(g, as, 'Assault'), 4);
});

test('Shady Spectacles: as it is attached, the unit becomes a copy of another friendly unit (until detached)', () => {
  let g = game();
  mana(g, 0, 1, 'Order');
  const u = put(g, 0, 't-u1', 'base');
  const model = put(g, 0, 'ts-drawer', 'base');
  const other = put(g, 0, 't-tank', 'base');
  const ss = put(g, 0, 'ven-137-166', 'base');
  g = activate(g, 0, ss, EQUIP);
  g = run(g, u);
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.deepEqual(opts.sort(), [model, other].sort(), 'another friendly unit');
  g = run(g, other);
  assert.equal(chars(g, u).name, chars(g, other).name);
  assert.ok(hasKw(g, u, 'Tank'));
  // detach with Grandmaster at Arms' second ability -> moving it elsewhere ends the copy
  g.objects[g.players[0].legend].cardId = 'sfd-193-221';
  g = run(act(g, { type: 'activate', player: 0, obj: g.players[0].legend, abilityIndex: 1 }), model);
  assert.equal(g.objects[ss].attachedTo, model);
  assert.ok(!hasKw(g, u, 'Tank'), 'the old host is itself again');
  assert.equal(chars(g, u).name, 't-u1');
});

test('Gearhead: each attached Equipment gives double its base Might bonus', () => {
  const g = game();
  const gh = put(g, 0, 'sfd-068-221', 'base');
  const sw = put(g, 0, 'sfd-161-221', 'base');   // B.F. Sword +3
  attachNow(g, sw, gh);
  assert.equal(m(g, gh), 3 + 6);
});

test('Ornn: +1 Might for each friendly gear; Weaponmaster may equip (an Equip cost without [A] is paid in full, R-10)', () => {
  let g = game();
  mana(g, 0, 6, 'Order');                        // [6] for Ornn, an Order rune for B.F. Sword's [C]
  put(g, 0, 'ogn-098-298', 'base');
  const sw = put(g, 0, 'sfd-161-221', 'base');   // Equip [C]: no [A] to remove -> paid in full (CR 821.1.c.3)
  put(g, 1, 'ogn-098-298', 'base');
  let o: ObjId;
  [g, o] = playNew(g, 0, 'sfd-085-221');
  g = run(g);
  expectDecision(g, 'chooseTargets', 0);
  g = run(g, sw);
  assert.equal(g.objects[sw].attachedTo, o);
  assert.equal(m(g, o), 4 + 2 + 3, 'base 4, two friendly gear, B.F. Sword');
  assert.equal(kwVal(g, o, 'Deflect'), 2);
});

test('Ornn counts a Gear Unit (Patched Porobot, Unit + additionalTypes Gear) as a friendly gear', () => {
  let g = game();
  mana(g, 0, 6, 'Mind');
  put(g, 0, 'ven-058-166', 'base');
  let o: ObjId;
  [g, o] = playNew(g, 0, 'sfd-085-221');
  g = run(g);
  assert.equal(m(g, o), 4 + 1, 'base 4 + the Porobot');
});

test('Weaponmaster: may decline (no Equipment attached)', () => {
  let g = game();
  mana(g, 0, 3, 'Body');
  const sw = put(g, 0, 'sfd-161-221', 'base');
  let l: ObjId;
  [g, l] = playNew(g, 0, 'sfd-113-221');
  g = run(g, []);
  assert.equal(g.objects[sw].attachedTo, undefined);
  void l;
});

test('Jax: Weaponmaster attach triggers "when you attach an Equipment to me, you may pay [1] to draw 1"', () => {
  let g = game();
  mana(g, 0, 5, 'Body', 'Body');
  const sw = put(g, 0, 'sfd-095-221', 'base');   // Doran's Blade, Equip [C]
  let jax: ObjId;
  [g, jax] = playNew(g, 0, 'sfd-119-221');
  g = run(g, sw);
  assert.equal(g.objects[sw].attachedTo, jax);
  const hand = handSize(g, 0);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(handSize(g, 0), hand + 1);
});

test('Rell: when I attack, may play an Equipment costing [2] or less from hand for free and attach it to me', () => {
  let g = game();
  setController(g, 1, 1);
  put(g, 1, 't-u1', 1);
  const rell = put(g, 0, 'sfd-024-221', 'base');
  const cheap = handCard(g, 0, 'sfd-095-221');   // Doran's Blade [2], +2
  handCard(g, 0, 'sfd-161-221');                 // B.F. Sword [4]: too expensive
  g = act(g, { type: 'move', player: 0, units: [rell], to: 1 });
  g = run(g);
  assert.deepEqual(expectDecision(g, 'chooseCards', 0), [cheap]);
  g = run(g, cheap);
  assert.equal(g.objects[cheap].attachedTo, rell);
  assert.equal(g.players[0].runesInPlay.length, 0);
});

test('Aphelios: each Equipment attached to him gives a mode not yet chosen this turn', () => {
  let g = game();
  mana(g, 0, 0, 'Calm', 'Calm');
  const ap = put(g, 0, 'sfd-049-221', 'base');
  const a = put(g, 0, 'sfd-033-221', 'base'), b = put(g, 0, 'sfd-051-221', 'base');
  const runesBefore = g.players[0].runesInPlay.length;
  g = run(activate(g, 0, a, EQUIP));
  assert.deepEqual(expectDecision(g, 'chooseMode', 0).sort(), ['buff', 'channel', 'ready']);
  g = run(g, 'channel');
  assert.equal(g.players[0].runesInPlay.length, runesBefore - 1 + 1, 'one Calm rune recycled for [C], one rune channelled');
  assert.ok(g.players[0].runesInPlay.some(r => g.objects[r].exhausted), 'channelled exhausted');
  g = run(activate(g, 0, b, EQUIP));
  assert.deepEqual(expectDecision(g, 'chooseMode', 0).sort(), ['buff', 'ready'], 'channel already chosen this turn');
  // R-1: the mode and its runes (targets) are chosen as the trigger goes on the chain
  g = act(g, { type: 'choose', player: 0, optionIds: ['ready'] });
  const ex = g.players[0].runesInPlay.filter(r => g.objects[r].exhausted);
  assert.ok(ex.length >= 1 && ex.length <= 2);
  expectDecision(g, 'chooseTargets', 0);
  g = run(g, ex);
  assert.ok(g.players[0].runesInPlay.every(r => !g.objects[r].exhausted), 'two runes readied');
});

test('Akshan: pay [C][C] extra -> take an enemy gear (attach if Equipment) until he leaves the board', () => {
  let g = game();
  mana(g, 0, 4, 'Body', 'Body');
  const enemyHost = put(g, 1, 't-u2', 'base');
  const sw = put(g, 1, 'sfd-161-221', 'base');
  attachNow(g, sw, enemyHost);
  let ak: ObjId;
  [g, ak] = playNew(g, 0, 'sfd-109-221');
  expectDecision(g, 'optional', 0);           // optional additional cost
  g = run(g, 'yes');
  // play triggers: Akshan's + Weaponmaster; Akshan's put on the chain first (resolves last)
  expectDecision(g, 'orderTriggers', 0);
  g = run(g, '0');
  assert.equal(g.objects[sw].controller, 0);
  assert.equal(g.objects[sw].attachedTo, ak);
  assert.equal(m(g, ak), 7);
  // he leaves the board -> control returns
  const pack = put(g, 0, 'ogn-181-298', 'base');
  g = run(act(g, { type: 'activate', player: 0, obj: pack, abilityIndex: 0 }), ak);
  assert.equal(zoneOf(g, ak), 'hand');
  assert.equal(g.objects[sw].controller, 1);
});

test('Akshan: without the additional cost nothing is taken', () => {
  let g = game();
  mana(g, 0, 6, 'Body', 'Body');
  const sw = put(g, 1, 'sfd-161-221', 'base');
  g = run(playNew(g, 0, 'sfd-109-221')[0], 'no');
  assert.equal(g.objects[sw].controller, 1);
});

test('Lucian: the first time he conquers each turn, ready him', () => {
  let g = game();
  const l = put(g, 0, 'sfd-113-221', 'base');
  g = run(act(g, { type: 'move', player: 0, units: [l], to: 0 }));
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(g.objects[l].exhausted, false);
  g = run(act(g, { type: 'move', player: 0, units: [l], to: 'base' }));
  g.objects[l].exhausted = false;
  g = run(act(g, { type: 'move', player: 0, units: [l], to: 1 }));
  assert.equal(g.battlefields[1].controller, 0);
  assert.equal(g.objects[l].exhausted, true, 'only the first conquest each turn');
});

test('Yone: conquering an uncontrolled battlefield deals his Might to an enemy unit in a base', () => {
  let g = game();
  const y = put(g, 0, 'sfd-116-221', 'base');
  const e = put(g, 1, 't-u5', 'base');
  put(g, 1, 't-u1', 'base');
  g = run(act(g, { type: 'move', player: 0, units: [y], to: 0 }), e);
  assert.equal(zoneOf(g, e), 'trash');
});

test('Yone: conquering a battlefield the opponent controlled does not trigger', () => {
  let g = game();
  setController(g, 0, 1);
  put(g, 1, 't-u1', 0);
  const y = put(g, 0, 'sfd-116-221', 'base');
  const e = put(g, 1, 't-u5', 'base');
  g = run(act(g, { type: 'move', player: 0, units: [y], to: 0 }));
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(g.objects[e].damage, 0);
});

test('Riven: when she attacks, deal 2 to an enemy unit here for each Equipment attached to her', () => {
  let g = game();
  setController(g, 1, 1);
  const e = put(g, 1, 't-u5', 1);
  put(g, 1, 't-u1', 1);
  const r = put(g, 0, 'ven-041-166', 'base');
  attachNow(g, put(g, 0, 'sfd-033-221', 'base'), r);
  attachNow(g, put(g, 0, 'sfd-051-221', 'base'), r);
  g = act(g, { type: 'move', player: 0, units: [r], to: 1 });
  g = run(g, e);
  assert.ok(g.objects[e].damage >= 4 || zoneOf(g, e) === 'trash');
  assert.equal(zoneOf(g, e), 'trash', '4 from the trigger + combat damage');
});
