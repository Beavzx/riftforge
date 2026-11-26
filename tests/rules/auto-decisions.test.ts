// AUTO-AUDIT: property tests for decisions the engine makes on a player's behalf (docs/auto-decisions.md).
//
// Auto-pay: random small resource states (runes of several domains, ready/exhausted, floating pool incl. universal and
// restricted resources, Add sources: Seals, Energy Conduit, Gold, Lux) x random costs (energy + single-domain, multi-domain
// [C] and [A] power) x purposes. Every legal payment (each rune: nothing / exhaust / recycle / exhaust+recycle, each Add
// source used or not, every way of spending the pool) is enumerated in an abstract model, and the engine's actual result
// (executePayment of autoPay's plan on a clone) must not be strictly dominated by any of them.
//
// Dominance ("Y is at least as good as X"): Y has at least as many runes in play of every domain, every Add-source object
// X still has, and every cost (energy 0..N + up to N power symbols of any relevant domain/[A], for each purpose) that X
// could still pay this phase, Y can too (brute-force affordability). "Strictly" = at least as good and not vice versa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../fixtures/helpers.ts';
import { fullDb } from '../fixtures/cards.ts';
import { autoPay, addSources, executePayment, validatePlan, type ResolvedCost, type Purpose, type PowerReq } from '../../src/engine/payment.ts';
import { place } from '../../src/engine/testkit.ts';
import type { CardDef, Decision, Domain, GameState, ObjId, PaymentPlan } from '../../src/engine/types.ts';
import { applyAction } from '../../src/engine/game.ts';
import { ask, beginRun, validateAnswer, Suspend } from '../../src/engine/ask.ts';
import { readFileSync } from 'node:fs';
import '../../src/cards/scripts/index.ts';

type Dom = Domain | 'any';
interface PU { dom: Dom; only?: string }
interface AbsAdd { key: string; energy: number; power: Dom[]; only?: string; avail: boolean; exists: boolean; killSelf: boolean; unit?: boolean }
interface AbsRune { id: ObjId; dom: Dom; ready: boolean; inPlay: boolean }
interface Abs { runes: AbsRune[]; adds: AbsAdd[]; eU: number; eR: Record<string, number>; pw: PU[] }

const DOMS: Domain[] = ['Fury', 'Calm', 'Mind'];
const RUNE: Record<string, string> = { Fury: 't-rune-fury', Calm: 't-rune-calm', Mind: 't-rune-mind' };
const ADD_CARDS = [
  { id: 'ogn-040-298', name: 'Seal of Rage', base: true },     // [T]: Add [C] (Fury)
  { id: 'ogn-081-298', name: 'Seal of Focus', base: true },    // [T]: Add [C] (Calm)
  { id: 'ogn-098-298', name: 'Energy Conduit', base: true },   // [T]: Add [1]
  { id: 'unl-t05', name: 'Gold', base: true, token: true },    // Kill this, [T]: Add [A]
  { id: 'ogs-014-024', name: 'Lux', base: true },              // [T]: Add [2], spells only
];

const RAW = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const REAL: CardDef[] = Array.isArray(RAW) ? RAW : Object.values(RAW);
const realDefs = (): Record<string, CardDef> => Object.fromEntries(ADD_CARDS.map(c => [c.id, REAL.find(x => x.id === c.id)!]));

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** same semantics as payment.ts restrictionOk for the restriction values the generator uses */
function usable(only: string | undefined, purpose: Purpose): boolean {
  if (!only) return true;
  return only.split('|').some(o => o === 'spell' ? purpose === 'spell' : o === 'unit' ? purpose === 'unit' : o === 'gear' ? purpose === 'gear'
    : o === 'unitOrGear' ? purpose === 'unit' || purpose === 'gear' : o === 'ability' ? /ability/i.test(purpose) : true);
}
const fits = (req: PowerReq, d: Dom) => d === 'any' || req === 'any' || req.includes(d);

