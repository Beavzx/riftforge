// Where does time go in online play? Plays a full host+guest game over the fake room (like the smoke test) and
// measures: guest action round trip, host->guest view propagation, board render time, and message counts.
// DROP=0.15 npx tsx tests/ui/profile-online.ts
import { chromium, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { serveDist } from '../fixtures/serve';
import { driveSeat } from '../fixtures/ui-driver';

const drop = Number(process.env.DROP ?? 0.15);
const FAKE_ROOM = readFileSync(new URL('../fixtures/fake-room.js', import.meta.url), 'utf8');
const srv = await serveDist('dist');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
await ctx.addInitScript(FAKE_ROOM);
await ctx.addInitScript(d => { (window as any).__rfDrop = d; }, drop);
const host = await ctx.newPage(); const guest = await ctx.newPage();
await host.goto(srv.url); await guest.goto(srv.url);
await host.click('[data-testid="create-room"]');
const code = (await host.locator('[data-testid="room-code"]').textContent())!.trim();
await guest.fill('[data-testid="join-code"]', code); await guest.click('[data-testid="join-room"]');
await guest.waitForFunction(() => (globalThis as any).__riftforge?.lobby?.state?.joined === true, null, { timeout: 30000 });
await guest.click('[data-testid="ready"]'); await host.click('[data-testid="ready"]');
await host.waitForSelector('[data-testid="start"]:not([disabled])', { timeout: 30000 });
const tStart = Date.now();
await host.click('[data-testid="start"]');
await guest.waitForFunction(() => (globalThis as any).__riftforge?.board?.view, null, { timeout: 30000 });
await host.waitForFunction(() => (globalThis as any).__riftforge?.board?.view, null, { timeout: 30000 });
const instrument = (p: Page, role: string) => p.evaluate(role => {
  const r = (globalThis as any).__riftforge; const w = window as any;
  w.__prof = { render: [] as number[], act: [] as number[], verAt: {} as Record<number, number>, recvAt: {} as Record<number, number> };
  const b = r.board; const orig = b.render.bind(b);
  b.render = () => { const t0 = performance.now(); orig(); w.__prof.render.push(performance.now() - t0); };
  const s = r.session; const oact = s.act.bind(s);
  s.act = async (a: any) => { const t0 = performance.now(); const e = await oact(a); w.__prof.act.push(performance.now() - t0); return e; };
  if (role === 'host') { const oa = s.applyFor.bind(s); s.applyFor = (a: any) => { const e = oa(a); w.__prof.verAt[s.ver] = performance.timeOrigin + performance.now(); return e; }; }
  else s.subscribe(() => { w.__prof.recvAt[s.ver] = performance.timeOrigin + performance.now(); });
  if (role === 'guest') r.session.suggest = () => r.botFromView(r.board.view);
}, role);
await instrument(host, 'host'); await instrument(guest, 'guest');
const [hs, gs] = await Promise.all([driveSeat(host, { timeoutMs: 400_000, advanceMs: 8000 }), driveSeat(guest, { timeoutMs: 400_000, advanceMs: 8000 })]);
const wall = (Date.now() - tStart) / 1000;
const H = await host.evaluate(() => ({ ...(window as any).__prof, sent: (window as any).__rfSent }));
const G = await guest.evaluate(() => ({ ...(window as any).__prof, sent: (window as any).__rfSent, winner: (globalThis as any).__riftforge.board.view.state.winner, actions: (globalThis as any).__riftforge.board.view.state.actionCount }));
const st = (a: number[]) => { if (!a.length) return 'n/a'; const b = [...a].sort((x, y) => x - y); const q = (f: number) => b[Math.min(b.length - 1, Math.floor(f * b.length))]; return `n ${a.length} mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(0)} p50 ${q(.5).toFixed(0)} p90 ${q(.9).toFixed(0)} max ${b[b.length - 1].toFixed(0)} total ${(a.reduce((x, y) => x + y, 0) / 1000).toFixed(1)}s`; };
const prop: number[] = [];
for (const [ver, at] of Object.entries(H.verAt as Record<string, number>)) { const r = (G.recvAt as Record<string, number>)[ver]; if (r) prop.push(r - at); }
const missed = Object.keys(H.verAt).length - prop.length;
console.log(`drop=${drop} wall ${wall.toFixed(1)}s winner ${G.winner} engine actions ${G.actions}`);
console.log(`driver: host ui ${hs.uiActions} fb ${hs.fallbacks}; guest ui ${gs.uiActions} fb ${gs.fallbacks}`);
console.log('guest act round trip ms ', st(G.act));
console.log('host act (local) ms     ', st(H.act));
console.log('host->guest view ms     ', st(prop), `(${missed} versions never seen individually: superseded)`);
console.log('render host ms          ', st(H.render));
console.log('render guest ms         ', st(G.render));
console.log('messages sent host/guest', H.sent, G.sent);
console.log('guest fallbacks:', gs.errors.slice(0, 12).join('\n'));
console.log('host fallbacks:', hs.errors.slice(0, 6).join('\n'));
await ctx.close(); await browser.close(); await srv.close();
