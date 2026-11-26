// docs/rules-tests.md §K — Official FAQ rulings (T168-T210)
// Where a ruling is about a rules mechanic, it is tested with a fixture that reproduces the card's
// text (tests/fixtures/conformance/cards.ts, "...Like" cards). Where it depends on a specific real
// card script or on an engine hook that does not exist yet, the test uses the real card and is
// marked todo (see docs/conformance-needs.md).
import { test } from 'node:test';
import { kill as killUnits } from '../../src/engine/actions.ts';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, mod, nextTurn, endTurn, EventLog, setRunes,
  P0, P1, BF_A, BF_B, zone, locOf, mightOf, resolveChain, passAll, pend, answer, yes, no, choose, legal, canPlayNow, playDests,
  validateAction, activate, readyRunes, exhaustedRunes, optionIds, attackSetup, needsScripts, cid, setBattlefieldCard, addRunes, fundAll,
  type GameState, type ObjId,
} from './harness.ts';

function toDamage(g: GameState, log?: EventLog): GameState {
  for (let i = 0; i < 30; i++) {
    const d = g.pending;
    if (!d || d.inStep || (d.kind !== 'showdownAction' && d.kind !== 'chainResponse')) return g;
    g = log ? log.pass(g) : pass(g);
  }
  return g;
}
const todoReal = (reason: string, ...cards: string[]) => { const m = needsScripts(...cards); return m ? `${m}; ${reason}` : false; };

// ---------------------------------------------------------------------------------------------
test('T168 — Ki Barrier vs Lotus Trap order (VEN-FAQ #11)', () => {
  // played as spells during the combat this time (T091 used direct setup)
  const run = (pickKiFirst: boolean) => {
    let { g, def } = attackSetup(['V(4)'], ['V(4)']);
    const d = def[0];
    g = pass(g);
    [g] = cast(g, P1, 'KiBarrierLike', { targets: [[d]] });
    g = passN(g, 2);
    expectPending(g, 'showdownAction', P0);
    g = pass(g);
    [g] = cast(g, P1, 'LotusTrapLike', { targets: [[d]] });
    g = passN(g, 2);
    const log = new EventLog();
    g = toDamage(g, log);
    const dd = expectPending(g, pend(g).kind, P1, 'replacement order chosen by the affected unit\'s controller');
    assert.ok(dd.inStep);
    const ki = dd.options!.find(o => /prevent/i.test(o.label))!;
    const lo = dd.options!.find(o => o !== ki)!;
    g = log.choose(g, (pickKiFirst ? ki : lo).id);
    g = toDamage(g, log);
    const dealt = log.of('damage').filter(e => e.obj === d).reduce((s, e) => s + Number(e.amount), 0);
    const left = g.ex.delayed.find(x => x.key === 'builtin:prevent' && x.data.obj === d)?.data.remaining ?? 0;
    return { dealt, left };
  };
  assert.deepEqual(run(true), { dealt: 0, left: 3 });
  assert.deepEqual(run(false), { dealt: 1, left: 0 });
});

