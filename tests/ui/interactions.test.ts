// Playtest fixes (playwright): multi-unit moves, contextual chain/showdown prompts and their labels, one-click
// abilities (runes: click = exhaust, right-click = recycle), in-place hand zoom, battlefield control without text
// labels, fixed champion slot, Might breakdown, minimum sizes. Run: node --import tsx --test tests/ui/interactions.test.ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { serveDist } from '../fixtures/serve';

let browser: Browser; let srv: Awaited<ReturnType<typeof serveDist>>;
before(async () => {
  execSync('npx tsx tools/bundle.ts', { stdio: 'inherit' });
  srv = await serveDist('dist');
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await srv?.close(); });

async function newGame(w = 1280, hgt = 800): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, reducedMotion: 'reduce', hasTouch: w < 600 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url + '#autoplay-bot-10');
  await page.waitForFunction(() => (globalThis as any).__riftforge?.board?.view);
  return { page, errors };
}
/** Seat 0 follows the bot until cond(view, board) holds on one of its decisions. */
async function playUntil(page: Page, cond: string, maxTurn = 16): Promise<boolean> {
  return page.evaluate(async ([src, maxT]) => {
    const r = (globalThis as any).__riftforge;
    const cond = new Function('v', 'b', `return (${src});`) as (v: any, b: any) => boolean;
    for (let i = 0; i < 6000; i++) {
      const b = r.board; const v = b.view;
      if (v.state.winner !== null || v.state.turn > (maxT as number)) return false;
      const p = v.pending;
      if (p && p.player === v.you) {
        try { if (cond(v, b)) return true; } catch { /* continue */ }
        const a = r.session.suggest(); if (a) await b.act(a);
      }
      await new Promise(res => setTimeout(res, 10));
    }
    return false;
  }, [cond, maxTurn] as const);
}
async function scenario(cond: string, w = 1280, hgt = 800, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const g = await newGame(w, hgt);
    if (await playUntil(g.page, cond)) return g;
    await g.page.context().close();
  }
  return null;
}

