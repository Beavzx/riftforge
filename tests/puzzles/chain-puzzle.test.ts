// User-supplied chain puzzle ("Grey Docks / Shimmer Vats"): newest-first resolution, deaths only in
// cleanup after the resolving item, Deathknell targets chosen when the trigger goes on the chain
// (no friendly unit left => Poro Pal's trigger is removed), partial-target resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S0, P0, P1, control, act } from '../conformance/harness.ts';
import { place } from '../../src/engine/testkit.ts';
import { getView } from '../../src/engine/index.ts';
import type { GameState } from '../../src/engine/types.ts';
import { PZ } from './chain-puzzle.fixtures.ts';

function setup() {
  const g = S0();
  g.cards = { ...g.cards, ...PZ };
  const id: Record<string, string> = {};
  for (const k of ['scrapper', 'poro', 'sumprat']) id[k] = place(g, P0, `pz-${k}`, 0);
  for (const k of ['sentinel', 'acolyte', 'hound']) id[k] = place(g, P1, `pz-${k}`, 1);
  for (const k of ['arc', 'sap']) id[k] = place(g, P0, `pz-${k}`, 'hand');
  for (const k of ['hymn', 'rites']) id[k] = place(g, P1, `pz-${k}`, 'hand');
  control(g, 0, P0); control(g, 1, P1);
  return { g, id };
}

test('chain puzzle: Sump Rat on Acolyte leaves only Rust Hound (5 Might, 2 damage)', () => {
  let { g, id } = setup();
  const choose = (ids: string[]) => { const d = g.pending!; g = act(g, { type: 'choose', player: d.player, optionIds: ids }); };
  const pass = () => { const d = g.pending!; assert.equal(d.kind, 'chainResponse'); g = act(g, { type: 'pass', player: d.player }); };
  const zone = (k: string) => g.objects[id[k]]?.zone;

  g = act(g, { type: 'playCard', player: P0, obj: id.arc });
  assert.equal(g.pending!.kind, 'chooseTargets', 'Arc Surge targets are chosen as it is played');
  choose([id.sentinel, id.acolyte, id.hound]); pass();
  g = act(g, { type: 'playCard', player: P1, obj: id.hymn }); choose([id.acolyte, id.hound]); pass();
  g = act(g, { type: 'playCard', player: P0, obj: id.sap }); choose([id.acolyte]); pass();
  g = act(g, { type: 'playCard', player: P1, obj: id.rites }); choose([id.sentinel]); choose([id.scrapper]);
  assert.deepEqual(g.chain.map(c => g.cards[g.objects[c.source]?.cardId ?? '']?.name ?? c.label), ['Arc Surge', 'Bulwark Hymn', 'Sap', 'Last Rites']);
  pass(); pass(); // both pass -> Last Rites resolves

  // Sentinel died during resolution; Scrapper (4 dmg) is still on the board until the cleanup.
  assert.equal(zone('sentinel'), 'trash');
  assert.equal(g.objects[id.scrapper].damage, 4);
  assert.equal(g.pending!.kind, 'orderTriggers');
  assert.equal(g.pending!.player, P1);
  const acoOpt = g.pending!.options!.find(o => /Acolyte/.test(o.label))!;
  choose([acoOpt.id]);                       // Acolyte trigger first (bottom)
  if (g.pending!.kind === 'orderTriggers') choose([g.pending!.options![0].id]);
  assert.equal(g.pending!.kind, 'chooseTargets');
  choose([id.acolyte]);                      // Acolyte targets itself
  assert.equal(zone('scrapper'), 'trash', 'Scrapper dies in the cleanup after Last Rites');
  pass(); pass();                            // Sentinel Deathknell resolves

  assert.equal(zone('poro'), 'trash'); assert.equal(zone('sumprat'), 'trash');
  assert.equal(g.pending!.kind, 'orderTriggers'); assert.equal(g.pending!.player, P0);
  choose([g.pending!.options!.find(o => /Poro/.test(o.label))!.id]);
  if (g.pending!.kind === 'orderTriggers') choose([g.pending!.options![0].id]);
  assert.ok(g.log.some(l => /Poro Pal.*no legal targets/.test(l.text)), 'Poro Pal has no friendly unit to choose');
  assert.equal(g.pending!.kind, 'chooseTargets');
  assert.deepEqual(g.pending!.options!.map(o => o.id).sort(), [id.acolyte, id.hound].sort(), 'Sump Rat may pick only living enemy units');
  choose([id.acolyte]);
  for (let i = 0; i < 20 && g.pending!.kind === 'chainResponse'; i++) pass();

  assert.equal(g.chain.length, 0);
  for (const k of ['scrapper', 'poro', 'sumprat', 'sentinel', 'acolyte']) assert.equal(zone(k), 'trash', `${k} died`);
  assert.equal(zone('hound'), 'battlefield');
  assert.equal(g.objects[id.hound].damage, 2);
  assert.equal(getView(g as GameState, P0).state.objects[id.hound].derived?.might, 5);
});

test('chain puzzle: Sump Rat on Hound instead lets Acolyte survive (3 Might, 2 dmg) and Hound survive (5 Might, 4 dmg)', () => {
  let { g, id } = setup();
  const choose = (ids: string[]) => { const d = g.pending!; g = act(g, { type: 'choose', player: d.player, optionIds: ids }); };
  const pass = () => { const d = g.pending!; g = act(g, { type: 'pass', player: d.player }); };
  g = act(g, { type: 'playCard', player: P0, obj: id.arc }); choose([id.sentinel, id.acolyte, id.hound]); pass();
  g = act(g, { type: 'playCard', player: P1, obj: id.hymn }); choose([id.acolyte, id.hound]); pass();
  g = act(g, { type: 'playCard', player: P0, obj: id.sap }); choose([id.acolyte]); pass();
  g = act(g, { type: 'playCard', player: P1, obj: id.rites }); choose([id.sentinel]); choose([id.scrapper]); pass(); pass();
  choose([g.pending!.options!.find(o => /Acolyte/.test(o.label))!.id]);
  if (g.pending!.kind === 'orderTriggers') choose([g.pending!.options![0].id]);
  choose([id.acolyte]); pass(); pass();
  choose([g.pending!.options!.find(o => /Poro/.test(o.label))!.id]);
  if (g.pending!.kind === 'orderTriggers') choose([g.pending!.options![0].id]);
  choose([id.hound]);
  for (let i = 0; i < 20 && g.pending!.kind === 'chainResponse'; i++) pass();
  // Acolyte: +1 (own trigger) -2 (Sap) +2 (Hymn) = 3 Might, 2 damage from Arc Surge -> survives.
  assert.equal(g.objects[id.acolyte].zone, 'battlefield');
  assert.equal(getView(g, P0).state.objects[id.acolyte].derived?.might, 3);
  assert.equal(g.objects[id.acolyte].damage, 2);
  // Hound: 3 +2 (Hymn) = 5 Might, 2 (Sump Rat) + 2 (Arc) = 4 damage -> survives.
  assert.equal(g.objects[id.hound].zone, 'battlefield');
  assert.equal(g.objects[id.hound].damage, 4);
});
