// Mid-game screenshots: npx tsx tests/ui/mid.ts [turn=6] -> tests/ui/shots/mid-<w>[-light].png (+ zoom/hover shots)
// Plays a game vs the bot (seat 0 follows the bot's suggestion) until the given turn, stopping on a decision
// of seat 0 so prompts are visible. WIDTHS=1280x800,1440x900,720x900,390x844 THEME=dark|light
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { serveDist } from '../fixtures/serve';

const out = 'tests/ui/shots';
mkdirSync(out, { recursive: true });
const turn = Number(process.argv[2] ?? 6);
const theme = process.env.THEME ?? 'dark';
const sizes = (process.env.WIDTHS ?? '1280x800,1440x900,720x900,390x844').split(',').map(s => s.split('x').map(Number));
const srv = await serveDist('dist');
const browser = await chromium.launch();
for (const [w, hgt] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, hasTouch: w < 600 });
  page.on('pageerror', e => console.log(`[${w}] pageerror:`, e.message));
  page.on('console', m => { if (m.type() === 'error') console.log(`[${w}] console:`, m.text()); });
  await page.addInitScript(th => { try { localStorage.setItem('riftforge.theme', JSON.stringify(th)); } catch {} }, theme);
  await page.goto(srv.url + '#autoplay-bot-20');
  await page.waitForFunction(() => (globalThis as any).__riftforge?.board?.view);
  // seat 0 follows the bot until the target turn, then stop at one of its decisions
  const res = await page.evaluate(async (T) => {
    const r = (globalThis as any).__riftforge;
    for (let i = 0; i < 4000; i++) {
      const v = r.board.view; const s = v.state;
      if (s.winner !== null) return 'ended';
      const p = v.pending;
      if (p && p.player === v.you) {
        if (s.turn >= T && s.phase === 'action' && (p.kind === 'mainAction' || p.kind === 'chainResponse' || p.kind === 'showdownAction')) return `stopped t${s.turn} ${p.kind}`;
        const a = r.session.suggest(); if (a) await r.board.act(a);
      }
      await new Promise(res => setTimeout(res, 30));
    }
    return 'timeout';
  }, turn);
  console.log(w, res);
  await page.waitForTimeout(1300);
  const tag = `${w}${theme === 'light' ? '-light' : ''}`;
  await page.screenshot({ path: `${out}/mid-${tag}.png` });
  // zoom on a board card / hand card
  if (w >= 600) {
    const unit = page.locator('.bfs .slot > .card, .zone.base .slot > .card').first();
    if (await unit.count()) { await unit.hover(); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/mid-zoom-${tag}.png` }); }
    const hc = page.locator('.hand .card').nth(1);
    if (await hc.count()) { await hc.hover(); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/mid-hand-${tag}.png` }); }
  } else {
    const unit = page.locator('.bfs .slot > .card, .zone.base .slot > .card').first();
    if (await unit.count()) { await unit.dispatchEvent('contextmenu'); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/mid-zoom-${tag}.png` }); }
  }
  console.log('wrote', `${out}/mid-${tag}.png`);
  await page.close();
}
await browser.close(); await srv.close();