test('T169 — Hidden Blade with "can\'t be killed" (VEN-FAQ #34a)', () => {
  let g = S0();
  const u = put(g, P1, 'Unkillable(3)', BF_A);
  control(g, BF_A, P1);
  const h1 = g.players[1].hand.length;
  [g] = cast(g, P0, 'HiddenBladeLike', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(locOf(g, u), BF_A, 'no kill');
  assert.equal(g.players[1].hand.length, h1 + 2, 'its controller still draws 2');
});

test('T170 — Hidden Blade target moved to base by Flash (VEN-FAQ #34b)', () => {
  let g = S0();
  const u = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const mr = hand(g, P1, 'MoveR');
  [g] = cast(g, P0, 'HiddenBladeLike', { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, mr, { targets: [[u]] });
  const h1 = g.players[1].hand.length;
  g = resolveChain(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.players[1].hand.length, h1, 'mistarget: the linked draw is ignored too');
});

test('T171 — Hidden Blade vs Zhonya\'s Hourglass (VEN-FAQ #34c)', () => {
  let g = S0();
  const hg = put(g, P1, 'Hourglass', 'base');
  const u = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const h1 = g.players[1].hand.length;
  [g] = cast(g, P0, 'HiddenBladeLike', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, hg), 'trash', 'Hourglass dies instead');
  assert.equal(locOf(g, u), 'base', 'unit recalled');
  assert.equal(g.players[1].hand.length, h1 + 2, 'controller still draws 2');
});

test('T172 — Gangplank, Naval empowered vs Stupefy at 1 Might (VEN-FAQ #21)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const gp = put(g, P1, 'Gangplank, Naval', BF_A);
  control(g, BF_A, P1);
  g.objects[gp].empowered = 1;
  const base = mightOf(g, gp) ?? 0;
  mod(g, gp, { might: 1 - base });
  [g] = cast(g, P0, 'Stupefy', { targets: [[gp]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, gp), 1, 'no +3 (Might snapshot → no −Might event)');
  assert.ok(g.objects[gp].modifiers.every(m => (m.might ?? 0) !== 3));
});

test('T173 — Blast Cone stun then Back Off on empowered Gangplank (VEN-FAQ #20)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const gp = put(g, P1, 'Gangplank, Naval', 'base');
  g.objects[gp].empowered = 1;
  put(g, P0, 'Blast Cone', 'base');
  [g] = cast(g, P0, 'ogn-043-298', { targets: [[gp]], locations: [BF_A] });   // real Charm; R-2: destination chosen as played
  g = passN(g, 2);
  g = answer(g, { may: [true] }, P0);
  g = resolveChain(g);
  assert.equal(g.objects[gp].stunned, true, 'Gangplank IS stunned by Blast Cone');
  const m0 = mightOf(g, gp);
  if (pend(g).player === P1) g = pass(g);           // the move to the open battlefield started P1's showdown there (focus P1)
  [g] = cast(g, P0, 'Back Off', { targets: [[gp]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, gp), m0, 'Back Off on an already-stunned Gangplank: no stun performed → no +3');
});

test('T174 — Mel empowered + Moonfall (VEN-FAQ #3)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const mel = put(g, P0, 'Mel, Newly Awakened', BF_A);
  control(g, BF_A, P0);
  g.objects[mel].empowered = 1;
  const chosen = put(g, P1, 'V(5)', 'base');
  const other = put(g, P1, 'V(5)', BF_A);
  [g] = cast(g, P0, 'Moonfall', { battlefields: [BF_A], may: [true], targets: [[chosen]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, chosen), 2, 'chosen enemy unit gets −3');
  assert.equal(mightOf(g, other), 3, 'others at that battlefield −2');
});

test('T175 — Mel empowered + Stupefy (VEN-FAQ #4)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const mel = put(g, P0, 'Mel, Newly Awakened', 'base');
  g.objects[mel].empowered = 1;
  const v = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P0, 'Stupefy', { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, v), 1, '−2, minimum 1 (2 → 1)');
});

test('T176 — Abandon vs uncounterable spell (VEN-FAQ #5)', () => {
  let g = S0();
  put(g, P0, 'NoCounterAura', 'base');
  const v = put(g, P1, 'V(5)', 'base');
  let z: string;
  [g, z] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = pass(g);
  [g] = cast(g, P1, 'AbandonLike', { targets: [[g.chain[0].id]] });
  g = passN(g, 2);
  if (pend(g).inStep) g = choose(g);              // Abandon's Predict
  assert.equal(g.chain.length, 1, 'the spell stays on the chain');
  assert.equal(g.chain[0].source, z);
  g = resolveChain(g);
  assert.equal(g.objects[v].damage, 2, 'and resolves normally');
  assert.equal(zone(g, z), 'trash');
});

test('T177 — Rebuttal is not a counter when paid (VEN-FAQ #6-7)', () => {
  // paid: gain control, may remake choices
  let g = S0();
  const mine0 = put(g, P0, 'V(5)', 'base');
  const v = put(g, P1, 'V(5)', 'base');
  let z: string;
  [g, z] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = pass(g);
  [g] = cast(g, P1, 'RebuttalLike', { targets: [[g.chain[0].id]] });
  g = passN(g, 2);
  g = answer(g, { may: [true, true], targets: [[mine0]] }, P1);
  assert.equal(g.chain[0].controller, 1, 'P1 controls ZapM');
  g = resolveChain(g);
  assert.equal(g.objects[mine0].damage, 2, 'new choice made by the new controller');
  assert.equal(g.objects[v].damage, 0);
  assert.equal(zone(g, z), 'trash', 'still goes to its owner\'s trash');
  // not paid: countered
  let h = S0();
  const w = put(h, P1, 'V(5)', 'base');
  let z2: string;
  [h, z2] = cast(h, P0, 'ZapM', { targets: [[w]] });
  h = pass(h);
  [h] = cast(h, P1, 'RebuttalLike', { targets: [[h.chain[0].id]] });
  h = passN(h, 2);
  h = answer(h, { may: [false] }, P1);
  h = resolveChain(h);
  assert.equal(h.objects[w].damage, 0, 'countered');
  assert.equal(zone(h, z2), 'trash');
});

test('T178 — Gaining control of a finalized spell doesn\'t make it "played" by you (VEN-FAQ #17)', () => {
  let g = S0();
  const v = put(g, P1, 'V(5)', 'base');
  let st: string;
  [g, st] = cast(g, P0, 'StupefyLike', { targets: [[v]] });
  g = pass(g);
  let rb: string;
  [g, rb] = cast(g, P1, 'RebuttalLike', { targets: [[g.chain[0].id]] });
  g = passN(g, 2);
  g = answer(g, { may: [true, false] }, P1);
  g = resolveChain(g);
  assert.ok(g.ex.playedThisTurn[0].includes(st), 'P0\'s count still includes Stupefy');
  assert.deepEqual(g.ex.playedThisTurn[1], [rb], 'P1\'s count includes only Rebuttal');
  // P1's RamLike would cost [5] − 1 = [4]: on P1's next turn after playing nothing else, with 4 runes it is
  // payable only if the discount counted 1 card — checked here via the per-player played lists above.
});

