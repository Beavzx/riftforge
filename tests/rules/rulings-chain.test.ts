// RULINGS agent, Round 3: chain / trigger timing (see docs/rulings.md "Round 3").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S0, P0, P1, control, act } from '../conformance/harness.ts';
import { place } from '../../src/engine/testkit.ts';
import { card, spell, T, F, E, whenUnitDies } from '../../src/cards/dsl.ts';
import type { CardDef, GameState } from '../../src/engine/types.ts';
import { PZ } from '../puzzles/chain-puzzle.fixtures.ts';

const base = { supertypes: [], tags: [], domains: ['Fury'], power: 0, rarity: 'Common', set: 'rz' } as const;
const RZ: Record<string, CardDef> = {
  'rz-cull': { ...base, id: 'rz-cull', name: 'Culling Rite', type: 'Spell', energy: 1, might: null, keywords: ['Reaction'], domains: ['Fury'], supertypes: [], tags: [],
    text: '[Reaction]\nKill a friendly unit. Deal 3 to another friendly unit and 3 to an enemy unit.' },
  'rz-kill': { ...base, id: 'rz-kill', name: 'Snuff', type: 'Spell', energy: 1, might: null, keywords: ['Action'], domains: ['Fury'], supertypes: [], tags: [], text: '[Action]\nKill a unit.' },
  'rz-watcher': { ...base, id: 'rz-watcher', name: 'Grave Watcher', type: 'Unit', energy: 2, might: 2, keywords: [], domains: ['Fury'], supertypes: [], tags: [], text: 'When an enemy unit dies, draw 1.' },
};
card('rz-cull', RZ['rz-cull'].text, [spell(ctx => {
  const [a, b, e] = [ctx.target(0), ctx.target(1), ctx.target(2)];
  if (a) ctx.kill([a]);
  if (b) ctx.deal(3, [b]);
  if (e) ctx.deal(3, [e]);
}, { targets: [T.unit(F.friendly, { hint: 'harm' }), T.unit(F.friendly, { hint: 'harm' }), T.unit(F.enemy, { hint: 'harm' })] })]);
card('rz-kill', RZ['rz-kill'].text, [spell(E.kill(0), { targets: [T.unit({ hint: 'harm' })] })]);
card('rz-watcher', RZ['rz-watcher'].text, [whenUnitDies(F.enemy, E.draw(1))]);

function board() {
  const g = S0();
  g.cards = { ...g.cards, ...PZ, ...RZ };
  control(g, 0, P0); control(g, 1, P1);
  return g;
}
const name = (g: GameState, src: string) => g.cards[g.objects[src]?.cardId ?? '']?.name ?? '';

// CR 334.1-334.2: "Chain Items may be added to the Chain. They will remain there until the Tasks are complete." / "When all
// Outstanding Tasks are completed, all pending Chain Items will subsequently be processed by the FEPR process." CR 319: a cleanup
// follows a chain item leaving the chain. CR 337.1.b: "Chain Items are Finalized in the order they were appended to the Chain."
// CR 383.3.d: only SIMULTANEOUS triggers are ordered together.
// => A (killed during the resolution) triggers first; B and E (lethal damage) die in the cleanup right after; B's Deathknell is
//    appended after A's. A's targets are chosen only after that cleanup, so E (dead) is not an option; B's goes on top.
test('RULING R-16: resolution-time triggers are finalized after the cleanup; cleanup-time triggers go on top', () => {
  let g = board();
  const a = place(g, P1, 'pz-sumprat', 1), b = place(g, P1, 'pz-sumprat', 1);
  const e = place(g, P0, 'pz-scrapper', 0), h = place(g, P0, 'pz-hound', 0);
  const cull = place(g, P1, 'rz-cull', 'hand');
  const choose = (ids: string[]) => { const d = g.pending!; g = act(g, { type: 'choose', player: d.player, optionIds: ids }); };
  const pass = () => { const d = g.pending!; g = act(g, { type: 'pass', player: d.player }); };
  // P0 opens a chain (Snuff on an unrelated unit) so P1 can respond with the Reaction
  const kill = place(g, P0, 'rz-kill', 'hand');
  const x = place(g, P0, 'pz-scrapper', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: kill }); choose([x]); pass();
  g = act(g, { type: 'playCard', player: P1, obj: cull }); choose([a]); choose([b]); choose([e]); pass(); pass();
  // Culling Rite resolved: A died during it; B and E have lethal damage
  for (let i = 0; i < 5 && g.pending?.kind === 'orderTriggers'; i++) choose([g.pending.options![0].id]);
  assert.equal(g.pending!.kind, 'chooseTargets', "A's Deathknell target");
  assert.equal(g.objects[b].zone, 'trash', 'cleanup ran before finalizing');
  assert.equal(g.objects[e].zone, 'trash');
  assert.ok(!g.pending!.options!.some(o => o.id === e), 'E died in the cleanup and is no longer a legal target');
  choose([h]);
  if (g.pending?.kind === 'chooseTargets') choose([h]);
  const top = g.chain[g.chain.length - 1];
  assert.equal(top.source, b, "B's (cleanup-time) Deathknell is on top and resolves first");
});

// CR 383.3.d.1: "starting with the Turn Player, each player orders their own abilities on the Chain in turn order" — the turn
// player's go on the chain first and resolve last.
test('RULING CR 383.3.d.1: simultaneous triggers of both players — turn player first (bottom)', () => {
  let g = board();
  place(g, P0, 'rz-watcher', 0);
  const victim = place(g, P1, 'pz-scrapper', 1);
  place(g, P1, 'pz-acolyte', 1);
  const kill = place(g, P0, 'rz-kill', 'hand');
  const choose = (ids: string[]) => { const d = g.pending!; g = act(g, { type: 'choose', player: d.player, optionIds: ids }); };
  g = act(g, { type: 'playCard', player: P0, obj: kill }); choose([victim]);
  for (let i = 0; i < 4 && g.pending!.kind === 'chainResponse' && g.chain.length && name(g, g.chain[g.chain.length - 1].source) === 'Snuff'; i++) g = act(g, { type: 'pass', player: g.pending!.player });
  for (let i = 0; i < 4 && g.pending?.kind === 'chooseTargets'; i++) choose([g.pending.options![0].id]);
  assert.equal(g.objects[victim].zone, 'trash');
  const ctrls = g.chain.map(c => c.controller);
  assert.deepEqual(ctrls, [P0, P1], 'P0 (turn player) trigger at the bottom, P1 on top');
});

// CR 403.4: a trigger with no legal option to choose is removed from the chain (not countered). It is still ordered with its
// simultaneous siblings first (ordering happens as triggers are placed; the target check is part of finalization) — harmless.
test('RULING CR 403.4: a trigger with no legal target is removed when finalized', () => {
  let g = board();
  const poro = place(g, P0, 'pz-poro', 0);     // Deathknell: choose a friendly unit
  const kill = place(g, P0, 'rz-kill', 'hand');
  const choose = (ids: string[]) => { const d = g.pending!; g = act(g, { type: 'choose', player: d.player, optionIds: ids }); };
  g = act(g, { type: 'playCard', player: P0, obj: kill });
  if (g.pending?.kind === 'chooseTargets') choose([poro]);
  for (let i = 0; i < 6 && g.pending?.kind === 'chainResponse' && g.chain.length; i++) g = act(g, { type: 'pass', player: g.pending!.player });
  assert.equal(g.objects[poro].zone, 'trash');
  assert.equal(g.chain.length, 0, 'no friendly unit left: the Deathknell was removed');
  assert.ok(g.log.some(l => /no legal targets/.test(l.text)));
});
