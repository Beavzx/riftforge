// META-AUDIT (second pass, KAISA-AUDIT): rules checks for the Bologna meta lists, Kai'Sa, Daughter of the Void first
// (data/meta-decks/06/07/18/23-kai-sa.json): what the legend's spell-only [A] can pay (spells yes; units, Accelerate, hiding no),
// targeting restrictions ("at a battlefield"), cost reductions (Legion, Sky Splitter), Watcher's -3, Void Gate / Rockfall Path /
// Frozen Fortress, Time Warp's cost; then Defy (the field's most played counter) against the Kai'Sa spells (printed cost, CR 206).
// The per-card text-vs-script audit of all 159 distinct meta cards is in docs/meta-audit.md.
import { test } from 'node:test';
import {
  game, mana, run, play, canPlay, put, handCard, zoneOf, setController, assert, M, setLegend, setBattlefield, act, choose, getLegalActions, endTurn, RUNE,
} from './B3/util.ts';
import { runes, moveToZone } from '../fixtures/helpers.ts';
import { playCostOf } from '../../src/engine/testkit.ts';
import type { GameState, ObjId, PlayerId } from '../../src/engine/types.ts';

const ID = {
  legend: 'ogn-247-298', ray: 'ogn-009-298', watcher: 'ogn-116-298', breach: 'ven-066-166', splitter: 'ogn-014-298',
  hopeful: 'ogn-012-298', poro: 'sfd-069-221', star: 'ogn-029-298', smoke: 'ogn-093-298', stupefy: 'ogn-095-298',
  voidGate: 'ogn-296-298', rockfall: 'sfd-216-221', fortress: 'unl-212-219', timeWarp: 'ogn-122-298', yordle: 'ogn-087-298',
} as const;

const legendOf = (g: GameState, p: PlayerId) => g.players[p].legend;
const targetOpts = (g: GameState) => (g.pending?.options ?? []).map(o => o.id);

/** no runes in play at all (exhausted runes could still be recycled for power) */
function clearRunes(g: GameState, p: PlayerId): void {
  for (const r of [...g.players[p].runesInPlay]) moveToZone(g, r, 'runeDeck');
  g.players[p].runesInPlay = [];
}

function kaisaGame(): GameState {
  const g = game();
  setLegend(g, 0, ID.legend);
  clearRunes(g, 0);
  clearRunes(g, 1);
  return g;
}

test('legend [A] pays a spell\'s power (Hextech Ray for 1 energy, no recycle) and exhausts', () => {
  let g = kaisaGame();
  runes(g, 0, 1, RUNE.Mind);                 // 1 energy, no Fury rune: the [Fury] power must come from the legend
  const r = g.players[0].runesInPlay.length;
  const enemy = put(g, 1, 't-u3', 0);
  const ray = handCard(g, 0, ID.ray);
  assert.ok(canPlay(g, 0, ray), 'Ray payable with 1 rune + legend');
  g = play(g, 0, ray);
  g = run(g, enemy);
  assert.equal(g.objects[legendOf(g, 0)].exhausted, true);
  assert.equal(g.players[0].runesInPlay.length, r, 'no rune recycled');
  assert.equal(zoneOf(g, enemy), 'trash');
  // once per turn: a second Ray needs a real Fury rune now
  const ray2 = handCard(g, 0, ID.ray);
  runes(g, 0, 1, RUNE.Mind);
  assert.equal(canPlay(g, 0, ray2), false, 'legend already exhausted, no Fury rune');
});