/** all injective assignments of reqs to units; returns the sets of unit indices used (deduped) */
function assignments(reqs: PowerReq[], units: PU[], limit = 400): number[][] {
  const out: number[][] = []; const seen = new Set<string>();
  const used: boolean[] = new Array(units.length).fill(false); const pick: number[] = [];
  const rec = (i: number) => {
    if (out.length >= limit) return;
    if (i === reqs.length) { const k = [...pick].sort((a, b) => a - b); const key = k.map(j => units[j].dom + '/' + (units[j].only ?? '')).join(','); if (!seen.has(key)) { seen.add(key); out.push(k); } return; }
    for (let j = 0; j < units.length; j++) if (!used[j] && fits(reqs[i], units[j].dom)) { used[j] = true; pick.push(j); rec(i + 1); pick.pop(); used[j] = false; }
  };
  rec(0);
  return out;
}
function canMatch(reqs: PowerReq[], units: Dom[]): boolean {
  const owner = new Array(units.length).fill(-1);
  const tryA = (ri: number, seen: boolean[]): boolean => {
    for (let u = 0; u < units.length; u++) {
      if (seen[u] || !fits(reqs[ri], units[u])) continue;
      seen[u] = true;
      if (owner[u] === -1 || tryA(owner[u], seen)) { owner[u] = ri; return true; }
    }
    return false;
  };
  for (let i = 0; i < reqs.length; i++) if (!tryA(i, new Array(units.length).fill(false))) return false;
  return true;
}

const keyOf = (a: Abs) => JSON.stringify([a.runes.map(r => (r.inPlay ? (r.ready ? 'R' : 'E') : '-')).join(''), a.adds.map(x => (x.exists ? (x.avail ? 'A' : 'U') : '-')).join(''),
  a.eU, Object.entries(a.eR).filter(([, n]) => n).sort(), a.pw.map(p => p.dom + '/' + (p.only ?? '')).sort()]);

/** every resource state reachable by a legal payment of `cost` from `s` */
function outcomes(s: Abs, cost: ResolvedCost, purpose: Purpose): Map<string, Abs> {
  const res = new Map<string, Abs>();
  const ropts = s.runes.map(r => (!r.inPlay ? ['-'] : r.ready ? ['-', 'E', 'R', 'ER'] : ['-', 'R']));
  const nAdd = s.adds.length;
  const rec = (i: number, choice: string[]) => {
    if (i < ropts.length) { for (const o of ropts[i]) { choice.push(o); rec(i + 1, choice); choice.pop(); } return; }
    for (let m = 0; m < 1 << nAdd; m++) {
      let ok = true;
      for (let k = 0; k < nAdd; k++) if (m & (1 << k) && !s.adds[k].avail) ok = false;
      if (!ok) continue;
      // produced resources
      let eU = s.eU; const eR = { ...s.eR }; const pw: PU[] = s.pw.map(p => ({ ...p }));
      const runes = s.runes.map(r => ({ ...r })); const adds = s.adds.map(a => ({ ...a }));
      choice.forEach((c, j) => { if (c.includes('E')) { runes[j].ready = false; eU++; } if (c.includes('R')) { runes[j].inPlay = false; pw.push({ dom: runes[j].dom }); } });
      for (let k = 0; k < nAdd; k++) if (m & (1 << k)) {
        const a = adds[k]; a.avail = false; if (a.killSelf) a.exists = false;
        if (a.energy) { if (a.only) eR[a.only] = (eR[a.only] ?? 0) + a.energy; else eU += a.energy; }
        for (const d of a.power) pw.push({ dom: d, only: a.only });
      }
      // energy: restricted usable first (dominant: unrestricted energy can do everything restricted energy can)
      let need = cost.energy;
      for (const o of Object.keys(eR)) if (usable(o, purpose)) { const t = Math.min(need, eR[o]); eR[o] -= t; need -= t; }
      if (need > eU) continue;
      eU -= need;
      const units = pw.map((p, idx) => ({ p, idx })).filter(x => usable(x.p.only, purpose));
      for (const asg of assignments(cost.power, units.map(u => u.p))) {
        const usedIdx = new Set(asg.map(j => units[j].idx));
        const o: Abs = { runes, adds, eU, eR: { ...eR }, pw: pw.filter((_, idx) => !usedIdx.has(idx)) };
        res.set(keyOf(o), o);
      }
    }
  };
  rec(0, []);
  return res;
}

