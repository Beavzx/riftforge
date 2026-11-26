// Drives one seat of a Riftforge game *through the UI* (clicks, popovers, prompts), using the bot's
// suggestion to decide what to do. Falls back to a direct board.act() only if no UI path is found.
import type { Page } from 'playwright';
import type { Action } from '../../src/engine/types';

export interface DriveStats { uiActions: number; fallbacks: number; byKind: Record<string, number>; errors: string[]; steps: number }

interface Step { done?: boolean; wait?: boolean; kind?: string; action?: Action | null; you?: number; count?: number; label?: string; optObj?: Record<string, string> }

async function stepInfo(page: Page): Promise<Step | null> {
  return page.evaluate(() => {
    const r = (globalThis as any).__riftforge; const b = r?.board; const v = b?.view;
    if (!v) return null;
    if (v.state.winner !== null && v.state.winner !== undefined) return { done: true };
    const p = v.pending;
    if (!p || p.player !== v.you) return { wait: true, count: v.state.actionCount };
    const action = r.session.suggest ? r.session.suggest() : r.botFromView ? r.botFromView(v) : v.legal[0];
    const optObj: Record<string, string> = {};
    for (const o of p.options ?? []) for (const id of o.objIds ?? []) optObj[o.id] = id;
    return { kind: p.kind, action, you: v.you, count: v.state.actionCount, label: action ? b.describe(action) : '', optObj };
  });
}

export let LAST_ERR = '';
const HAND = { position: { x: -1, y: -1 } };
async function clickIf(page: Page, sel: string, opts: { position?: { x: number; y: number } } = {}): Promise<boolean> {
  const loc = page.locator(sel).first();
  if (!(await loc.count())) return false;
  if (!(await loc.isVisible().catch(() => false))) return false;
  if (opts.position?.x === -1) { await page.mouse.move(2, 2); await page.waitForTimeout(30); const bb = await loc.boundingBox(); opts = { position: { x: Math.max(8, (bb?.width ?? 60) * 0.25), y: 22 } }; }
  try { await loc.click({ timeout: 1500, ...opts }); return true; } catch (e) { LAST_ERR = String(e).split('\n').filter(l => /intercept|outside|not visible|not stable|Timeout/.test(l)).slice(0, 3).join(' | '); return false; }
}
async function clickPopover(page: Page, label: string): Promise<boolean> {
  const pop = page.locator('.popover');
  try { await pop.waitFor({ state: 'visible', timeout: 800 }); } catch { return false; }
  const btn = pop.locator('button', { hasText: label }).first();
  if (await btn.count()) { await btn.click(); return true; }
  return false;
}
const boardObj = (id: string) => `.g-main :is(.table, .hand) [data-obj="${id}"]`;
const destSel = (to: number | 'base', you: number) => to === 'base' ? `[data-zone="base-${you}"]` : `[data-bf="${to}"] .bf-head`;