test('legend [A] cannot pay units (Noxus Hopeful), Accelerate, or the hide cost of Temporal Breach', () => {
  let g = kaisaGame();
  // Thousand-Tailed Watcher: 7 + [Mind]; Accelerate [1][C]. 9 runes, only one Mind: Accelerate's second Mind power can't come from the legend.
  runes(g, 0, 8, RUNE.Fury); runes(g, 0, 1, RUNE.Mind);
  const w = handCard(g, 0, ID.watcher);
  assert.ok(canPlay(g, 0, w));
  g = play(g, 0, w, { destination: 'base' } as never);
  for (let i = 0; i < 6 && g.pending?.inStep; i++) {
    assert.ok(!/Accelerate/i.test(g.pending!.prompt ?? ''), `Accelerate must not be offered: ${g.pending!.prompt}`);
    g = run(g, targetOpts(g)[0]);
  }
  g = run(g);
  assert.equal(zoneOf(g, w), 'base');
  assert.equal(g.objects[w].exhausted, true, 'entered exhausted (no Accelerate)');
  assert.equal(g.objects[legendOf(g, 0)].exhausted, false, 'legend unused');

  // Hide: [A] — not "playing a spell"
  const g2 = kaisaGame();
  setController(g2, 0, 0);
  put(g2, 0, 't-u1', 0);
  const b = handCard(g2, 0, ID.breach);
  const hides = getLegalActions(g2, 0).filter(a => a.type === 'hide' && a.obj === b);
  assert.equal(hides.length, 0, 'hiding is not payable with the spell-only legend power and no runes');
  runes(g2, 0, 1, RUNE.Mind);
  assert.ok(getLegalActions(g2, 0).some(a => a.type === 'hide' && a.obj === b), 'payable with a Mind rune');

  // a unit is not payable with the legend
  const g3 = kaisaGame();
  runes(g3, 0, 2, RUNE.Fury);
  const h = handCard(g3, 0, ID.hopeful);
  assert.equal(canPlay(g3, 0, h), false, 'Hopeful costs 4 without Legion');
});

test('Hextech Ray / Sky Splitter: "a unit at a battlefield" — base units are not legal targets', () => {
  let g = kaisaGame();
  runes(g, 0, 2, RUNE.Fury);
  const atBf = put(g, 1, 't-u3', 0), atBase = put(g, 1, 't-u3', 'base');
  g = run(play(g, 0, handCard(g, 0, ID.ray)), atBf);    // the only legal target is chosen automatically
  assert.equal(zoneOf(g, atBf), 'trash');
  assert.equal(g.objects[atBase].damage, 0, 'base unit not targetable');
  const r2 = handCard(g, 0, ID.ray);
  assert.equal(canPlay(g, 0, r2), false, 'no legal target left (only a base unit)');
});

test('Sky Splitter costs 8 minus the highest Might among my units; Noxus Hopeful costs 2 after another card (Legion)', () => {
  let g = kaisaGame();
  const s = handCard(g, 0, ID.splitter);
  runes(g, 0, 8, RUNE.Fury);
  assert.equal(playCostOf(g, 0, s)!.energy, 8);
  put(g, 0, 't-u3', 'base');
  assert.equal(playCostOf(g, 0, s)!.energy, 5);
  put(g, 1, 't-u5', 'base');                          // an enemy unit's Might doesn't count
  assert.equal(playCostOf(g, 0, s)!.energy, 5);

  const h = handCard(g, 0, ID.hopeful);
  assert.equal(playCostOf(g, 0, h)!.energy, 4);
  const st = handCard(g, 0, ID.stupefy);
  g = play(g, 0, st);
  g = run(g, targetOpts(g)[0]);
  assert.equal(playCostOf(g, 0, h)!.energy, 2, 'Legion after Stupefy');
});

test('Thousand-Tailed Watcher: -3 (min 1) to every enemy unit, base included; not to my units; lasts only this turn', () => {
  let g = kaisaGame();
  runes(g, 0, 7, RUNE.Fury); runes(g, 0, 1, RUNE.Mind);
  const e5 = put(g, 1, 't-u5', 0), e2 = put(g, 1, 't-u2', 'base'), mine = put(g, 0, 't-u3', 1);
  g = play(g, 0, handCard(g, 0, ID.watcher), { destination: 'base' } as never);
  g = run(g);
  assert.equal(M(g, e5), 2);
  assert.equal(M(g, e2), 1);
  assert.equal(M(g, mine), 3);
  g = endTurn(g);
  assert.equal(M(g, e5), 5, 'back to 5 on the next turn');
});