test('T179 — Swain, Visionary scoring (VEN-FAQ #18)', () => {
  let g = S0();
  g.players[0].points = 2;
  const sw = put(g, P0, 'SwainLike(3)', 'base');
  [g] = cast(g, P0, 'V(1)', { dest: 'base' });
  [g] = cast(g, P0, 'Sword', { dest: 'base' });
  const v = put(g, P1, 'V(9)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = resolveChain(g);
  g = move(g, P0, [sw], BF_A);
  g = passN(g, 2);
  g = resolveChain(g);
  assert.equal(g.players[0].points, 4, '+1 conquer and +1 Swain');
});

test('T180 — Switcheroo vs empowered Gangplank (VEN-FAQ #19)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const gp = put(g, P0, 'Gangplank, Naval', BF_A);
  control(g, BF_A, P0);
  g.objects[gp].empowered = 1;
  mod(g, gp, { might: 6 - (mightOf(g, gp) ?? 0) });
  const o = put(g, P0, 'V(2)', BF_A);
  [g] = cast(g, P0, 'Switcheroo', { targets: [[gp, o]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, gp), 9, 'decrease replaced by +3');
  assert.equal(mightOf(g, o), 6);
});

test('T181 — Perched Grimwyrm + Dragon Roost (VEN-FAQ #26)', { todo: todoReal('needs real scripts', 'Perched Grimwyrm', 'Dragon Roost') }, () => {
  const g = S0({ bfA: 'Dragon Roost' });
  fundAll(g, P0); fundAll(g, P1);
  const gw = hand(g, P0, 'Perched Grimwyrm');
  const ds = playDests(g, P0, gw);
  assert.ok(!ds.includes(BF_A), 'can\'t be played to Dragon Roost unless conquered there this turn ("can\'t" beats the permission)');
  assert.deepEqual(ds, [], 'nowhere conquered this turn → not playable at all (not even to base)');
});

// ENGINE-5: VEN-FAQ #25 is "Temporal Breach and Dragon Roost" (Temporal Breach on my Elder Dragon in base + Roost's [A][A]: "You
// can choose which of those two locations"); the old body used Perched Grimwyrm, whose "can't" excludes the Roost (= T181,
// VEN-FAQ #26). N6 is done (ENGINE-4 RJ#12173: play-rule destination costs are offered as a destination choice).
test('T182 — Dragon Roost alternative location (VEN-FAQ #25)', { todo: todoReal('needs Temporal Breach / Elder Dragon / Dragon Roost scripts', 'Temporal Breach', 'Elder Dragon', 'Dragon Roost') }, () => {
  const run = (payRoost: boolean) => {
    let g = S0({ bfA: 'Dragon Roost' });
    fundAll(g, P0, 8); fundAll(g, P1);
    const ed = put(g, P0, 'Elder Dragon', 'base');
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') });
    let offered = false;
    for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = g.pending;
      if (!d.inStep) { g = pass(g); continue; }
      if (d.kind === 'optional' && /Roost|\[A\]\[A\]/i.test(d.prompt ?? '')) { offered = true; g = choose(g, payRoost ? 'yes' : 'no'); continue; }
      const roost = d.options!.find(o => o.id === String(BF_A) || /Roost/i.test(o.label));
      const base = d.options!.find(o => o.id === 'base' || /^base$/i.test(o.label));
      if (roost && base) { offered = true; g = choose(g, payRoost ? roost.id : base.id); continue; }
      g = choose(g, d.options!.find(o => o.id === ed)?.id ?? d.options![0].id);
    }
    assert.ok(offered, 'the player is offered the choice between the two locations');
    return locOf(g, ed);
  };
  assert.equal(run(true), BF_A, 'paid [A][A]: played to Dragon Roost');
  assert.equal(run(false), 'base', 'or to the same location (base) as Temporal Breach says');
});

test('T183 — Renekton, Brute needs a change to 10+ (VEN-FAQ #30)', () => {
  let g = S0();
  const r = put(g, P0, 'RenektonLike(9)', 'base');
  const h0 = g.players[0].hand.length;
  [g] = cast(g, P0, 'PumpA', { targets: [[r]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, r), 12);
  assert.equal(g.players[0].hand.length, h0 + 1, 'crossing 9 → 12 (≥10) triggers');
  [g] = cast(g, P0, 'PumpA', { targets: [[r]] });
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, h0 + 1, '12 → 15 does not trigger again');
});