interface Probe { energy: number; power: PowerReq[]; purpose: Purpose }
function probesFor(s: Abs): Probe[] {
  const doms = new Set<Dom>(['any']);
  for (const r of s.runes) doms.add(r.dom);
  for (const p of s.pw) doms.add(p.dom);
  for (const a of s.adds) for (const d of a.power) doms.add(d);
  const reqs: PowerReq[] = [...doms].map(d => (d === 'any' ? 'any' : [d as Domain]));
  const multis: PowerReq[][] = [[]];
  // up to one more power symbol than the state could ever produce, so no capability difference is saturated away
  const maxP = Math.min(6, s.runes.length + s.pw.length + s.adds.reduce((a, b) => a + b.power.length, 0) + 1);
  const grow = (cur: PowerReq[], from: number) => { if (cur.length === maxP) return; for (let i = from; i < reqs.length; i++) { const n = [...cur, reqs[i]]; multis.push(n); grow(n, i); } };
  grow([], 0);
  const maxE = s.eU + Object.values(s.eR).reduce((a, b) => a + b, 0) + s.runes.length + s.adds.reduce((a, b) => a + b.energy, 0) + 1;
  const out: Probe[] = [];
  for (const purpose of ['unit', 'spell'] as Purpose[]) for (let e = 0; e <= maxE; e++) for (const pw of multis) out.push({ energy: e, power: pw, purpose });
  return out;
}
function afford(s: Abs, pr: Probe): boolean {
  const adds = s.adds.filter(a => a.avail && usable(a.only, pr.purpose));
  for (let m = 0; m < 1 << adds.length; m++) {
    let e = s.eU + s.runes.filter(r => r.inPlay && r.ready).length;
    for (const [o, n] of Object.entries(s.eR)) if (usable(o, pr.purpose)) e += n;
    const units: Dom[] = [...s.pw.filter(p => usable(p.only, pr.purpose)).map(p => p.dom), ...s.runes.filter(r => r.inPlay).map(r => r.dom)];
    adds.forEach((a, k) => { if (m & (1 << k)) { e += a.energy; units.push(...a.power); } });
    if (e >= pr.energy && canMatch(pr.power, units)) return true;
  }
  return false;
}
/** what can still be paid now (pool included) and later this turn / on the opponent's turn (the pool empties, CR 316.1) */
function sig(s: Abs, probes: Probe[]): boolean[] {
  const later: Abs = { ...s, eU: 0, eR: {}, pw: [] };
  return [...probes.map(p => afford(s, p)), ...probes.map(p => afford(later, p))];
}
/** y at least as good as x */
function geq(y: Abs, ys: boolean[], x: Abs, xs: boolean[]): boolean {
  for (const d of [...DOMS, 'any' as Dom]) if (y.runes.filter(r => r.inPlay && r.dom === d).length < x.runes.filter(r => r.inPlay && r.dom === d).length) return false;
  for (let k = 0; k < x.adds.length; k++) if (x.adds[k].exists && !y.adds[k].exists) return false;
  // a unit's readiness matters beyond its Add ability (moving, attacking): kept as its own resource
  for (let k = 0; k < x.adds.length; k++) if (x.adds[k].unit && x.adds[k].avail && !y.adds[k].avail) return false;
  for (let i = 0; i < xs.length; i++) if (xs[i] && !ys[i]) return false;
  return true;
}

