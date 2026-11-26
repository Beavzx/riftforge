// ENGINE-10 regression: an effect that moves a permanent off the board by a plain zone move (ctx.toDeck / toHand / toZone) ends
// its attachments (CR 434.4, 435.4.b; rules-decisions #23). Fuzz signature d09ae46bc6 recurred with Keeper's Verdict on an equipped unit.
import { test } from 'node:test';
import { assert, S0, put, hand, act, P0, P1, BF_A, fundAll, zone, locOf } from '../conformance/harness.ts';
import { drive } from '../riftjudge/r11701.helpers.ts';
import { attachNow } from '../../src/engine/testkit.ts';

test('Keeper\'s Verdict on an equipped enemy unit: the unit goes to the deck, the gear is unattached and recalled to base', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P1, 'V(3)', BF_A);
  const gear = put(g, P1, "Doran's Shield", 'base');
  attachNow(g, gear, u);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Keeper's Verdict") }), ['top']);
  assert.equal(zone(g, u), 'mainDeck');
  assert.equal(g.objects[gear].attachedTo, undefined, 'detached');
  assert.equal(locOf(g, gear), 'base', 'recalled');
});