test('T184 — Akali, Silent mistargeted (VEN-FAQ #16)', () => {
  let { g, atk, def } = attackSetup(['AkaliLike(3)'], ['V(1)']);
  const ak = atk[0];
  const mr = hand(g, P0, 'MoveR');
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  [g] = cast(g, P1, 'StarCrossedLike', { targets: [[def[0]], [ak]] });
  expectPending(g, 'chainResponse', P1);
  g = pass(g);
  g = play(g, P0, mr, { targets: [[ak]] });
  g = resolveChain(g);
  assert.equal(locOf(g, ak), 'base', 'Akali unaffected (mistarget): stays at base');
  assert.equal(zone(g, def[0]), 'hand', 'P1\'s own chosen unit still returns');
});

test('T185 — Vilemaw\'s Lair vs Ride the Wind (VEN-FAQ #33)', () => {
  let g = S0({ bfA: 'cf-bf-lair' });
  const u = put(g, P0, 'V(2)', BF_A, { ready: false });
  control(g, BF_A, P0);
  [g] = cast(g, P0, 'RideTheWindLike', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(locOf(g, u), BF_A, 'move negated');
  assert.equal(g.objects[u].exhausted, false, 'still readied');
});

test('T186 — Kayle disempower (VEN-FAQ #15)', () => {
  let g = S0();
  const k = put(g, P0, 'KayleLike(2)', 'base');
  for (let i = 0; i < 3; i++) { g = activate(g, P0, k, 901); g = resolveChain(g); }
  assert.equal(g.objects[k].empowered, 3, 'Empowered three times');
  const canAt3 = legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === k && a.abilityIndex === 901);
  [g] = cast(g, P0, 'DisempowerM', { targets: [[k]] });
  g = resolveChain(g);
  assert.equal(g.objects[k].empowered, 2, 'Disempower removes one status');
  assert.ok(canAt3, 'Empower can still be activated at 3 (does nothing) — Radiance patch');
});

test('T187 — Temporal Breach on a stolen unit (VEN-FAQ #29)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hostile Takeover', { targets: [[u]] });
  g = resolveChain(g);
  g = passAll(g);
  g.objects[u].exhausted = false;
  g = move(g, P0, [u], 'base');
  [g] = cast(g, P0, 'Temporal Breach', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'banishment', 'owner can\'t play it into P0\'s base → stays banished');
});

test('T188 — Turn to Dust on attached Equipment (UNL-FAQ #3)', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  const s = put(g, P0, 'Sword', 'base');
  g.objects[s].attachedTo = u; g.ex.attachCount = (g.ex.attachCount ?? 0) + 1;
  [g] = cast(g, P0, 'TurnToDustLike', { targets: [[s]] });
  g = resolveChain(g);
  g = nextTurn(g);
  assert.equal(zone(g, s), 'base', 'survives the opponent\'s beginning phase');
  g = nextTurn(g);
  assert.equal(zone(g, s), 'trash', 'dies at its controller\'s next beginning phase (granted Temporary active)');
});

test('T189 — Spinning Axe attached with granted Temporary (UNL-FAQ #4)', () => {
  const run = (grant: boolean) => {
    let g = S0({ tp: P1 });
    const u = put(g, P0, 'V(2)', 'base');
    const ax = put(g, P0, 'SpinAxe', 'base');
    g.objects[ax].attachedTo = u; g.ex.attachCount = (g.ex.attachCount ?? 0) + 1;
    if (grant) mod(g, ax, { addKeywords: ['Temporary'], duration: 'permanent', layer: 2 });
    g = nextTurn(g);
    return zone(g, ax);
  };
  assert.equal(run(false), 'base', 'printed Temporary inactive while attached');
  assert.equal(run(true), 'trash', 'granted Temporary active → dies');
});

function patron(): { g: GameState; log: EventLog; p: ObjId; r: ObjId } {
  const g0 = S0();
  const r = put(g0, P0, 'Recruit', BF_A);
  control(g0, BF_A, P0);
  const p = hand(g0, P0, 'PatronLike(4)');
  const log = new EventLog();
  let g = log.act(g0, { type: 'playCard', player: P0, obj: p, destination: BF_A });
  g = answer(g, { cards: [[r]] }, P0);
  return { g, log, p, r };
}

test('T190 — Control can\'t be lost while items are on the chain (UNL-FAQ #5, Cruel Patron)', () => {
  const { g, p, r } = patron();
  assert.equal(locOf(g, p), BF_A, 'Patron enters at BF-A (legal)');
  assert.ok(!g.objects[r], 'the Recruit was killed as the cost');
  assert.equal(g.battlefields[BF_A].controller, 0, 'P0 keeps BF-A');
});

test('T191 — No cleanup during finalization (UNL-FAQ #6)', () => {
  const { g, log, p } = patron();
  assert.equal(locOf(g, p), BF_A);
  assert.ok(!log.of('controlLost').some(e => e.bf === BF_A), 'no cleanup ran between the kill (cost) and the finalization');
  assert.equal(g.battlefields[BF_A].controller, 0);
});