function abstractOf(g: GameState, runeIds: ObjId[], adds: { key: string; obj: ObjId; energy: number; power: Dom[]; only?: string; killSelf: boolean; unit?: boolean }[]): Abs {
  const pl = g.players[0];
  const eR: Record<string, number> = {}; const pw: PU[] = [];
  for (const r of pl.poolRestricted) {
    if (r.kind === 'energy') eR[r.only] = (eR[r.only] ?? 0) + r.amount;
    else for (let i = 0; i < r.amount; i++) pw.push({ dom: (r.domain ?? 'any') as Dom, only: r.only });
  }
  for (const [d, n] of Object.entries(pl.pool.power)) for (let i = 0; i < (n ?? 0); i++) pw.push({ dom: d === 'Colorless' ? 'any' : (d as Dom) });
  return {
    runes: runeIds.map(id => ({ id, dom: g.cards[g.objects[id].cardId].domains[0] as Dom, ready: !g.objects[id]?.exhausted, inPlay: pl.runesInPlay.includes(id) })),
    adds: adds.map(a => { const o = g.objects[a.obj]; const exists = !!o && (o.zone === 'base' || o.zone === 'battlefield'); return { key: a.key, energy: a.energy, power: a.power, only: a.only, killSelf: a.killSelf, unit: a.unit, exists, avail: exists && !o.exhausted }; }),
    eU: pl.pool.energy, eR, pw,
  };
}

const NAMES: Record<string, string> = {};
const showAbs = (a: Abs) => `runes[${a.runes.map(r => `${r.dom[0]}${r.inPlay ? (r.ready ? '' : '(exh)') : '(gone)'}`).join(' ')}] adds[${a.adds.map(x => `${NAMES[x.key] ?? x.key}${x.exists ? (x.avail ? '' : '(used)') : '(gone)'}`).join(' ')}] pool{E${a.eU}${Object.entries(a.eR).filter(([, n]) => n).map(([o, n]) => ` E${n}<${o}>`).join('')} P[${a.pw.map(p => p.dom + (p.only ? `<${p.only}>` : '')).join(',')}]}`;
const showCost = (c: ResolvedCost) => `${c.energy}${c.power.map(p => (p === 'any' ? '[A]' : `[${p.join('/')}]`)).join('')}`;

interface Scenario { g: GameState; runeIds: ObjId[]; adds: { key: string; obj: ObjId; energy: number; power: Dom[]; only?: string; killSelf: boolean; unit?: boolean; name: string }[]; cost: ResolvedCost; purpose: Purpose; desc: string }

