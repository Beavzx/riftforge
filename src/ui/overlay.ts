// In-page dialogs (alert/confirm/prompt don't work in the sandbox), toasts, popovers and card preview.
import { h, type Child } from './dom';
import { type CardRec, renderCard, keywordReminder, rulesHtml, typeLine } from './cards';

let modalStack: HTMLElement[] = [];

export function modal(title: string, body: Child, actions: { label: string; primary?: boolean; danger?: boolean; onClick?: () => void | boolean; close?: boolean }[] = [{ label: 'Close' }], opts: { wide?: boolean; onClose?: () => void } = {}): () => void {
  const prevFocus = document.activeElement as HTMLElement | null;
  const close = () => { back.remove(); modalStack = modalStack.filter(m => m !== back); opts.onClose?.(); prevFocus?.focus?.(); };
  const back = h('div', { class: 'modal-back', onClick: (e: Event) => { if (e.target === back) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: opts.wide ? { width: 'min(1000px, 100%)' } : undefined },
      h('h2', null, title), body,
      h('div', { class: 'm-actions' }, actions.map(a => h('button', {
        class: ['btn', a.primary && 'primary', a.danger && 'danger'], onClick: () => { const keep = a.onClick?.(); if (keep !== false) close(); },
      }, a.label)))));
  back.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Escape') close(); });
  document.body.appendChild(back); modalStack.push(back);
  (back.querySelector('.m-actions .btn.primary, .m-actions .btn') as HTMLElement | null)?.focus();
  return close;
}

export function confirmDialog(title: string, text: string, ok = 'OK'): Promise<boolean> {
  return new Promise(res => { let v = false; modal(title, h('p', null, text), [{ label: 'Cancel' }, { label: ok, primary: true, onClick: () => { v = true; } }], { onClose: () => res(v) }); });
}

let toastWrap: HTMLElement | null = null;
export function toast(text: string, kind: 'info' | 'bad' = 'info', ms = 3200) {
  if (!toastWrap || !toastWrap.isConnected) { toastWrap = h('div', { class: 'toast-wrap', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastWrap); }
  const t = h('div', { class: ['toast', kind === 'bad' && 'bad'] }, text);
  toastWrap.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

let pop: HTMLElement | null = null;
export function closePopover() { pop?.remove(); pop = null; }
export function popover(anchor: Element | { x: number; y: number }, title: string | null, items: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }[]) {
  closePopover();
  pop = h('div', { class: 'popover', role: 'menu' },
    title ? h('div', { class: 'pop-title' }, title) : null,
    items.map(it => h('button', { class: ['btn', 'small', it.primary && 'primary'], role: 'menuitem', disabled: it.disabled, onClick: (e: Event) => { e.stopPropagation(); closePopover(); it.onClick(); } }, it.label)),
    h('button', { class: 'btn small ghost', onClick: () => closePopover() }, 'Cancel'));
  document.body.appendChild(pop);
  const r = 'getBoundingClientRect' in anchor ? anchor.getBoundingClientRect() : { left: anchor.x, top: anchor.y, width: 0, height: 0, bottom: anchor.y, right: anchor.x };
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = r.left + r.width / 2 - pw / 2, y = r.top - ph - 8;
  if (y < 8) y = r.bottom + 8;
  x = Math.max(8, Math.min(window.innerWidth - pw - 8, x)); y = Math.max(8, Math.min(window.innerHeight - ph - 8, y));
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  (pop.querySelector('.btn') as HTMLElement | null)?.focus();
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (pop && !pop.contains(e.target as Node)) { closePopover(); } document.removeEventListener('pointerdown', off); }), 0);
}

// ---- Card zoom (hover / long-press): full-size card image + the parsed rules text (image text is small) ----
let prev: HTMLElement | null = null;
export function showPreview(card: CardRec | undefined, anchor: Element, extra?: string[], printed?: string | null) {
  hidePreview();
  if (!card) return;
  const kwHelp = card.keywords.map(k => { const r = keywordReminder(card, k); return r ? `[${k.replace(/ \d+$/, '')}] ${r}` : ''; }).filter(Boolean);
  // "Might N (printed M)" followed by its source lines (from Board.mightBreakdown) is shown as its own block
  const all = extra ?? [];
  const mi = all.findIndex(l => /^Might -?\d+ \(printed/.test(l));
  let mightLines: string[] = [];
  if (mi >= 0) { let j = mi + 1; while (j < all.length && /^([+−-]\d|Might set)/.test(all[j])) j++; mightLines = all.slice(mi, j); }
  const stateLines = all.filter(l => !mightLines.includes(l));
  const big = renderCard(card, { size: 'xl', showText: true, printed, eager: true });
  big.removeAttribute('data-obj');
  const hasImg = big.classList.contains('has-img');
  const stats: string[] = [];
  if (card.energy != null) stats.push(`<i class="ico ico-energy">${card.energy}</i>`);
  if (card.power) stats.push(Array.from({ length: card.power }, () => `<i class="ico ico-pip pip-${card.domains.find(d => d !== 'Colorless') ?? 'Any'}"></i>`).join(''));
  if (card.might != null) stats.push(`<span class="z-might"><i class="ico ico-might"></i>${card.might}</span>`);
  const text = h('div', { class: ['zoom-text', !hasImg && 'only-extra'] },
    h('div', { class: 'z-name' }, card.name, card.subtitle ? h('span', { class: 'z-sub' }, card.subtitle) : null),
    h('div', { class: 'z-type' }, h('span', { html: stats.join(' ') }), typeLine(card)),
    card.text ? h('div', { class: 'z-rules', html: rulesHtml(card.text, card) }) : null,
    mightLines.length ? h('div', { class: 'z-might-src', 'data-testid': 'might-breakdown' }, h('div', { class: 'zm-head' }, mightLines[0]),
      mightLines.slice(1).map(l => h('div', { class: ['zm-line', /^[−-]/.test(l) ? 'down' : /^\+/.test(l) ? 'up' : ''] }, l))) : null,
    stateLines.length ? h('div', { class: 'z-state' }, stateLines.map(l => h('div', { html: rulesHtml(l, card) }))) : null,
    kwHelp.length ? h('div', { class: 'z-kw' }, kwHelp.map(l => h('div', { html: rulesHtml(l, card) }))) : null,
    h('div', { class: 'z-foot' }, `${card.set.toUpperCase()} · ${card.rarity}`));
  prev = h('div', { class: ['preview', card.type === 'Battlefield' && 'landscape'], 'aria-hidden': 'true' }, big, text);
  document.body.appendChild(prev);
  const W = window.innerWidth, H = window.innerHeight;
  if (W < 600) { prev.classList.add('centered'); return; }
  const r = anchor.getBoundingClientRect();
  const pw = prev.offsetWidth, ph = prev.offsetHeight;
  let x = r.right + 14; if (x + pw > W - 6) x = r.left - pw - 14;
  let y = r.top + r.height / 2 - ph / 2;
  if (x < 6) { x = Math.max(6, Math.min(W - pw - 6, r.left + r.width / 2 - pw / 2)); y = r.top - ph - 12 < 6 ? r.bottom + 12 : r.top - ph - 12; }
  y = Math.max(6, Math.min(H - ph - 6, y));
  prev.style.left = x + 'px'; prev.style.top = y + 'px';
}
export function hidePreview() { prev?.remove(); prev = null; }