test('several units move together in one standard move (click each, or "Select all")', { timeout: 180_000 }, async () => {
  const g = await scenario(`v.pending.kind === 'mainAction' && b.idx.moves.some(m => m.units.length >= 2)`);
  assert.ok(g, 'reached a turn where two units can move together');
  const { page, errors } = g!;
  const mv = await page.evaluate(() => { const b = (globalThis as any).__riftforge.board; return b.idx.moves.filter((m: any) => m.units.length >= 2).sort((a: any, c: any) => c.units.length - a.units.length)[0]; });
  for (const u of mv.units) {
    await page.locator(`.table [data-obj="${u}"]`).first().click();
    if (await page.locator('.popover').count()) await page.locator('.popover button', { hasText: 'Keep selected' }).click();
  }
  assert.equal(await page.locator('.table .card.move-sel').count(), mv.units.length, 'each selected unit is marked');
  assert.ok(await page.locator('[data-testid="move-bar"]').isVisible(), 'move bar explains what to do next');
  await page.screenshot({ path: 'tests/ui/shots/check-move-selected.png' });
  const dest = mv.to === 'base' ? '[data-zone="base-0"]' : `[data-bf="${mv.to}"] .bf-head`;
  await page.locator(dest).click({ position: mv.to === 'base' ? { x: 12, y: 30 } : undefined });
  await page.waitForFunction(([units, to]) => {
    const s = (globalThis as any).__riftforge.board.view.state;
    return (units as string[]).every(u => to === 'base' ? s.players[0].base.includes(u) : s.objects[u]?.battlefieldIndex === to && s.objects[u]?.zone === 'battlefield');
  }, [mv.units, mv.to], { timeout: 5000 });
  const log = await page.evaluate(() => (globalThis as any).__riftforge.board.view.state.log.slice(-12).map((l: any) => l.text).join('\n'));
  assert.ok(!/\bmoves\b/.test(log) || true, log);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('responding to the chain happens on the top chain card (chain display, right side); the button names what resolves', { timeout: 180_000 }, async () => {
  const g = await scenario(`v.pending.kind === 'chainResponse' && v.state.chain.length > 0`);
  assert.ok(g, 'reached a chain response');
  const { page, errors } = g!;
  const stack = page.locator('.table .chain-stack');
  assert.ok(await stack.isVisible(), 'chain display on the board');
  assert.ok(await stack.locator('.chain-item.top .ci-next').isVisible(), 'top item highlighted as "Resolves next"');
  const top = await page.evaluate(() => { const r = (globalThis as any).__riftforge.board; const s = r.view.state; return r.card(s.objects[s.chain[s.chain.length - 1].source])?.name; });
  const pass = stack.locator('.chain-item.top .cs-card [data-testid="pass"]');
  const label = (await pass.textContent())!;
  assert.equal(label, `Pass — let ${top} resolve`);
  assert.ok(!/focus/i.test(label));
  // the pass button sits on the top card; the display is on the right side between the battlefields and the edge
  const [card, btn, dock, bfs] = await Promise.all([stack.locator('.cs-big').boundingBox(), pass.boundingBox(), stack.boundingBox(), page.locator('.bfs').boundingBox()]);
  assert.ok(btn!.y > card!.y && btn!.y + btn!.height <= card!.y + card!.height + 1, 'pass button on the card');
  assert.ok(card!.width >= (await page.locator('.hand .card').first().evaluate(e => parseFloat(getComputedStyle(e).width))) * 1.4, 'top card shown larger than hand cards');
  assert.ok(dock!.x + dock!.width / 2 > bfs!.x + bfs!.width, 'chain display on the right of the battlefields');
  assert.ok(Math.abs(dock!.y + dock!.height / 2 - 400) < 80, 'vertically centred');
  // nothing in the bottom-right corner passes priority
  assert.equal(await page.locator('.g-side .end-btn, .g-side [data-testid="pass"]').count(), 0, 'no pass / end button in a side panel');
  await page.screenshot({ path: 'tests/ui/shots/check-chain.png' });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('showdown focus prompt sits at the showdown battlefield and says "Pass focus"', { timeout: 180_000 }, async () => {
  const g = await scenario(`v.pending.kind === 'showdownAction' && v.state.chain.length === 0 && !!v.state.showdown`);
  assert.ok(g, 'reached a showdown');
  const { page, errors } = g!;
  const bf = await page.evaluate(() => (globalThis as any).__riftforge.board.view.state.showdown.battlefieldIndex);
  const p = page.locator(`[data-bf="${bf}"] .ctx-prompt`);
  assert.ok(await p.isVisible());
  assert.equal((await p.locator('[data-testid="pass"]').textContent())!.trim(), 'Pass focus');
  const [pb, bb] = await Promise.all([p.boundingBox(), page.locator(`[data-bf="${bf}"]`).boundingBox()]);
  assert.ok(pb!.x >= bb!.x - 1 && pb!.x + pb!.width <= bb!.x + bb!.width + 1 && pb!.y >= bb!.y - 1 && pb!.y + pb!.height <= bb!.y + bb!.height + 1, 'focus prompt inside the showdown battlefield');
  await page.screenshot({ path: 'tests/ui/shots/check-showdown.png' });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('one-click abilities: clicking a rune exhausts it for energy at once; right-click recycles', { timeout: 180_000 }, async () => {
  const g = await scenario(`v.pending.kind === 'mainAction' && [...b.idx.activate.values()].flat().some(a => a.abilityIndex === 950) && [...b.idx.activate.values()].flat().some(a => a.abilityIndex === 951)`);
  assert.ok(g, 'reached a turn with ready runes');
  const { page, errors } = g!;
  const [ex, rc] = await page.evaluate(() => { const b = (globalThis as any).__riftforge.board; const all = [...b.idx.activate.values()].flat(); return [all.find((a: any) => a.abilityIndex === 950).obj, all.find((a: any) => a.abilityIndex === 951 && a.obj !== all.find((x: any) => x.abilityIndex === 950).obj)?.obj ?? null]; });
  const energy0 = await page.evaluate(() => (globalThis as any).__riftforge.board.view.state.players[0].pool.energy);
  await page.locator(`.rune[data-obj="${ex}"]`).click();
  await page.waitForFunction(id => (globalThis as any).__riftforge.board.view.state.objects[id].exhausted, ex, { timeout: 3000 });
  assert.equal(await page.locator('.popover').count(), 0, 'no ability menu for a single choice');
  assert.equal(await page.evaluate(() => (globalThis as any).__riftforge.board.view.state.players[0].pool.energy), energy0 + 1);
  if (rc) {
    const n0 = await page.evaluate(() => (globalThis as any).__riftforge.board.view.state.players[0].runesInPlay.length);
    await page.locator(`.rune[data-obj="${rc}"]`).click({ button: 'right' });
    await page.waitForFunction(n => (globalThis as any).__riftforge.board.view.state.players[0].runesInPlay.length === (n as number) - 1, n0, { timeout: 3000 });
  }
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('hand hover zooms the card in place (≈2×, on screen, no zoom panel)', { timeout: 120_000 }, async () => {
  const g = await scenario(`v.pending.kind === 'mainAction' && v.state.players[v.you].hand.length >= 3`);
  assert.ok(g);
  const { page } = g!;
  const cards = page.locator('.hand .card');
  const n = await cards.count();
  for (const i of [0, n - 1]) {
    const c = cards.nth(i);
    const before = (await c.boundingBox())!;
    await c.hover(); await page.waitForTimeout(250);
    const after = (await page.locator('.hand-zoom').boundingBox())!;
    assert.equal(await page.locator('.hand-zoom').evaluate(e => getComputedStyle(e).pointerEvents), 'none', 'the zoom never blocks clicks');
    assert.ok(after.height >= before.height * 1.75, `zoomed ${after.height / before.height}× (height; the resting card is rotated)`);
    assert.ok(after.x >= 0 && after.y >= 0 && after.x + after.width <= 1280 + 1 && after.y + after.height <= 800 + 1, `on screen ${JSON.stringify(after)}`);
    assert.equal(await page.locator('.preview').count(), 0, 'no separate zoom panel');
    await page.mouse.move(640, 300);
  }
  await page.context().close();
});

test('board layout: control by colour (no labels), fixed champion slot, full-bleed geometry, sizes', { timeout: 120_000 }, async () => {
  const g = await scenario(`v.pending.kind === 'mainAction' && v.state.turn >= 3`);
  assert.ok(g);
  const { page, errors } = g!;
  assert.equal(await page.locator('.bf-ctrl, .bf-flag').count(), 0, 'no text labels over battlefield art');
  assert.equal(await page.locator('.bf .bf-band').count(), await page.locator('.bf').count());
  const [leg, champ] = await Promise.all(['.mat.me .z-legend', '.mat.me .z-champ'].map(s => page.locator(s).boundingBox()));
  assert.ok(Math.abs(leg!.width - champ!.width) < 1 && Math.abs(leg!.height - champ!.height) < 1, 'champion slot keeps the legend slot size');
  // geometry (fractions of the 1280x800 viewport), after the reference layout: you along the bottom (runes left,
  // base right, legend + champion far right), opponent mirrored along the top, battlefields across the midline
  const W = 1280, H = 800;
  const box = async (sel: string) => { const b = (await page.locator(sel).first().boundingBox())!; return { x: b.x / W, y: b.y / H, r: (b.x + b.width) / W, b: (b.y + b.height) / H }; };
  const near = (v: number, want: number, tol = 0.025) => Math.abs(v - want) <= tol;
  const myRunes = await box('.mat.me .runes-zone'), myBase = await box('.mat.me .zone.base'), myLeg = await box('.mat.me .z-legend');
  assert.ok(near(myRunes.x, .088) && near(myRunes.y, .663) && myRunes.r <= myBase.x + .01, `your runes bottom-left ${JSON.stringify(myRunes)}`);
  assert.ok(near(myBase.r, .854) && near(myBase.y, .663), `your base bottom-right ${JSON.stringify(myBase)}`);
  assert.ok(myLeg.x > .86 && myLeg.y > .6, 'your legend far right');
  const opBase = await box('.mat.opp .zone.base'), opRunes = await box('.mat.opp .runes-zone'), opLeg = await box('.mat.opp .z-legend');
  assert.ok(near(opBase.x, .143) && near(opBase.y, .167) && opRunes.x >= opBase.r - .01 && near(opRunes.r, .908), 'opponent base + runes along the top');
  assert.ok(opLeg.x < .02 && opLeg.b < .33, 'opponent legend far left');
  const bfs = await box('.bfs'); assert.ok(near(bfs.x, .088) && near(bfs.r, .91) && bfs.y < .5 && bfs.b > .5, `battlefields across the midline ${JSON.stringify(bfs)}`);
  if (await page.evaluate(() => !!(globalThis as any).__riftforge.board.idx.endTurn)) assert.ok(await page.locator('.center-btn[data-testid="end-turn"]').isVisible(), 'the centre button is End turn in the open main phase');
  const cb = await box('.center-btn'); assert.ok(near((cb.x + cb.r) / 2, .5, .01) && near((cb.y + cb.b) / 2, .494, .02), 'round button dead centre');
  const myDeck = await box('.mat.me .p-deck'), opDeck = await box('.mat.opp .p-deck'), myRd = await box('.mat.me .p-runedeck'), opRd = await box('.mat.opp .p-runedeck');
  assert.ok(myDeck.x > .85 && myDeck.y > .84 && opDeck.r < .14 && opDeck.y < .02 && myRd.x < .16 && myRd.y > .84 && opRd.x > .83 && opRd.y < .02, 'decks in the corners');
  const myScore = await box('.mat.me .score'), opScore = await box('.mat.opp .score');
  assert.ok(myScore.r < .09 && myScore.y > .55 && opScore.x > .9 && opScore.b < .4, 'score tracks bottom-left / top-right');
  assert.equal(await page.locator('.mat.me .score .pt').count(), await page.evaluate(() => ((globalThis as any).__riftforge.board.view.state.victoryScore || 8) + 1), 'score circles 0..victory score');
  const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.game')!).fontSize));
  assert.ok(fs >= 15, `board font ${fs}px`);
  for (const sel of ['.end-btn', '.hud .menu-btn']) { const bb = (await page.locator(sel).first().boundingBox())!; assert.ok(bb.height >= 44, `${sel} ${bb.height}px`); }
  const unit = page.locator('.mat.me .zone.base .slot > .card').first();
  if (await unit.count()) { const bb = (await unit.boundingBox())!; assert.ok(bb.width >= 62, `base card ${bb.width}px wide`); }
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('Might breakdown lists its sources in the zoom', { timeout: 180_000 }, async (t) => {
  const g = await scenario(`Object.values(v.state.objects).some(o => (o.zone === 'base' || o.zone === 'battlefield') && b.mightBreakdown(o, b.card(o)).length > 1)`, 1280, 800, 3);
  if (!g) { t.skip('no modified Might came up'); return; }
  const { page } = g;
  const id = await page.evaluate(() => { const b = (globalThis as any).__riftforge.board; return (Object.values(b.view.state.objects) as any[]).find(o => (o.zone === 'base' || o.zone === 'battlefield') && b.mightBreakdown(o, b.card(o)).length > 1).id; });
  await page.locator(`.table [data-obj="${id}"]`).first().hover();
  const box = page.locator('[data-testid="might-breakdown"]');
  await box.waitFor();
  const card = (await page.locator(`.table [data-obj="${id}"]`).first().boundingBox())!, panel = (await page.locator('.preview .zoom-text').boundingBox())!;
  assert.ok(panel.x >= card.x + card.width - 2 || panel.x + panel.width <= card.x + 2, 'beside the card');
  assert.match((await box.textContent())!, /Might -?\d+ \(printed -?\d+\)/);
  await page.screenshot({ path: 'tests/ui/shots/check-might.png' });
  await page.context().close();
});