function scenario(seed: number): Scenario {
  const r = rng(seed * 7919 + 13);
  const g = newGame({ db: fullDb() });
  g.cards = { ...g.cards, ...realDefs() };
  const pl = g.players[0];
  for (const id of [...pl.runesInPlay]) { pl.runesInPlay.splice(pl.runesInPlay.indexOf(id), 1); delete g.objects[id]; }
  pl.pool = { energy: 0, power: {} }; pl.poolRestricted = [];
  const nR = Math.floor(r() * 5);                         // 0..4 runes
  const runeIds: ObjId[] = [];
  for (let i = 0; i < nR; i++) runeIds.push(place(g, 0, RUNE[DOMS[Math.floor(r() * (r() < 0.5 ? 2 : 3))]], 'runes', { ready: r() > 0.35 }));
  // pool
  if (r() < 0.3) pl.pool.energy = 1 + Math.floor(r() * 2);
  if (r() < 0.35) { const d = (r() < 0.4 ? 'Colorless' : DOMS[Math.floor(r() * 2)]) as Domain; pl.pool.power[d] = (pl.pool.power[d] ?? 0) + 1; }
  if (r() < 0.2) { const d = (r() < 0.5 ? 'Colorless' : 'Fury') as Domain; pl.pool.power[d] = (pl.pool.power[d] ?? 0) + 1; }
  if (r() < 0.12) pl.poolRestricted.push({ kind: 'power', domain: 'any', amount: 1, only: 'spell' });
  if (r() < 0.12) pl.poolRestricted.push({ kind: 'energy', amount: 1, only: 'unit' });
  // Add sources
  const nA = r() < 0.4 ? 0 : r() < 0.75 ? 1 : 2;
  const placed: { obj: ObjId; name: string; ready: boolean }[] = [];
  for (let i = 0; i < nA; i++) { const c = ADD_CARDS[Math.floor(r() * ADD_CARDS.length)]; placed.push({ obj: place(g, 0, c.id, 'base', { token: c.token }), name: c.name, ready: r() > 0.2 }); }
  const srcs = addSources(g, 0);
  const adds = placed.flatMap(p => srcs.filter(s => s.obj === p.obj).map(s => ({
    key: s.key, obj: s.obj, energy: s.energy, power: s.power as Dom[], only: s.only, name: p.name,
    killSelf: (s.ab.cost.extra ?? []).some(x => x.self || /kill/i.test(x.label ?? '')), unit: g.cards[g.objects[s.obj].cardId].type === 'Unit',
  })));
  for (const p of placed) g.objects[p.obj].exhausted = !p.ready;
  for (const a of adds) NAMES[a.key] = a.name;
  // cost
  const reqPool: PowerReq[] = [['Fury'], ['Calm'], ['Mind'], 'any', ['Fury', 'Calm']];
  const nP = Math.floor(r() * 3.2);
  const power: PowerReq[] = [];
  for (let i = 0; i < nP; i++) power.push(reqPool[Math.floor(r() * reqPool.length)]);
  const energy = r() < 0.3 ? 0 : Math.floor(r() * 4);
  const purpose = (['unit', 'spell', 'gear'] as Purpose[])[Math.floor(r() * 3)];
  const cost: ResolvedCost = { energy, power };
  return { g, runeIds, adds, cost, purpose, desc: `seed ${seed}: pay ${showCost(cost)} for a ${purpose}` };
}

interface Finding { seed: number; desc: string; start: string; engine: string; better: string }

function check(seed: number): { kind: 'ok' | 'unpayable' | 'dominated' | 'incomplete' | 'unsound' | 'mismatch'; front: number; finding?: Finding; frontDescs?: string[] } {
  const sc = scenario(seed);
  const start = abstractOf(sc.g, sc.runeIds, sc.adds);
  const all = outcomes(start, sc.cost, sc.purpose);
  const plan = autoPay(sc.g, 0, sc.cost, sc.purpose);
  if (!plan) return { kind: all.size ? 'incomplete' : 'unpayable', front: 0, finding: all.size ? { seed, desc: sc.desc, start: showAbs(start), engine: 'autoPay: no plan', better: showAbs([...all.values()][0]) } : undefined };
  if (validatePlan(sc.g, 0, sc.cost, sc.purpose, plan.plan)) return { kind: 'unsound', front: 0, finding: { seed, desc: sc.desc, start: showAbs(start), engine: 'autoPay plan rejected by validatePlan: ' + validatePlan(sc.g, 0, sc.cost, sc.purpose, plan.plan), better: '' } };
  const g2 = structuredClone(sc.g);
  executePayment(g2, 0, sc.cost, sc.purpose, plan.plan);
  const eng = abstractOf(g2, sc.runeIds, sc.adds);
  if (!all.has(keyOf(eng))) return { kind: 'mismatch', front: 0, finding: { seed, desc: sc.desc, start: showAbs(start), engine: showAbs(eng), better: '(engine result not reachable in the model)' } };
  const probes = probesFor(start);
  const outs = [...all.values()];
  const sigs = outs.map(o => sig(o, probes));
  const es = sig(eng, probes);
  // Pareto front (distinct, non-dominated)
  const front: number[] = [];
  outs.forEach((o, i) => {
    if (outs.some((y, j) => j !== i && geq(y, sigs[j], o, sigs[i]) && !geq(o, sigs[i], y, sigs[j]))) return;
    if (front.some(f => geq(outs[f], sigs[f], o, sigs[i]) && geq(o, sigs[i], outs[f], sigs[f]))) return;   // equivalent to one already listed
    front.push(i);
  });
  // "tight" alternatives: nothing produced is left floating (except the [1] of a rune exhausted and recycled, #65) —
  // the choices a player would actually weigh. Distinct structural results among them = a real choice (ASK / override).
  const startPw = start.pw.length;
  const tight = front.filter(i => { const o = outs[i]; const er = o.runes.filter((r, k) => !r.inPlay && start.runes[k].ready).length; return o.pw.length <= startPw && o.eU <= start.eU + er; });
  const struct = (o: Abs) => JSON.stringify([DOMS.map(d => o.runes.filter(r => r.inPlay && r.dom === d).length), o.adds.map(a => (a.exists ? (a.avail ? 2 : 1) : 0))]);
  const choices = new Set(tight.map(i => struct(outs[i]))).size;
  const better = outs.findIndex((y, j) => geq(y, sigs[j], eng, es) && !geq(eng, es, y, sigs[j]));
  if (better >= 0) return { kind: 'dominated', front: choices, frontDescs: tight.map(i => showAbs(outs[i])), finding: { seed, desc: sc.desc, start: showAbs(start), engine: showAbs(eng), better: showAbs(outs[better]) } };
  return { kind: 'ok', front: choices, frontDescs: choices > 1 ? [`${sc.desc}: start ${showAbs(start)}`, ...tight.map(i => showAbs(outs[i]))] : undefined };
}

