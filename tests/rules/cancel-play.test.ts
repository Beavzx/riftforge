// UI-CANCEL: a player can back out of their own play / activation while still making its choices (engine/cancel.ts).
// Cancel restores the exact pre-play state (JSON compare; only actionCount — the network version — and ex.lastEvents
// differ), is refused once something hidden was revealed or the play finalized, and is never available to the opponent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, choose, put, runes, handCard, setController } from '../fixtures/helpers.ts';
import { fullDb, spell, unit } from '../fixtures/cards.ts';
import { getLegalActions, validateAction, applyAction, getView } from '../../src/engine/game.ts';
import { card, spell as spellAb, asPlay, onPlay, E, T, F } from '../../src/cards/dsl.ts';
import type { Action, GameState, PlayerId } from '../../src/engine/types.ts';

// test-only scripts: an X choice made while playing, a reveal while playing, a play trigger with a target
card('tc-x', 'As you play me, choose a number from 0 to 3. Deal 1 to a unit.', [asPlay(ctx => { ctx.data.x = ctx.chooseNumber(0, 3, 'Choose X'); }), spellAb(E.deal(1, 0), { targets: [T.unit()] })]);
card('tc-reveal', 'As you play me, reveal the top card of your deck. Deal 1 to a unit.', [asPlay(ctx => { ctx.revealTop(1); }), spellAb(E.deal(1, 0), { targets: [T.unit()] })]);
card('tc-pinger-unit', 'When you play me, deal 1 to a unit.', [onPlay(E.deal(1, 0), { targets: [T.unit(F.atBattlefield)] })]);

function db() {
  const d = fullDb();
  d['tc-x'] = spell('tc-x', 1, { name: 'Test X', text: 'As you play me, choose a number from 0 to 3. Deal 1 to a unit.' });
  d['tc-reveal'] = spell('tc-reveal', 1, { name: 'Test Reveal', text: 'As you play me, reveal the top card of your deck. Deal 1 to a unit.' });
  d['tc-pinger-unit'] = unit('tc-pinger-unit', 1, 1, { name: 'Test Pinger Unit', text: 'When you play me, deal 1 to a unit.' });
  return d;
}

/** JSON of a state without the two fields a cancel is allowed to change */
function snap(g: GameState): string {
  return JSON.stringify(g, (k, v) => (k === 'actionCount' || k === 'lastEvents' ? undefined : v));
}
const cancel = (p: PlayerId): Action => ({ type: 'cancel', player: p });
const canCancel = (g: GameState, p: PlayerId) => getLegalActions(g, p).some(a => a.type === 'cancel') && validateAction(g, cancel(p)) === null;

/** cancel at the current decision: offered, last in the list, restores `before` exactly */
function cancelRestores(g: GameState, before: GameState, kind: string) {
  assert.equal(g.pending?.kind, kind, `pending ${g.pending?.kind}, expected ${kind}`);
  assert.equal(g.pending?.player, 0);
  const legal = getLegalActions(g, 0);
  assert.equal(legal[legal.length - 1].type, 'cancel', 'cancel is listed (last)');
  assert.equal(validateAction(g, cancel(0)), null);
  const r = applyAction(g, cancel(0));
  assert.equal(snap(r.state), snap(before), 'state restored byte-for-byte');
  assert.ok(r.state.actionCount > g.actionCount, 'actionCount (network version) keeps increasing');
  assert.deepEqual(r.events, [{ type: 'playCancelled', player: 0 }]);
  assert.equal(r.state.pending?.kind, before.pending?.kind);
  return r.state;
}

function setup(): GameState {
  const g = newGame({ db: db() });
  runes(g, 0, 4);
  return g;
}

test('cancel at chooseTargets (spell): card back in hand, runes untouched', () => {
  const g = setup();
  put(g, 1, 't-u2', 0); put(g, 1, 't-u3', 0);
  const bolt = handCard(g, 0, 'ts-bolt');
  const s1 = act(g, { type: 'playCard', player: 0, obj: bolt });
  const back = cancelRestores(s1, g, 'chooseTargets');
  assert.equal(back.objects[bolt].zone, 'hand');
  assert.ok(back.players[0].hand.includes(bolt));
  // the same play can be made again afterwards
  assert.equal(act(back, { type: 'playCard', player: 0, obj: bolt }).pending?.kind, 'chooseTargets');
});

test('cancel at chooseMode, and after the mode at its chooseTargets', () => {
  const g = setup();
  put(g, 1, 't-u2', 0); put(g, 1, 't-u3', 0);
  const m = handCard(g, 0, 'ts-modal');
  const s1 = act(g, { type: 'playCard', player: 0, obj: m });
  cancelRestores(s1, g, 'chooseMode');
  const ping = s1.pending!.options!.find(o => o.id === 'ping')!.id;
  const s2 = choose(s1, ping);
  cancelRestores(s2, g, 'chooseTargets');
});