test('Void Gate: each Falling Star instance deals 4 to a unit there (3 elsewhere); Smoke Screen -4 to a minimum of 1', () => {
  let g = kaisaGame();
  setBattlefield(g, 0, ID.voidGate);
  runes(g, 0, 2, RUNE.Fury); runes(g, 0, 1, RUNE.Fury);
  const a = put(g, 1, 't-u5', 0), b = put(g, 1, 't-u5', 1);
  g = play(g, 0, handCard(g, 0, ID.star));
  g = run(g, a, b);
  assert.equal(g.objects[a].damage, 4);
  assert.equal(g.objects[b].damage, 3);

  let g2 = kaisaGame();
  runes(g2, 0, 2, RUNE.Mind);
  const c = put(g2, 1, 't-u3', 0);
  g2 = play(g2, 0, handCard(g2, 0, ID.smoke));
  g2 = run(g2, c);
  assert.equal(M(g2, c), 1);
});

test('Rockfall Path: units can\'t be played there; Frozen Fortress deals 1 to each unit there at the start of each Beginning Phase', () => {
  const g = kaisaGame();
  setBattlefield(g, 0, ID.rockfall);
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  runes(g, 0, 2, RUNE.Mind);
  const poro = handCard(g, 0, ID.poro);
  const dests = getLegalActions(g, 0).filter(a => a.type === 'playCard' && a.obj === poro).map(a => (a as { destination?: unknown }).destination);
  assert.ok(!dests.includes(0), `no play to Rockfall Path (destinations ${JSON.stringify(dests)})`);

  let g2 = kaisaGame();
  setBattlefield(g2, 1, ID.fortress);
  const mine = put(g2, 0, 't-u3', 1);
  g2 = endTurn(g2);                                      // opponent's Beginning Phase: 1 to my unit there
  assert.equal(g2.objects[mine].damage, 1);
});

test('Time Warp: 10 energy + 4 Mind power; the legend pays one of the four', () => {
  const g = kaisaGame();
  runes(g, 0, 7, RUNE.Fury); runes(g, 0, 3, RUNE.Mind);
  const tw = handCard(g, 0, ID.timeWarp);
  const c = playCostOf(g, 0, tw)!;
  assert.equal(c.energy, 10);
  assert.equal(c.power.length, 4);
  assert.ok(canPlay(g, 0, tw), '10 runes (3 Mind) + legend');
  const g2 = kaisaGame();
  runes(g2, 0, 8, RUNE.Fury); runes(g2, 0, 2, RUNE.Mind);
  assert.equal(canPlay(g2, 0, handCard(g2, 0, ID.timeWarp)), false, 'only 2 Mind runes + legend = 3 Mind power');
});

test('Defy ("no more than [4] and no more than [A]", printed cost): counters Hextech Ray, not Falling Star ([A][A]) or Sky Splitter (printed [8])', () => {
  const defy = 'ogn-045-298';
  for (const [spell, counterable] of [[ID.ray, true], [ID.star, false], [ID.splitter, false]] as const) {
    let g = kaisaGame();
    runes(g, 0, 3, RUNE.Fury);
    put(g, 0, 't-u5', 1);                                  // Sky Splitter costs 8 - 5 = 3
    const target = put(g, 1, 't-u3', 0);
    runes(g, 1, 2, 'rad-r02');                             // Calm for Defy
    const d = handCard(g, 1, defy);
    g = play(g, 0, handCard(g, 0, spell));
    for (let i = 0; i < 4 && g.pending?.inStep; i++) g = choose(g, g.pending!.options!.some(o => o.id === target) ? target : g.pending!.options![0].id);
    for (let i = 0; i < 3 && g.pending?.kind === 'chainResponse' && g.pending.player !== 1; i++) g = act(g, { type: 'pass', player: g.pending.player });
    assert.equal(g.pending?.kind, 'chainResponse');
    assert.equal(g.pending?.player, 1);
    assert.equal(g.chain.length, 1, 'the Kai\'Sa spell is on the chain');
    const canDefy = getLegalActions(g, 1).some(a => a.type === 'playCard' && a.obj === d);
    assert.equal(canDefy, counterable, `Defy vs ${g.cards[ID[spell === ID.ray ? 'ray' : spell === ID.star ? 'star' : 'splitter']].name}`);
  }
});