// ENGINE-5: Flash moves only one of the two chosen units (with both moved, Repulse would have no unit at a battlefield and the
// test would pass trivially); the control kills it instead (a non-board zone → no longer counts as chosen). The friendly
// Alpha Strike unit is the only candidate, so it is chosen automatically and the first target answer is the recipients.
test('T192 — Alpha Strike targets moved by Flash remain chosen (UNL-FAQ #11)', { todo: todoReal('needs real Alpha Strike / Flash / Repulse scripts', 'Alpha Strike', 'Flash', 'Repulse') }, () => {
  const run = (how: 'flash' | 'kill') => {
    let g = S0();
    fundAll(g, P0); fundAll(g, P1);
    put(g, P0, 'V(5)', BF_A);
    control(g, BF_A, P0);
    const a = put(g, P1, 'V(1)', BF_B), b = put(g, P1, 'V(1)', BF_B);
    control(g, BF_B, P1);
    const rp = hand(g, P1, 'Repulse');
    [g] = cast(g, P0, 'Alpha Strike', { targets: [[a, b]] });
    assert.deepEqual(g.chain[0].targets?.[1], [a, b], 'sanity: both enemy units chosen');
    if (how === 'flash') {
      g = pass(g);
      g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[a]] });
      g = passN(g, 2);
      assert.equal(zone(g, a), 'base', 'Flash moved one chosen unit to base');
    } else killUnits(g, [a]);
    if (pend(g).player === P0) g = pass(g);
    assert.equal(pend(g).player, P1, 'P1 has priority with Alpha Strike on the chain');
    return canPlayNow(g, P1, rp);
  };
  assert.equal(run('flash'), false, 'P1 can\'t use Repulse on the other unit: the moved unit remains "chosen"');
  assert.equal(run('kill'), true, 'exception: a target that went to a non-board zone no longer counts');
});

test('T193 — Yone, Blademaster on Reckoner\'s Arena hold (UNL-FAQ #12)', { todo: todoReal('needs real scripts', 'Yone, Blademaster', 'Reckoner\'s Arena') }, () => {
  let g = S0({ tp: P1, bfA: 'Reckoner\'s Arena' });
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Yone, Blademaster', BF_A);
  control(g, BF_A, P0);
  put(g, P1, 'V(3)', 'base');
  g = endTurn(g, P1);
  assert.ok(!g.chain.some(c => g.objects[c.source]?.cardId === cid('Yone, Blademaster')), 'Yone\'s ability doesn\'t go on the chain');
});

// ENGINE-5: the FAQ case needs Atakhan to *have* Accelerate — granted by Rek'Sai, Breacher to a unit played from outside the
// hand (here: from banishment via AnvilLike) — and Rek'Sai killed as Atakhan's additional cost (docs/keywords.md, CR 805.2.b)
test('T194 — Atakhan with Accelerate losing Accelerate (UNL-FAQ #13)', { todo: todoReal('needs real Atakhan / Rek\'Sai, Breacher scripts', 'Atakhan', 'Rek\'Sai, Breacher') }, () => {
  const run = (accel: boolean) => {
    let g = S0();
    fundAll(g, P0, 6); fundAll(g, P1);
    const rek = put(g, P0, 'Rek\'Sai, Breacher', 'base');
    const anv = put(g, P0, 'AnvilLike', 'base');
    const a = put(g, P0, 'Atakhan', 'deckTop');
    [g] = cast(g, P0, 'KillGearM', { targets: [[anv]] });
    g = resolveChain(g);
    assert.equal(zone(g, a), 'banishment', 'sanity: playable from banishment (not from hand → Accelerate from Rek\'Sai)');
    g = play(g, P0, a, { dest: 'base', may: [accel], cards: [[rek]] });
    assert.equal(zone(g, rek), 'trash', 'Rek\'Sai killed for the additional cost');
    assert.equal(zone(g, a), 'base');
    return g.objects[a].exhausted;
  };
  assert.equal(run(true), false, 'Accelerate paid → enters ready though it lost Accelerate before finalizing');
  assert.equal(run(false), true, 'sanity: not paid → exhausted');
});

test('T195 — Singularity countered; Jhin still cheap (UNL-FAQ #10)', { todo: todoReal('needs real Jhin/Singularity scripts', 'Jhin, Meticulous Killer', 'Singularity') }, () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const v = put(g, P1, 'V(9)', 'base');
  const cr = hand(g, P1, 'CounterR');
  [g] = cast(g, P0, 'Singularity', { targets: [[v]] });
  g = pass(g);
  g = play(g, P1, cr, { targets: [[g.chain[0].id]] });
  g = resolveChain(g);
  setRunes(g, P0, 1, 'mind');
  const j = hand(g, P0, 'Jhin, Meticulous Killer');
  assert.ok(canPlayNow(g, P0, j), 'Jhin playable for [C]');
});

