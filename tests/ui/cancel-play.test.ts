// UI-CANCEL: while making the choices of your own play (here: the manual payment prompt), the prompt has a Cancel
// button and Esc cancels too; the card goes back to your hand and the turn continues.
// Run: node --import tsx --test --test-concurrency=1 tests/ui/cancel-play.test.ts   (slow: bundles + Chromium)
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

async function open(): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  // manual payment: every play of seat 0 stops at a payment prompt before it finalizes
  await page.addInitScript(`try { localStorage.setItem('riftforge.manualPay', 'true'); } catch {}`);
  await page.goto(srv.url + '#autoplay-bot-10');
  await page.waitForFunction(() => (globalThis as any).__riftforge?.board?.view);
  return { page, errors };
}

/** seat 0 follows the bot until it is paying for a play it may still cancel; returns the card/source being paid for */
async function untilCancelable(page: Page, maxTurn = 12): Promise<{ source: string; zoneBefore: string; actionCount: number } | null> {
  return page.evaluate(async (maxT) => {
    const r = (globalThis as any).__riftforge;
    let lastTop: { obj?: string; zone?: string } = {};
    for (let i = 0; i < 6000; i++) {
      const b = r.board; const v = b.view;
      if (v.state.winner !== null || v.state.turn > maxT) return null;
      const p = v.pending;
      if (p && p.player === v.you) {
        if (p.inStep && v.legal.some((a: any) => a.type === 'cancel')) {
          return { source: lastTop.obj ?? p.source, zoneBefore: lastTop.zone ?? '', actionCount: v.state.actionCount };
        }
        const a = r.session.suggest();
        if (a) {
          if (!p.inStep) lastTop = 'obj' in a ? { obj: a.obj, zone: v.state.objects[a.obj]?.zone } : {};
          await b.act(a);
        }
      }
      await new Promise(res => setTimeout(res, 10));
    }
    return null;
  }, maxTurn);
}

const state = (page: Page) => page.evaluate(() => {
  const v = (globalThis as any).__riftforge.board.view;
  return { kind: v.pending?.kind as string | undefined, inStep: !!v.pending?.inStep, actionCount: v.state.actionCount as number, zones: Object.fromEntries(Object.values(v.state.objects as Record<string, { id: string; zone: string }>).map(o => [o.id, o.zone])) as Record<string, string>, cancel: v.legal.some((a: any) => a.type === 'cancel') };
});

test('Cancel button next to the prompt backs out of the play; Esc does too', { timeout: 240_000 }, async () => {
  const { page, errors } = await open();
  const first = await untilCancelable(page);
  assert.ok(first, 'a cancelable decision of seat 0 should come up');
  // the button sits in the prompt's action row
  const btn = page.locator('[data-testid="prompt"] [data-testid="cancel-play"]');
  await btn.waitFor();
  if (process.env.CANCEL_SHOT) await page.screenshot({ path: process.env.CANCEL_SHOT });
  assert.equal(await btn.textContent(), 'Cancel');
  await btn.click();
  await page.waitForFunction((n) => { const v = (globalThis as any).__riftforge.board.view; return v.state.actionCount > n && !v.pending?.inStep; }, first!.actionCount);
  let s = await state(page);
  assert.equal(s.cancel, false);
  assert.ok(first!.zoneBefore, 'the play that started was recorded');
  assert.equal(s.zones[first!.source], first!.zoneBefore, 'the card is back where it was');
  assert.equal(await page.locator('[data-testid="cancel-play"]').count(), 0, 'no Cancel outside a play in progress');

  // again, with Esc
  const second = await untilCancelable(page);
  assert.ok(second, 'a second cancelable decision should come up');
  await page.locator('[data-testid="cancel-play"]').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction((n) => { const v = (globalThis as any).__riftforge.board.view; return v.state.actionCount > n && !v.pending?.inStep; }, second!.actionCount);
  s = await state(page);
  assert.ok(second!.zoneBefore);
  assert.equal(s.zones[second!.source], second!.zoneBefore);
  // the game goes on normally after cancelling: answer the decision this time
  const third = await untilCancelable(page);
  assert.ok(third);
  await page.evaluate(async () => { const r = (globalThis as any).__riftforge; await r.board.act(r.session.suggest()); });
  await page.waitForFunction((n) => (globalThis as any).__riftforge.board.view.state.actionCount > n, third!.actionCount);
  assert.deepEqual(errors, []);
});