const N = Number(process.env.AUTO_AUDIT_N ?? 120);
let RUN: { bad: Finding[]; broken: Finding[]; counts: Record<string, number>; multi: number; examples: string[] } | null = null;
function runAll() {
  if (RUN) return RUN;
  const bad: Finding[] = []; const broken: Finding[] = []; const counts: Record<string, number> = {}; let multi = 0; const examples: string[] = [];
  for (let s = 1; s <= N; s++) {
    const r = check(s);
    counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    if (r.finding) (r.kind === 'dominated' ? bad : broken).push(r.finding);
    if (r.front > 1) { multi++; if (examples.length < Number(process.env.AUTO_AUDIT_EX ?? 4)) examples.push(`(${r.front} real choices) ${r.frontDescs!.join('  |  ')}`); }
  }
  return (RUN = { bad, broken, counts, multi, examples });
}
const showF = (fs: Finding[]) => fs.slice(0, Number(process.env.AUTO_AUDIT_SHOW ?? 8)).map(b => `${b.desc}\n    start : ${b.start}\n    engine: ${b.engine}\n    better: ${b.better}`).join('\n');

test(`AUTO-AUDIT auto-pay: complete (finds a payment whenever one exists), sound (validatePlan accepts it), model matches the engine (${N} random states)`, t => {
  const r = runAll();
  t.diagnostic(`results: ${JSON.stringify(r.counts)}; states where several tight, non-dominated payments differ (ASK / override): ${r.multi}`);
  for (const e of r.examples) t.diagnostic(e);
  if (r.broken.length) assert.fail(`${r.broken.length} auto-pay failures:\n${showF(r.broken)}`);
});

// Known counterexample classes (docs/auto-decisions.md AP-1..AP-3), handed to ENGINE-6 (owner of src/engine/payment.ts):
// AP-1 a same-domain Seal (exhaust-only Add) is left ready while a rune is recycled; AP-2 Add sources are activated for
// nothing (all of the first k sorted sources are used, incl. ones whose resources can't pay this cost); AP-3 the pool's
// universal power is spent on a single-domain symbol while matching power of that domain floats. Fixed by ENGINE-6.
test(`AUTO-AUDIT auto-pay: never strictly dominated by another legal payment (${N} random states)`, () => {
  const r = runAll();
  if (r.bad.length) assert.fail(`${r.bad.length} auto-pay counterexamples (first ${Math.min(8, r.bad.length)}):\n${showF(r.bad)}`);
});