test('T196 — Green Father/Brush on Aspirant\'s Climb at 8–8 (UNL-FAQ #1)', () => {
  let g = S0({ bfA: 'cf-bf-aspirant' });
  g.players[0].points = 8;
  g.players[1].points = 8;
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_B);                       // any action → cleanup
  g = passN(g, 2);
  assert.equal(g.winner, null, 'victory score 9: nobody wins');
  [g] = cast(g, P0, 'ReplaceWithBrush', { battlefields: [BF_A] });
  g = passN(g, 2);
  g = answer(g, { battlefields: [BF_A] }, P0);
  g = resolveChain(g);
  assert.equal(g.objects[g.battlefields[BF_A].objId].cardId, 'cf-brush', 'Aspirant replaced by Brush');
  assert.equal(g.winner, null, 'victory score back to 8; tied at 8–8: nobody wins');
});

test('T197 — Draven win-combat trigger before conquer (SFD-FAQ #13-14)', () => {
  let { g } = attackSetup(['DravenLike(4)'], ['V(1)']);
  g.players[0].points = 6;
  const h0 = g.players[0].hand.length;
  g = toDamage(g);
  g = passAll(g);
  g = resolveChain(g);
  assert.equal(g.battlefields[BF_A].controller, 0);
  assert.equal(g.players[0].points, 7, 'Draven +1 (→7); the conquer at 7 is the final point → draw instead');
  assert.equal(g.players[0].hand.length, h0 + 1, 'drew 1 instead of the final point');
});

test('T198 — Winning combat by default (SFD-FAQ #13)', () => {
  let { g, def } = attackSetup(['WinDraw(3)'], ['V(1)']);
  const h0 = g.players[0].hand.length;
  g = pass(g);
  [g] = cast(g, P1, 'MoveR', { targets: [[def[0]]] });
  g = passN(g, 2);
  g = toDamage(g);
  g = passAll(g);
  g = resolveChain(g);
  assert.equal(g.battlefields[BF_A].controller, 0);
  assert.equal(g.players[0].hand.length, h0 + 1, '"win a combat" trigger fired without damage');
});

test('T199 — Tianna Crownguard (SFD-FAQ #10)', () => {
  let g = S0();
  put(g, P1, 'TiannaLike(3)', BF_B);
  control(g, BF_B, P1);
  const c = put(g, P0, 'ConquerDraw(3)', 'base');
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [c], BF_A);
  g = passN(g, 2);
  g = resolveChain(g);
  assert.equal(g.battlefields[BF_A].controller, 0, 'still conquers');
  assert.equal(g.players[0].points, 0, 'gains no points');
  assert.equal(g.players[0].hand.length, h0 + 1, 'conquer trigger fires');
  // at 7: the final-point draw still happens
  let h = S0();
  h.players[0].points = 7;
  put(h, P1, 'TiannaLike(3)', BF_B);
  control(h, BF_B, P1);
  const c2 = put(h, P0, 'V(3)', 'base');
  const k0 = h.players[0].hand.length;
  h = move(h, P0, [c2], BF_A);
  h = passN(h, 2);
  assert.equal(h.players[0].points, 7);
  assert.equal(h.players[0].hand.length, k0 + 1, 'final-point draw still happens');
});

test('T200 — Forgotten Monument (SFD-FAQ #11)', () => {
  let g = S0({ bfA: 'cf-bf-monument', turn: 3 });     // P0's 2nd turn (turnsTaken = 1)
  const c = put(g, P0, 'ConquerDraw(3)', 'base');
  const h0 = g.players[0].hand.length;
  const log = new EventLog();
  g = log.act(g, { type: 'move', player: P0, units: [c], to: BF_A });
  g = log.passAll(g);
  g = resolveChain(g);
  assert.equal(g.battlefields[BF_A].controller, 0, 'establishes control');
  assert.equal(g.players[0].points, 0, 'no point');
  assert.equal(log.of('conquer').length, 0, 'not a conquer');
  assert.equal(g.players[0].hand.length, h0, 'no conquer triggers');
  g = nextTurn(g);
  g = nextTurn(g);                                  // P0's 3rd turn: hold now scores
  assert.equal(g.players[0].points, 1, 'from their third turn it scores');
});

test('T201 — 0 or negative Might doesn\'t die by itself (SFD-FAQ #21-23)', () => {
  const g0 = S0();
  const n = put(g0, P1, 'V(1)', BF_A);
  mod(g0, n, { might: -4 });
  put(g0, P1, 'V(2)', BF_A);
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(5)', 'base');
  assert.equal(mightOf(g0, n), -3);
  let g = move(g0, P0, [a], BF_A);
  assert.equal(zone(g, n), 'battlefield', 'stays alive with 0 damage');
  const log = new EventLog();
  g = toDamage(g, log);
  if (pend(g).kind === 'assignDamage') g = log.act(g, { type: 'assignDamage', player: 0, assignment: (pend(g).data as { suggested: Record<string, number> }).suggested });
  g = toDamage(g, log);
  const toA = log.of('damage').filter(e => e.obj === a).reduce((s, e) => s + Number(e.amount), 0);
  assert.equal(toA, 2, 'contributes 0 to combat');
  const h = S0();
  const m = put(h, P0, 'V(1)', 'base');
  mod(h, m, { might: -4 });
  mod(h, m, { might: 4 });
  assert.equal(mightOf(h, m), 1, 'needs +4 to reach 1');
});