test('cancel at a chooseNumber (X) made while playing', () => {
  const g = setup();
  put(g, 1, 't-u2', 0);
  const x = handCard(g, 0, 'tc-x');
  const s1 = act(g, { type: 'playCard', player: 0, obj: x });
  cancelRestores(s1, g, 'chooseNumber');
});

test('cancel at an optional additional cost (Accelerate) and at Repeat after targets were chosen', () => {
  const g = setup();
  const acc = handCard(g, 0, 't-accel');
  const s1 = act(g, { type: 'playCard', player: 0, obj: acc, destination: 'base' });
  cancelRestores(s1, g, 'optional');

  const g2 = setup();
  const a = put(g2, 1, 't-u2', 0); put(g2, 1, 't-u3', 0);
  const rep = handCard(g2, 0, 'ts-repeat');
  const t1 = act(g2, { type: 'playCard', player: 0, obj: rep });
  assert.equal(t1.pending?.kind, 'chooseTargets');
  const t2 = choose(t1, a);
  cancelRestores(t2, g2, 'optional');
});

test('cancel at payment (manual pay) restores the pool and runes', () => {
  const g = setup();
  g.ex.manualPay[0] = true;
  const u = handCard(g, 0, 't-u2');
  const s1 = act(g, { type: 'playCard', player: 0, obj: u, destination: 'base' });
  const back = cancelRestores(s1, g, 'payment');
  assert.ok(back.players[0].runesInPlay.every(r => !back.objects[r].exhausted));
});

test('cancel at chooseDestination', () => {
  const g = setup();
  setController(g, 0, 0); put(g, 0, 't-u1', 0);
  const u = handCard(g, 0, 't-u2');
  const s1 = act(g, { type: 'playCard', player: 0, obj: u });
  cancelRestores(s1, g, 'chooseDestination');
});

test('cancel an activated ability at its chooseTargets: the source stays ready', () => {
  const g = setup();
  const pinger = put(g, 0, 'ts-pinger', 'base');
  put(g, 1, 't-u2', 0); put(g, 1, 't-u3', 0);
  const s1 = act(g, { type: 'activate', player: 0, obj: pinger, abilityIndex: 0 });
  const back = cancelRestores(s1, g, 'chooseTargets');
  assert.equal(back.objects[pinger].exhausted, false);
});

test('refused after a reveal: the play must go on', () => {
  const g = setup();
  put(g, 1, 't-u2', 0); put(g, 1, 't-u3', 0);
  const r = handCard(g, 0, 'tc-reveal');
  const s1 = act(g, { type: 'playCard', player: 0, obj: r });
  assert.equal(s1.pending?.kind, 'chooseTargets');
  assert.equal(canCancel(s1, 0), false);
  assert.match(validateAction(s1, cancel(0)) ?? '', /no longer/);
  assert.throws(() => applyAction(s1, cancel(0)));
});

test('the opponent can never cancel your play', () => {
  const g = setup();
  put(g, 1, 't-u2', 0); put(g, 1, 't-u3', 0);
  const bolt = handCard(g, 0, 'ts-bolt');
  const s1 = act(g, { type: 'playCard', player: 0, obj: bolt });
  assert.ok(canCancel(s1, 0));
  assert.equal(getLegalActions(s1, 1).some(a => a.type === 'cancel'), false);
  assert.ok(validateAction(s1, cancel(1)));
  assert.throws(() => applyAction(s1, cancel(1)));
});

test('not offered once the play finalized (chain response, or a play trigger in the same step)', () => {
  const g = setup();
  put(g, 1, 't-u2', 0); put(g, 1, 't-u3', 0);
  const bolt = handCard(g, 0, 'ts-bolt');
  const s1 = act(g, { type: 'playCard', player: 0, obj: bolt });
  const tgt = s1.pending!.options![0].id;
  const s2 = choose(s1, tgt);                       // finalized: on the chain, opponent may respond
  assert.equal(s2.pending?.kind, 'chainResponse');
  for (const p of [0, 1] as PlayerId[]) { assert.equal(canCancel(s2, p), false); assert.ok(validateAction(s2, cancel(p))); }

  // a "when you play me" trigger asks for its target after the unit finalized: no cancel there
  const g3 = setup();
  put(g3, 1, 't-u2', 0); put(g3, 1, 't-u3', 0);
  const pu = handCard(g3, 0, 'tc-pinger-unit');
  const s3 = act(g3, { type: 'playCard', player: 0, obj: pu, destination: 'base' });
  assert.equal(s3.pending?.kind, 'chooseTargets');
  assert.equal(s3.objects[pu].zone, 'base', 'the unit is in play');
  assert.equal(canCancel(s3, 0), false);
  // and at the main phase there is nothing to cancel
  assert.ok(validateAction(g, cancel(0)));
});