// ---- minimal reproductions of AP-1..AP-3 (fixed by ENGINE-6) ----
function bare(): GameState {
  const g = newGame({ db: fullDb() });
  g.cards = { ...g.cards, ...realDefs() };
  const pl = g.players[0];
  for (const id of [...pl.runesInPlay]) { pl.runesInPlay.splice(pl.runesInPlay.indexOf(id), 1); delete g.objects[id]; }
  pl.pool = { energy: 0, power: {} }; pl.poolRestricted = [];
  return g;
}

test('AP-1: [Fury] with an exhausted Fury rune and a ready Seal of Rage: exhaust the Seal, keep the rune', () => {
  const g = bare();
  const rune = place(g, 0, RUNE.Fury, 'runes', { ready: false });
  const seal = place(g, 0, 'ogn-040-298', 'base');
  const plan = autoPay(g, 0, { energy: 0, power: [['Fury']] }, 'gear')!;
  assert.ok(plan);
  assert.deepEqual(plan.plan.recycle, [], `recycled ${plan.plan.recycle.join(',')} (rune ${rune}) instead of exhausting the Seal`);
  assert.ok(((plan.plan.other?.abilities as string[] | undefined) ?? []).some(k => k.startsWith(seal + ':')));
});

test('AP-1b: power-only cost played first in a turn: a ready same-domain Seal beats exhausting+recycling a ready rune', () => {
  const g = bare();
  place(g, 0, RUNE.Fury, 'runes'); place(g, 0, RUNE.Fury, 'runes');
  place(g, 0, 'ogn-040-298', 'base');
  const plan = autoPay(g, 0, { energy: 0, power: [['Fury']] }, 'gear')!;
  assert.deepEqual(plan.plan.recycle, []);
});

test('AP-2: Add sources that cannot help are not activated (Lux\'s spell-only energy for a unit)', () => {
  const g = bare();
  place(g, 0, RUNE.Fury, 'runes');
  const lux = place(g, 0, 'ogs-014-024', 'base');
  place(g, 0, 'ogn-098-298', 'base');      // Energy Conduit
  const plan = autoPay(g, 0, { energy: 2, power: [] }, 'unit')!;
  assert.ok(plan);
  assert.ok(!((plan.plan.other?.abilities as string[] | undefined) ?? []).some(k => k.startsWith(lux + ':')), 'Lux (a unit) was exhausted for energy it cannot spend on a unit');
});

test('AP-2b: an Add source whose power does not fit is not activated (Seal of Focus for [Fury])', () => {
  const g = bare();
  const focus = place(g, 0, 'ogn-081-298', 'base');
  place(g, 0, 'ogn-040-298', 'base');
  const plan = autoPay(g, 0, { energy: 0, power: [['Fury']] }, 'gear')!;
  assert.ok(plan);
  assert.ok(!((plan.plan.other?.abilities as string[] | undefined) ?? []).some(k => k.startsWith(focus + ':')), 'Seal of Focus exhausted for nothing');
});

test('AP-3: paying [Fury] from a pool of [A] + [Fury] spends the Fury and keeps the universal [A]', () => {
  const g = bare();
  g.players[0].pool.power = { Colorless: 1, Fury: 1 };
  const plan = autoPay(g, 0, { energy: 0, power: [['Fury']] }, 'spell')!;
  executePayment(g, 0, { energy: 0, power: [['Fury']] }, 'spell', plan.plan);
  assert.deepEqual(g.players[0].pool.power, { Colorless: 1 });
});

test('rules-decisions #65 (user report): a ready rune recycled for a power-only cost is exhausted for its [1] first', () => {
  const g = bare();
  const r1 = place(g, 0, RUNE.Fury, 'runes');
  const plan = autoPay(g, 0, { energy: 0, power: [['Fury']] }, 'gear')!;
  assert.deepEqual(plan.plan.recycle, [r1]);
  assert.deepEqual(plan.plan.exhaust, [r1]);
  executePayment(g, 0, { energy: 0, power: [['Fury']] }, 'gear', plan.plan);
  assert.equal(g.players[0].pool.energy, 1);
});

