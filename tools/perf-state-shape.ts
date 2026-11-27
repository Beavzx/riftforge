// PERF: what kinds of values live in GameState (the part cloneState deep-copies)? A hand-written clone must match
// structuredClone on everything found here. Reports non-plain types, undefined-valued keys, sparse arrays, extra keys
// on arrays, and objects reachable by two paths (structuredClone keeps the sharing; a naive clone would not).
import { createGame, applyAction } from '../src/engine/index.ts';
import type { GameState } from '../src/engine/types.ts';
import { makeSpec, setupOf, playFuzzGame, NO_CHECKS } from './fuzz-lib.ts';

const found = new Map<string, number>();
const note = (k: string) => found.set(k, (found.get(k) ?? 0) + 1);
function walk(x: unknown, path: string, seen: Map<object, string>) {
  if (x === null || typeof x !== 'object') {
    if (typeof x === 'function') note(`function at ${path.replace(/\[\d+\]/g, '[]').replace(/\.[a-z]?\d+[a-z0-9_]*/gi, '.*')}`);
    if (typeof x === 'bigint' || typeof x === 'symbol') note(`${typeof x}`);
    return;
  }
  const generic = path.replace(/\[\d+\]/g, '[]').replace(/\.(o|c|u|t)?\d+[A-Za-z0-9_]*/g, '.<id>');
  if (seen.has(x)) { note(`SHARED ${generic} (also ${seen.get(x)!.replace(/\[\d+\]/g, '[]')})`); return; }
  seen.set(x, path);
  const proto = Object.getPrototypeOf(x);
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) if (!(i in x)) { note(`SPARSE array ${generic}`); break; }
    for (const k of Object.keys(x)) if (!/^\d+$/.test(k)) note(`array extra key ${generic}.${k}`);
    x.forEach((v, i) => walk(v, `${path}[${i}]`, seen));
    return;
  }
  if (proto !== Object.prototype && proto !== null) { note(`TYPE ${proto?.constructor?.name} at ${generic}`); if (x instanceof Map || x instanceof Set) return; }
  if (proto === null) note(`null-proto object ${generic}`);
  for (const k of Object.keys(x)) {
    const v = (x as Record<string, unknown>)[k];
    if (v === undefined) note(`undefined value ${generic}.${k}`);
    walk(v, `${path}.${k}`, seen);
  }
  if (Object.getOwnPropertySymbols(x).length) note(`symbol keys ${generic}`);
}
function cloned(s: GameState) {
  const { cards: _c, ex, log: _l, ...rest } = s;
  const { unit: _u, lastEvents: _e, ...exRest } = ex;
  return { ...rest, ex: exRest };
}
const N = Number(process.argv[2] ?? 200);
let states = 0;
for (let i = 0; i < N; i++) {
  const spec = makeSpec(70000 + i);
  const fr = playFuzzGame(spec, NO_CHECKS);
  let g = createGame(setupOf(spec));
  walk(cloned(g), '$', new Map()); states++;
  for (const a of fr.actions) {
    try { g = applyAction(g, a).state; } catch { break; }
    walk(cloned(g), '$', new Map()); states++;
    if (g.ex.unit) walk(cloned(g.ex.unit.base), '$unit', new Map());
  }
}
console.log(`${N} games, ${states} states`);
for (const [k, v] of [...found].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(8), k);
