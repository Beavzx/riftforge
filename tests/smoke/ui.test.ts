// UI smoke tests (playwright, headless Chromium):
//  1. a full game vs the bot where seat 0 is played entirely by clicking the UI;
//  2. a full bot-vs-bot game rendered by the board;
//  3. every Decision kind renders a prompt (gallery);
//  4. online: two pages linked by a fake `room` capability play a full game (host + guest), with dropped messages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { serveDist } from '../fixtures/serve';
import { driveSeat } from '../fixtures/ui-driver';

let browser: Browser; let srv: Awaited<ReturnType<typeof serveDist>>;
const FAKE_ROOM = readFileSync(new URL('../fixtures/fake-room.js', import.meta.url), 'utf8');

before(async () => {
  execSync('npx tsx tools/bundle.ts', { stdio: 'inherit' });
  srv = await serveDist('dist');
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await srv?.close(); });

async function open(hash: string, w = 1280, init?: string): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 800 }, hasTouch: w < 600, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(srv.url + (hash ? '#' + hash : ''));
  return { page, errors };
}

test('full game vs bot, played through the UI', { timeout: 240_000 }, async () => {
  const { page, errors } = await open('autoplay-bot-15');
  await page.waitForFunction(() => (globalThis as any).__riftforge?.board?.view);
  const stats = await driveSeat(page, { timeoutMs: 200_000 });
  const res = await page.evaluate(() => { const v = (globalThis as any).__riftforge.board.view; return { winner: v.state.winner, pts: v.state.players.map((p: any) => p.points), turn: v.state.turn }; });
  console.log('vs bot:', JSON.stringify(res), JSON.stringify(stats.byKind), 'fallbacks', stats.fallbacks, stats.errors.slice(0, 5));
  assert.notEqual(res.winner, null, 'game should finish');
  assert.ok(await page.locator('[data-testid="gameover"]').isVisible());
  assert.ok(stats.uiActions > 10, 'most actions went through the UI');
  assert.ok(stats.fallbacks <= Math.max(2, stats.uiActions * 0.05), `too many fallbacks: ${stats.errors.join('\n')}`);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('bot vs bot completes on the board (phone width)', { timeout: 120_000 }, async () => {
  const { page, errors } = await open('autoplay-botvbot-5', 390);
  await page.waitForSelector('[data-testid="gameover"]', { timeout: 110_000 });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('every Decision kind renders a prompt', { timeout: 120_000 }, async () => {
  const kinds = ['mulligan', 'showdownAction', 'chainResponse', 'chooseTargets', 'chooseMode', 'chooseX', 'optional', 'payment', 'orderTriggers', 'assignDamage', 'chooseBattlefield', 'chooseCards', 'chooseUnitsToMove', 'chooseDestination', 'chooseNumber', 'confirm'];
  for (const k of kinds) {
    const { page, errors } = await open('gallery-' + k, 720);
    await page.waitForSelector(`[data-testid="prompt"][data-kind="${k}"]`, { timeout: 5000 });
    assert.deepEqual(errors, [], k);
    await page.context().close();
  }
});

test('online: host and guest play a full game over a lossy fake room', { timeout: 240_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(FAKE_ROOM);
  await ctx.addInitScript(() => { (window as any).__rfDrop = 0.15; });
  const host = await ctx.newPage(); const guest = await ctx.newPage();
  const errors: string[] = [];
  for (const p of [host, guest]) p.on('pageerror', e => errors.push(e.message));
  await host.goto(srv.url); await guest.goto(srv.url);
  await host.click('[data-testid="create-room"]');
  const code = (await host.locator('[data-testid="room-code"]').textContent())!.trim();
  await guest.fill('[data-testid="join-code"]', code);
  await guest.click('[data-testid="join-room"]');
  await guest.waitForFunction(() => (globalThis as any).__riftforge?.lobby?.state?.joined === true, null, { timeout: 30000 });
  await guest.click('[data-testid="ready"]');
  await host.click('[data-testid="ready"]');
  await host.waitForSelector('[data-testid="start"]:not([disabled])', { timeout: 30000 });
  await host.click('[data-testid="start"]');
  await guest.waitForFunction(() => (globalThis as any).__riftforge?.board?.view, null, { timeout: 30000 });
  // Both seats are driven through the UI; the guest's "suggestion" comes from a bot run on its own view.
  await guest.evaluate(() => { const r = (globalThis as any).__riftforge; r.session.suggest = () => r.botFromView(r.board.view); });
  const [hs, gs] = await Promise.all([driveSeat(host, { timeoutMs: 220_000, advanceMs: 6000 }), driveSeat(guest, { timeoutMs: 220_000, advanceMs: 6000 })]);
  const hv = await host.evaluate(() => (globalThis as any).__riftforge.board.view.state.winner);
  const gv = await guest.evaluate(() => (globalThis as any).__riftforge.board.view.state.winner);
  console.log('online host', JSON.stringify(hs.byKind), hs.fallbacks, 'guest', JSON.stringify(gs.byKind), gs.fallbacks, gs.errors.slice(0, 3));
  assert.notEqual(hv, null); assert.equal(hv, gv, 'both sides agree on the winner');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('online: guest reload rejoins its seat; host reload resumes the game', { timeout: 120_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(FAKE_ROOM);
  const host = await ctx.newPage(); const guest = await ctx.newPage();
  const errors: string[] = [];
  for (const p of [host, guest]) p.on('pageerror', e => errors.push(e.message));
  await host.goto(srv.url); await guest.goto(srv.url);
  await host.click('[data-testid="create-room"]');
  const code = (await host.locator('[data-testid="room-code"]').textContent())!.trim();
  await guest.fill('[data-testid="join-code"]', code); await guest.click('[data-testid="join-room"]');
  await guest.waitForFunction(() => (globalThis as any).__riftforge?.lobby?.state?.joined === true, null, { timeout: 30000 });
  await guest.click('[data-testid="ready"]'); await host.click('[data-testid="ready"]');
  await host.waitForSelector('[data-testid="start"]:not([disabled])', { timeout: 30000 });
  await host.click('[data-testid="start"]');
  const hasView = (p: Page) => p.waitForFunction(() => (globalThis as any).__riftforge?.board?.view, null, { timeout: 30000 });
  await hasView(guest);
  await guest.reload(); await hasView(guest);
  assert.equal(await guest.evaluate(() => (globalThis as any).__riftforge.board.view.you), 1);
  await host.reload(); await hasView(host);
  assert.equal(await host.evaluate(() => (globalThis as any).__riftforge.session.status.mode), 'host');
  // the game continues: play a few decisions on both sides through the UI
  const verBefore = await guest.evaluate(() => (globalThis as any).__riftforge.session.ver);
  await Promise.all([driveSeat(host, { maxSteps: 4, timeoutMs: 30_000, advanceMs: 6000 }), driveSeat(guest, { maxSteps: 4, timeoutMs: 30_000, advanceMs: 6000 })]);
  const verAfter = await guest.evaluate(() => (globalThis as any).__riftforge.session.ver);
  assert.ok(verAfter > verBefore, `guest should receive new state (${verBefore} -> ${verAfter})`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('best-of-3 (bot vs bot): loser picks first player, match completes', { timeout: 180_000 }, async () => {
  const { page, errors } = await open('autoplay-botvbot-5', 1280, `try { localStorage.setItem('riftforge.opts', JSON.stringify({ battlefieldSelection: 'choose', enforceBanlist: false, bestOf: 3 })); } catch {}`);
  await page.waitForFunction(() => { const m = (globalThis as any).__riftforge?.session?.status?.match; return m && (m.wins[0] >= 2 || m.wins[1] >= 2); }, null, { timeout: 170_000, polling: 500 });
  const m = await page.evaluate(() => (globalThis as any).__riftforge.session.status.match);
  assert.ok(m.game >= 2 && m.game <= 3, JSON.stringify(m));
  await page.waitForSelector('text=wins the match', { timeout: 10_000 });
  assert.deepEqual(errors, []);
  await page.context().close();
});