// ---- ASK: the manual payment path (GameSetup.manualPay, reachable from the UI's "Choose runes when paying" preference) ----
test('manualPay: the payment Decision offers Auto-pay + the suggested plan, and accepts a plan that uses a Seal instead of a rune', () => {
  const g0 = bare();
  g0.ex.manualPay[0] = true;
  const rune = place(g0, 0, RUNE.Fury, 'runes', { ready: false });
  const seal = place(g0, 0, 'ogn-040-298', 'base');
  const card = place(g0, 0, 'ogn-040-298', 'hand');          // a second Seal of Rage: cost [0][Fury]
  let g = applyAction(g0, { type: 'playCard', player: 0, obj: card }).state;
  assert.equal(g.pending?.kind, 'payment');
  assert.deepEqual(g.pending!.options!.map(o => o.id), ['auto', 'manual']);
  const sug = g.pending!.data!.suggested as PaymentPlan;
  assert.ok(sug, 'suggested plan for the UI to pre-fill');
  const key = addSources(g, 0, card).find(a => a.obj === seal)!.key;
  g = applyAction(g, { type: 'choose', player: 0, optionIds: ['manual'], data: { exhaust: [], recycle: [], other: { abilities: [key], addDomains: {} } } satisfies PaymentPlan }).state;
  assert.notEqual(g.pending?.kind, 'payment');
  assert.ok(g.players[0].runesInPlay.includes(rune), 'the rune stayed in play');
  assert.equal(g.objects[seal].exhausted, true, 'the Seal paid the [Fury]');
});

test('manualPay: a manual plan that recycles a ready rune and also exhausts it keeps the [1] (UI builds plans this way)', () => {
  const g0 = bare();
  g0.ex.manualPay[0] = true;
  const r1 = place(g0, 0, RUNE.Fury, 'runes');
  const card = place(g0, 0, 'ogn-040-298', 'hand');
  let g = applyAction(g0, { type: 'playCard', player: 0, obj: card }).state;
  g = applyAction(g, { type: 'choose', player: 0, optionIds: ['manual'], data: { exhaust: [r1], recycle: [r1] } satisfies PaymentPlan }).state;
  assert.equal(g.players[0].pool.energy, 1);
});

// ---- ask(): the engine auto-answers an in-step decision only when exactly one answer is legal ----
test('ask(): every auto-answer is the only answer validateAnswer accepts (exhaustive over small decisions)', () => {
  const g = bare();
  const kinds: Decision['kind'][] = ['chooseTargets', 'chooseCards', 'chooseMode', 'optional', 'chooseDestination', 'orderTriggers', 'chooseNumber'];
  let auto = 0, asked = 0;
  for (const kind of kinds) for (let n = 0; n <= 4; n++) for (let min = 0; min <= 4; min++) for (let max = 0; max <= 4; max++) {
    const options = Array.from({ length: n }, (_, i) => ({ id: 'o' + i, label: 'o' + i }));
    const d: Decision = { kind, player: 0, prompt: 'test', options, min, max };
    beginRun([], 0);
    let a;
    try { a = ask(g, structuredClone(d)); } catch (e) { if (e instanceof Suspend) { asked++; continue; } throw e; }
    auto++;
    // all subsets that validate
    const valid: string[][] = [];
    for (let m = 0; m < 1 << n; m++) {
      const ids = options.filter((_, i) => m & (1 << i)).map(o => o.id);
      if (validateAnswer(g, { ...d, inStep: true }, { type: 'choose', player: 0, optionIds: ids }) === null) valid.push(ids);
    }
    assert.equal(valid.length, 1, `${kind} n=${n} min=${min} max=${max}: auto-answered ${JSON.stringify(a)} but ${valid.length} answers are legal`);
    assert.deepEqual(valid[0], (a as { optionIds: string[] }).optionIds);
  }
  assert.ok(auto > 0 && asked > 0);
});
