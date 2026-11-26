// Interaction screenshots: npx tsx tests/ui/scenes.ts [scene ...]  (WIDTHS=1280x800,... THEME=dark|light)
// Scenes: move (select several units with "Select all", destinations glow), chain (respond at the chain stack),
// showdown (focus prompt at the battlefield), hand (hover zoom in place), might (zoom with Might breakdown).
// Plays a bot game (seat 0 follows the bot) until the scene's situation comes up, then shoots tests/ui/shots/scene-<scene>-<w>.png
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { serveDist } from '../fixtures/serve';

const out = 'tests/ui/shots';
mkdirSync(out, { recursive: true });
const theme = process.env.THEME ?? 'dark';
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : ['move', 'chain', 'showdown', 'hand'];
const sizes = (process.env.WIDTHS ?? '1280x800').split(',').map(s => s.split('x').map(Number));
const srv = await serveDist('dist');
const browser = await chromium.launch();

/** Advance seat 0 with bot suggestions until cond(view, board) is true (evaluated in page). */
async function playUntil(page: Page, cond: string, maxTurn = 14): Promise<string> {
  return page.evaluate(async ([condSrc, maxT]) => {
    const r = (globalThis as any).__riftforge;
    const cond = new Function('v', 'b', `return (${condSrc});`) as (v: any, b: any) => boolean;
    for (let i = 0; i < 6000; i++) {
      const b = r.board; const v = b.view;
      if (v.state.winner !== null) return 'ended';
      if (v.state.turn > (maxT as number)) return 'turn limit';
      const p = v.pending;
      if (p && p.player === v.you) {
        try { if (cond(v, b)) return `ok t${v.state.turn} ${p.kind}`; } catch { /* keep going */ }
        const a = r.session.suggest(); if (a) await b.act(a);
      }
      await new Promise(res => setTimeout(res, 15));
    }
    return 'timeout';
  }, [cond, maxTurn] as const);
}

const COND: Record<string, string> = {
  // two or more of my units at one location can move
  move: `p => true, v.pending.kind === 'mainAction' && (() => { const s = v.state; const m = new Map(); for (const id of b.idx.movable) { const o = s.objects[id]; const k = o.zone + (o.battlefieldIndex ?? ''); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.values()].some(n => n >= 2); })()`,
  chain: `v.pending.kind === 'chainResponse' && v.state.chain.length > 0`,
  showdown: `v.pending.kind === 'showdownAction' && v.state.chain.length === 0 && !!v.state.showdown`,
  hand: `v.pending.kind === 'mainAction' && v.state.players[v.you].hand.length >= 4 && v.state.turn >= 3`,
  might: `v.pending.kind === 'mainAction' && Object.values(v.state.objects).some(o => (o.zone === 'base' || o.zone === 'battlefield') && b.mightBreakdown(o, b.card(o)).length > 1)`,
};

for (const scene of scenes) for (const [w, hgt] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, hasTouch: w < 600 });
  page.on('pageerror', e => console.log(`[${scene}@${w}] pageerror:`, e.message));
  await page.addInitScript(th => { try { localStorage.setItem('riftforge.theme', JSON.stringify(th)); } catch {} }, theme);
  let res = 'timeout';
  for (let attempt = 0; attempt < 4 && !res.startsWith('ok'); attempt++) {
    await page.goto(srv.url + '#autoplay-bot-15');
    await page.waitForFunction(() => (globalThis as any).__riftforge?.board?.view);
    res = await playUntil(page, COND[scene].replace(/^p => true, /, ''));
  }
  await page.waitForTimeout(700);
  const tag = `${scene}-${w}${theme === 'light' ? '-light' : ''}`;
  if (scene === 'move' && res.startsWith('ok')) {
    const chip = page.locator('[data-testid="select-all"]').first();
    if (await chip.count()) await chip.click(); else console.log('no select-all chip');
    await page.waitForTimeout(300);
  }
  if (scene === 'hand' && w >= 600) { await page.locator('.hand .card').nth(1).hover(); await page.waitForTimeout(350); }
  if (scene === 'might') {
    const id = await page.evaluate(() => { const b = (globalThis as any).__riftforge.board; return Object.values(b.view.state.objects).find((o: any) => (o.zone === 'base' || o.zone === 'battlefield') && b.mightBreakdown(o, b.card(o)).length > 1) as any; });
    if (id) { await page.locator(`.table [data-obj="${id.id}"]`).first().hover(); await page.waitForTimeout(350); }
  }
  await page.screenshot({ path: `${out}/scene-${tag}.png` });
  console.log(scene, w, res, '->', `${out}/scene-${tag}.png`);
  await page.close();
}
await browser.close(); await srv.close();
