// COACH: the game menu's "Export game record (for review)" yields a record that replays exactly in the Node engine.
// Run: node --import tsx --test tests/ui/export-record.test.ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { serveDist } from '../fixtures/serve';
import { createGame, applyAction } from '../../src/engine/index.ts';
import type { GameSetup } from '../../src/engine/types.ts';
import { cardDb } from '../../tools/sim-lib.ts';
import { RECORD_FORMAT, type GameRecord } from '../../src/net/record.ts';

let browser: Browser; let srv: Awaited<ReturnType<typeof serveDist>>;
before(async () => {
  execSync('npx tsx tools/bundle.ts', { stdio: 'inherit' });
  srv = await serveDist('dist');
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await srv?.close(); });

test('export game record from the menu and replay it', { timeout: 240_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url + '#autoplay-bot-10');
  await page.waitForFunction(() => (globalThis as any).__riftforge?.board?.view);
  // seat 0 follows the bot's suggestions until turn 4
  await page.evaluate(async () => {
    const r = (globalThis as any).__riftforge;
    for (let i = 0; i < 4000; i++) {
      const b = r.board; const v = b.view;
      if (v.state.winner !== null || v.state.turn >= 4) return;
      const p = v.pending;
      if (p && p.player === v.you) { const a = r.session.suggest(); if (a) await b.act(a); }
      await new Promise(res => setTimeout(res, 10));
    }
  });
  await page.locator('.hud .menu-btn').first().click();
  await page.getByText('Export game record (for review)').click();
  const text = await page.locator('textarea').first().inputValue();
  const rec = JSON.parse(text) as GameRecord;
  assert.equal(rec.format, RECORD_FORMAT);
  assert.ok(rec.actions.length > 10, `only ${rec.actions.length} actions`);
  assert.equal(rec.you, 0);
  const live = await page.evaluate(() => { const s = (globalThis as any).__riftforge.session.state; return { turn: s.turn, points: s.players.map((p: any) => p.points), n: s.actionCount }; });
  let g = createGame({ ...rec.setup, cardDb: cardDb() } as GameSetup);
  for (const a of rec.actions) g = applyAction(g, a).state;
  assert.equal(g.turn, rec.result!.turn);
  assert.deepEqual(g.players.map(p => p.points), rec.result!.points);
  assert.ok(live.turn >= g.turn, 'record is behind the live game');
  assert.deepEqual(errors, []);
  await ctx.close();
});