async function perform(page: Page, s: Step): Promise<boolean> {
  const a = s.action!; const you = s.you!;
  switch (a.type) {
    case 'endTurn': case 'pass':
      if (await clickIf(page, '[data-testid="pass"]')) return true;
      if (await clickIf(page, '.end-btn:not([disabled])')) return true;
      LAST_ERR += ' endbtn: ' + (await page.locator('.end-btn').first().evaluate(e => e.outerHTML.slice(0, 200)).catch(() => 'none'));
      return false;
    case 'playCard': case 'hide': {
      const inHand = await page.locator(`.hand [data-obj="${a.obj}"]`).count();
      if (!(await clickIf(page, boardObj(a.obj), inHand ? HAND : {}))) return false;
      if (await page.locator('.popover').count()) return clickPopover(page, s.label!);
      return true;
    }
    case 'activate': {
      // a single legal ability fires on click (runes: click = exhaust, right-click = recycle); several open a menu
      const right = a.abilityIndex === 951 && await page.locator(`.rune[data-obj="${a.obj}"]`).count();
      if (right) { await page.mouse.move(2, 2); try { await page.locator(boardObj(a.obj)).first().click({ button: 'right', timeout: 1500 }); return true; } catch { return false; } }
      if (!(await clickIf(page, boardObj(a.obj)))) return false;
      if (await page.locator('.popover').count()) return clickPopover(page, s.label!);
      return true;
    }
    case 'move': {
      for (const u of a.units) {
        if (!(await clickIf(page, boardObj(u)))) return false;
        if (await page.locator('.popover').count()) await clickPopover(page, 'Keep selected');
      }
      return clickIf(page, destSel(a.to, you), a.to === 'base' ? { position: { x: 10, y: 10 } } : {});
    }
    case 'assignDamage': return clickIf(page, '.prompt [data-testid="confirm"]:not([disabled])');
    case 'choose': {
      const ids = a.optionIds;
      if (s.kind === 'payment') return ids[0] === 'auto' ? clickIf(page, '[data-testid="pay-auto"]') : false;
      if (s.kind === 'optional') return clickIf(page, `[data-testid="opt-${ids[0] === 'yes' ? 'yes' : ids[0] === 'no' ? 'no' : ids[0]}"]`);
      if (s.kind === 'mulligan') {
        for (const id of ids) if (!(await clickIf(page, `.hand [data-obj="${s.optObj?.[id] ?? id}"]`, HAND))) return false;
        return clickIf(page, '[data-testid="confirm"]:not([disabled])');
      }
      if (await page.locator(`[data-testid="opt-${ids[0]}"]`).count()) {
        for (const id of ids) await clickIf(page, `[data-testid="opt-${id}"]`);
        if (ids.length > 1 || s.kind === 'orderTriggers') await clickIf(page, '[data-testid="confirm"]:not([disabled])');
        return true;
      }
      if (!ids.length) return clickIf(page, '[data-testid="confirm-none"]:not([disabled])') || clickIf(page, '[data-testid="confirm"]:not([disabled])');
      for (const id of ids) {
        const obj = s.optObj?.[id];
        if (!obj) return false;
        if (await clickIf(page, boardObj(obj))) continue;
        // not on the board (e.g. cards looked at from the deck): use the prompt's card list
        const label = await page.evaluate(o => (globalThis as any).__riftforge.board.view.pending.options.find((x: any) => x.id === o)?.label as string, id);
        if (!(await clickIf(page, `.prompt .p-cards > [title="${label.replace(/"/g, '\\"')}"]`))) return false;
      }
      if (await page.locator('.prompt [data-testid="confirm"]:not([disabled])').count()) await clickIf(page, '.prompt [data-testid="confirm"]:not([disabled])');
      return true;
    }
    default: return false;
  }
}

export async function driveSeat(page: Page, opts: { maxSteps?: number; timeoutMs?: number; advanceMs?: number } = {}): Promise<DriveStats> {
  const stats: DriveStats = { uiActions: 0, fallbacks: 0, byKind: {}, errors: [], steps: 0 };
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  let idle = 0;
  while (Date.now() < deadline && stats.steps < (opts.maxSteps ?? 2000)) {
    const s = await stepInfo(page);
    if (s?.done) return stats;
    if (!s || s.wait || !s.action) { await page.waitForTimeout(60); idle++; continue; }
    idle = 0; stats.steps++;
    const before = s.count;
    let ok = false;
    try { ok = await perform(page, s); } catch (e) { stats.errors.push(String(e)); }
    // wait for the state to advance
    const advanced = async () => page.evaluate(([c, k]) => { const v = (globalThis as any).__riftforge.board.view; return v.state.actionCount !== c || v.pending?.kind !== k || v.state.winner !== null || v.pending?.player !== v.you; }, [before, s.kind] as const);
    let moved = false;
    for (let i = 0; i < (opts.advanceMs ?? 2000) / 50 && !moved; i++) { moved = await advanced(); if (!moved) await page.waitForTimeout(50); }
    if (ok && moved) { stats.uiActions++; stats.byKind[`${s.kind}:${s.action.type}`] = (stats.byKind[`${s.kind}:${s.action.type}`] ?? 0) + 1; continue; }
    // fallback: send directly
    stats.fallbacks++;
    stats.errors.push(`fallback ${s.kind} ${JSON.stringify(s.action).slice(0, 140)} (ui=${ok}) ${LAST_ERR}`); LAST_ERR = '';
    await page.evaluate(a => { (globalThis as any).__riftforge.board.act(a); }, s.action);
    await page.waitForTimeout(80);
  }
  stats.errors.push('timeout/maxSteps');
  return stats;
}