test('T202 — Ezreal, Prodigy reduces optional costs only (SFD-FAQ #24-25)', () => {
  // Accelerate [1][R] reduced by [1] → total [3][R]: payable with exactly 3 runes (T046: [4][R] is not)
  let g = S0();
  setRunes(g, P0, 3);
  put(g, P0, 'EzrealLike(2)', 'base');
  const ac = hand(g, P0, 'Accel(3)');
  g = act(g, { type: 'playCard', player: P0, obj: ac, destination: 'base' });
  expectPending(g, 'optional', P0, 'Accelerate offered: [3] + reduced [R]');
  g = yes(g);
  assert.equal(zone(g, ac), 'base');
  assert.equal(g.objects[ac].exhausted, false, 'entered ready');
  assert.equal(g.players[0].runeDeck.length, 7, '[R] still paid');
  // not Equip
  let h = S0();
  put(h, P0, 'EzrealLike(2)', 'base');
  const s = put(h, P0, 'Sword', 'base');
  const u = put(h, P0, 'V(2)', 'base');
  h = activate(h, P0, s, 900, { targets: [[u]] });
  assert.equal(exhaustedRunes(h, P0), 1, 'Equip [1] not reduced');
  // not Deflect
  let k = S0();
  put(k, P0, 'EzrealLike(2)', 'base');
  const d = put(k, P1, 'Deflect(2,1)', 'base');
  const rd = k.players[0].runeDeck.length;
  [k] = cast(k, P0, 'ZapM', { targets: [[d]] });
  assert.equal(k.players[0].runeDeck.length, rd + 1, 'Deflect [A] not reduced');
});

test('T203 — Repeat with a cost reduction (SFD-FAQ #27)', { todo: todoReal('needs real Find Your Center / Temporal Portal scripts', 'Find Your Center', 'Temporal Portal') }, () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  g.players[1].points = 6;
  const tp = put(g, P0, 'Temporal Portal', 'base');
  g = activate(g, P0, tp, 0);
  g = resolveChain(g);
  const ready0 = readyRunes(g, P0), pool0 = g.players[P0].pool.energy;   // (Portal's rune may leave [1] floating, rules-decisions #65)
  [g] = cast(g, P0, 'Find Your Center', { may: [true] });
  assert.equal(ready0 - readyRunes(g, P0) + pool0 - g.players[P0].pool.energy, 4, 'total 4 (3 + 3 − 2)');
});

test('T204 — Gravity Field (RAD-FAQ #12-14)', () => {
  let g = S0({ tp: P1 });
  const gf = put(g, P0, 'Gravity Field', BF_A);
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const u = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'move', player: P1, units: [u], to: BF_A });
  g = answer(g, { may: [false] }, P1);
  assert.equal(locOf(g, u), 'base', 'tax declined → move cancelled');
  assert.equal(g.objects[u].exhausted, false, 'no exhaust');
  void gf;
});

// ENGINE-5: setup uses the real Hunker Down in response to the Wyrm's ability (the FAQ scenario) instead of a fake modifier
test('T205 — Angler Wyrm forced move choice (RAD-FAQ #15)', { todo: todoReal('needs real Angler Wyrm / Hunker Down scripts', 'Angler Wyrm', 'Hunker Down') }, () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const w = put(g, P0, 'Angler Wyrm', BF_A);
  control(g, BF_A, P0);
  const a = put(g, P1, 'V(1)', 'base');
  const b = put(g, P1, 'V(1)', 'base');
  const c = put(g, P1, 'V(1)', 'base');
  g = activate(g, P0, w, 0);
  if (pend(g).player === P0 && !pend(g).inStep) g = pass(g);
  [g] = cast(g, P1, 'Hunker Down', { targets: [[b]] });
  for (let i = 0; i < 10 && !(pend(g).inStep && pend(g).player === P1 && /Angler Wyrm/.test(pend(g).prompt ?? '')); i++) g = pend(g).inStep ? g : pass(g);
  const d = pend(g);
  assert.match(d.prompt ?? '', /Angler Wyrm/, 'P1 chooses the unit to move');
  const ids = (d.options ?? []).flatMap(o => [o.id, ...(o.objIds ?? [])]);
  assert.ok(!ids.includes(b), 'a unit that can\'t move (Hunker Down) is not a legal pick');
  assert.ok(ids.includes(a) && ids.includes(c), 'sanity: the others are');
});

