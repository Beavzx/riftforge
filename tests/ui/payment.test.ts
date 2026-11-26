// AUTO-AUDIT (docs/auto-decisions.md A-1): with the "Choose runes when paying" preference on, every payment opens the
// payment panel pre-filled with the auto-pay suggestion; Auto-pay is one click and a changed selection pays manually.
// Run: node --import tsx --test tests/ui/payment.test.ts
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

async function open(manualPay: boolean): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(`try { localStorage.setItem('riftforge.manualPay', ${JSON.stringify(JSON.stringify(manualPay))}); } catch {}`);
  await page.goto(srv.url + '#autoplay-bot-10');
  await page.waitForFunction(() => (globalThis as any).__riftforge?.board?.view);
  return { page, errors };
}

/** seat 0 follows the bot until its pending decision is a payment */
async function untilPayment(page: Page, maxTurn = 10): Promise<boolean> {
  return page.evaluate(async (maxT) => {
    const r = (globalThis as any).__riftforge;
    for (let i = 0; i < 6000; i++) {
      const b = r.board; const v = b.view;
      if (v.state.winner !== null || v.state.turn > maxT) return false;
      const p = v.pending;
      if (p && p.player === v.you) {
        if (p.kind === 'payment') return true;
        const a = r.session.suggest(); if (a) await b.act(a);
      }
      await new Promise(res => setTimeout(res, 10));
    }
    return false;
  }, maxTurn);
}

test('manual-pay preference: payment panel pre-filled with the suggestion; Auto-pay is one click', { timeout: 180_000 }, async () => {
  const { page, errors } = await open(true);
  assert.ok(await untilPayment(page), 'a payment decision should come up');
  await page.waitForSelector('[data-testid="pay-auto"]');
  const sel = await page.evaluate(() => {
    const b = (globalThis as any).__riftforge.board; const sug = b.view.pending.data.suggested;
    return { marked: document.querySelectorAll('.rune.pay-ex, .rune.pay-rc').length, sugRunes: new Set([...sug.exhaust, ...sug.recycle]).size, adds: (sug.other?.abilities ?? []).length, ticked: document.querySelectorAll('[data-testid="pay-add"]:checked').length };
  });
  assert.equal(sel.marked, sel.sugRunes, 'the suggested runes are highlighted');
  assert.equal(sel.ticked, sel.adds, 'the suggested Add abilities are ticked');
  const before = await page.evaluate(() => (globalThis as any).__riftforge.board.view.state.actionCount);
  await page.click('[data-testid="pay-auto"]');
  await page.waitForFunction((n) => { const v = (globalThis as any).__riftforge.board.view; return v.state.actionCount > n && v.pending?.kind !== 'payment'; }, before);
  // the next payment: pay manually with the (unchanged) pre-filled selection
  assert.ok(await untilPayment(page), 'a second payment decision should come up');
  await page.waitForSelector('[data-testid="pay-manual"]');
  const n2 = await page.evaluate(() => (globalThis as any).__riftforge.board.view.state.actionCount);
  await page.click('[data-testid="pay-manual"]');
  await page.waitForFunction((n) => { const v = (globalThis as any).__riftforge.board.view; return v.state.actionCount > n && v.pending?.kind !== 'payment'; }, n2);
  assert.deepEqual(errors, []);
});

test('preference off (default): no payment prompt, the checkbox is on the home screen', { timeout: 120_000 }, async () => {
  const { page, errors } = await open(false);
  const pay = await page.evaluate(() => (globalThis as any).__riftforge.board.view.state.ex?.manualPay);
  assert.deepEqual(pay ?? [false, false], [false, false]);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const home = await ctx.newPage();
  await home.goto(srv.url);
  await home.waitForSelector('[data-testid="opt-manualpay"]');
  assert.deepEqual(errors, []);
});