test('getView: while cancelable the opponent sees the pre-play board, the player sees their play', () => {
  const g = setup();
  put(g, 1, 't-u2', 0); put(g, 1, 't-u3', 0);
  const bolt = handCard(g, 0, 'ts-bolt');
  const s1 = act(g, { type: 'playCard', player: 0, obj: bolt });
  const opp = getView(s1, 1), me = getView(s1, 0);
  // the card is still one of P0's hidden hand cards for P1 (HIDDEN-IDS: under an alias, never its real id)
  assert.equal(opp.state.objects[bolt], undefined);
  assert.equal(opp.state.players[0].hand.length, g.players[0].hand.length);
  assert.ok(opp.state.players[0].hand.every(id => opp.state.objects[id].cardId === 'hidden' && opp.state.objects[id].zone === 'hand'));
  assert.deepEqual(opp.state.players[0].hand, getView(g, 1).state.players[0].hand, 'same aliases as before the play began');
  assert.equal(opp.state.chain.length, 0);
  assert.equal(opp.pending?.player, 0);
  assert.equal(opp.pending?.options, undefined);
  assert.ok(!JSON.stringify(opp).includes('Test Bolt'), 'the card being played is not named anywhere');
  assert.deepEqual(opp.legal, []);
  assert.equal(opp.state.actionCount, s1.actionCount);
  assert.equal(me.state.objects[bolt].zone, 'chain');
  assert.ok(me.legal.some(a => a.type === 'cancel'));
  // once finalized, everyone sees it
  const s2 = choose(s1, s1.pending!.options![0].id);
  assert.equal(getView(s2, 1).state.objects[bolt].cardId, 'ts-bolt');
});

test('net: the host accepts a cancel from the guest seat; the guest view (with cancel listed) passes the wire check', async () => {
  const { HostSession } = await import('../../src/net/online.ts');
  const { parseMsg } = await import('../../src/net/protocol.ts');
  const g = newGame({ db: db(), firstPlayer: 1 });
  runes(g, 1, 4);
  put(g, 0, 't-u2', 0); put(g, 0, 't-u3', 0);
  const bolt = handCard(g, 1, 'ts-bolt');
  const sent: Record<string, unknown>[] = [];
  const lobby = { ch: { send: (m: Record<string, unknown>) => sent.push(JSON.parse(JSON.stringify(m))) }, me: { cid: 'H' }, state: { code: 'X', match: null }, seen: () => true, recordResult() {}, db: {} };
  const host = new HostSession(lobby as never, 'gid', null, ['H', 'G'], ['Alice', 'Bob'], g);
  try {
    const lastView = () => { const m = [...sent].reverse().find(x => x.t === 'view')!; assert.ok(parseMsg(m), 'view passes the wire check'); return m.view as { legal: Action[]; pending: { kind: string } | null }; };
    host.onMsg({ t: 'act', cid: 'G', gid: 'gid', seq: 1, ver: host.ver, action: { type: 'playCard', player: 1, obj: bolt } });
    assert.equal(host.state.pending?.kind, 'chooseTargets');
    const v = lastView();
    assert.ok(v.legal.some(a => a.type === 'cancel'), 'guest is offered cancel');
    // the host's own view (seat 0) does not show the guest's play: the card is still a hidden hand card (HIDDEN-IDS: under
    // an alias, its real id is not in the view)
    const hv = host.view();
    assert.equal(hv.state.objects[bolt], undefined);
    assert.equal(hv.state.players[1].hand.length, g.players[1].hand.length);
    assert.equal(hv.state.chain.length, 0);
    const msg = { t: 'act', cid: 'G', gid: 'gid', seq: 2, ver: host.ver, action: { type: 'cancel', player: 1 } };
    assert.ok(parseMsg(msg as never), 'cancel intent passes the wire check');
    host.onMsg(msg as never);
    assert.ok(!sent.some(m => m.t === 'err'), JSON.stringify(sent.filter(m => m.t === 'err')));
    assert.equal(snap(host.state), snap(g), 'host state restored');
    assert.equal(lastView().pending?.kind, 'mainAction');
    // the host (seat 0) can't cancel for the guest, and the guest can't send a cancel for seat 0
    host.onMsg({ t: 'act', cid: 'G', gid: 'gid', seq: 3, ver: host.ver, action: { type: 'playCard', player: 1, obj: bolt } });
    assert.match((await host.act({ type: 'cancel', player: 0 })) ?? '', /only the player making the play/);
    assert.equal(host.state.pending?.kind, 'chooseTargets', 'still choosing');
  } finally { host.close(); }
});