test('T206 — Runeblade Anvil duration (RAD-FAQ #5-7)', () => {
  // killed on P0's turn (main phase) → playable only until P0's ending phase of THAT turn begins
  let g = S0();
  const anv = put(g, P0, 'AnvilLike', 'base');
  const top = g.players[0].mainDeck[0];
  [g] = cast(g, P0, 'KillGearM', { targets: [[anv]] });
  g = resolveChain(g);
  assert.equal(zone(g, top), 'banishment');
  assert.ok(canPlayNow(g, P0, top), 'playable this turn');
  g = nextTurn(g);
  g = nextTurn(g);
  assert.ok(!canPlayNow(g, P0, top), 'not playable on P0\'s next turn');
  // killed on the opponent's turn → playable until P0's next ending phase begins
  let h = S0({ tp: P1 });
  const anv2 = put(h, P0, 'AnvilLike', 'base');
  const top2 = h.players[0].mainDeck[0];
  [h] = cast(h, P1, 'KillGearM', { targets: [[anv2]] });
  h = resolveChain(h);
  h = nextTurn(h);
  expectPending(h, 'mainAction', P0);
  assert.ok(canPlayNow(h, P0, top2), 'playable during P0\'s next turn');
  h = nextTurn(h);
  h = nextTurn(h);
  assert.ok(!canPlayNow(h, P0, top2), 'expired at P0\'s ending phase');
});

// ENGINE-5: the cost counts as paid though Mordekaiser's replacement saves him (CR 203.2, DECISIONS principle 22) — the
// Atakhan script's custom kill cost used to require an actual death ("could not pay Kill Mordekaiser")
test('T207 — Atakhan + Mordekaiser payment order (RAD-FAQ #4)', { todo: todoReal('needs real Atakhan / Mordekaiser, Twice Slain scripts', 'Atakhan', 'Mordekaiser, Twice Slain') }, () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const m = put(g, P0, 'Mordekaiser, Twice Slain', 'base');
  const v = put(g, P0, 'V(1)', 'base');
  const n0 = g.log.length;
  let a: string;
  [g, a] = cast(g, P0, 'Atakhan', { dest: 'base', may: [true], cards: [[m]] });
  assert.ok(zone(g, a) === 'base');
  const lines = g.log.slice(n0).map(l => l.text);
  const paid = lines.findIndex(t => /^P0 pays/.test(t)), saved = lines.findIndex(t => /Mordekaiser/.test(t));
  assert.ok(paid >= 0 && saved > paid, `Energy and Power are paid before the kill cost (${lines.join(' / ')})`);
  assert.match(lines[paid], /^P0 pays 3 /, 'discounted by Mordekaiser\'s 7 Energy (10 → 3)');
  assert.equal(zone(g, m), 'base', 'Mordekaiser saved himself (recalled)');
  assert.equal(zone(g, v), 'trash', 'by killing the other friendly unit');
});

test('T208 — Mobilize with Seraphic Wyvern and one rune left (RAD-FAQ #2)', () => {
  let g = S0({ runeDeck: [1, 6] });
  put(g, P0, 'WyvernLike(3)', 'base');
  const h0 = g.players[0].hand.length;
  const r0 = g.players[0].runesInPlay.length;
  [g] = cast(g, P0, 'MobilizeLike');
  g = resolveChain(g);
  assert.equal(g.players[0].runesInPlay.length, r0 + 1, 'channels the 1 remaining rune');
  assert.equal(g.players[0].hand.length, h0, '"if you can\'t" refers to the original action, which happened → no draw');
});

test('T209 — Riven + Stellacorn Herder group move trigger order (RAD-FAQ #11)', () => {
  let g = S0();
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const r = put(g, P0, 'RivenLike(2)', 'base');
  const s = put(g, P0, 'StellacornLike(2)', 'base');
  g = move(g, P0, [r, s], BF_A);
  assert.ok(!pend(g).inStep, 'no ordering choice: the exhaust trigger precedes the move triggers');
  assert.equal(g.chain[0]?.source, r, 'Riven\'s "becomes exhausted" trigger goes on the chain first');
  assert.equal(g.chain[1]?.source, s);
});

test('T210 — Possession on Ekko (RAD-FAQ #16)', () => {
  let g = S0();
  const e = put(g, P1, 'EkkoLike(3)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'PossessionLike', { targets: [[e]] });
  g = resolveChain(g);
  assert.equal(g.objects[e].controller, 0);
  assert.equal(locOf(g, e), 'base');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === e), 'the controller may use Ekko\'s ability');
  g = activate(g, P0, e, 0);
  g = resolveChain(g);
  assert.equal(zone(g, e), 'base');
  assert.equal(g.objects[e].controller, 0, 'P0 controls him when he returns');
  assert.ok(g.players[0].base.includes(e));
});

void yes; void no; void endTurn; void validateAction; void optionIds; void setBattlefieldCard; void addRunes; void zone;
