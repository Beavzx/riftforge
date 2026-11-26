// Profiles the per-action cost of the host's work in online play: applyAction, getView x2, packView + JSON.
// npx tsx tests/ui/profile-engine.ts [games=3]
import { readFileSync } from 'node:fs';
import * as Eng from '../../src/ui/engine';
import { buildDb } from '../../src/ui/cards';
import { starterDecks } from '../../src/ui/decks';
import { packView } from '../../src/net/protocol';

const db = buildDb(JSON.parse(readFileSync('data/cards.json', 'utf8')));
const decks = starterDecks(db, 39);
const games = Number(process.argv[2] ?? 3);
const t = { apply: [] as number[], view: [] as number[], pack: [] as number[], bot: [] as number[], bytes: [] as number[], legal: [] as number[] };
const now = () => performance.now();
for (let g = 0; g < games; g++) {
  let s = Eng.createGame({ seed: 100 + g, cardDb: db.byId, players: [{ name: 'A', deck: decks[g % decks.length].deck }, { name: 'B', deck: decks[(g + 1) % decks.length].deck }] });
  for (let i = 0; i < 3000 && s.winner === null; i++) {
    const p = Eng.getPending(s); if (!p) break;
    let t0 = now(); const a = Eng.botAction(s, p.player); t.bot.push(now() - t0);
    if (!a) break;
    t0 = now(); s = Eng.applyAction(s, a).state; t.apply.push(now() - t0);
    t0 = now(); const v0 = Eng.getView(s, 0); const v1 = Eng.getView(s, 1); t.view.push(now() - t0);
    t.legal.push(v0.legal.length + v1.legal.length);
    t0 = now(); const j = JSON.stringify(packView(v1)); t.pack.push(now() - t0); t.bytes.push(j.length);
  }
  console.log(`game ${g}: ${t.apply.length} actions so far, winner ${s.winner}, turn ${s.turn}`);
}
const st = (a: number[]) => { const b = [...a].sort((x, y) => x - y); const q = (f: number) => b[Math.min(b.length - 1, Math.floor(f * b.length))]; return `mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)} p50 ${q(.5).toFixed(2)} p95 ${q(.95).toFixed(2)} max ${b[b.length - 1].toFixed(2)}`; };
console.log('actions', t.apply.length);
console.log('applyAction ms   ', st(t.apply));
console.log('getView x2 ms    ', st(t.view));
console.log('packView+JSON ms ', st(t.pack));
console.log('bot choose ms    ', st(t.bot));
console.log('view JSON KB     ', st(t.bytes.map(b => b / 1024)));
