// View-diff animations: FLIP moves, draw/play/death ghosts, damage numbers, conquer & score effects.
// Works identically for local and networked games because it only compares consecutive PlayerViews.
import type { GameState, ObjId, PlayerId } from '../engine/types';
import { h, reducedMotion } from './dom';

export interface Snapshot {
  rects: Map<ObjId, { rect: DOMRect; el: HTMLElement }>;
  anchors: Map<string, DOMRect>;   // e.g. "deck-0", "trash-1"
}

export function snapshot(root: HTMLElement): Snapshot {
  const rects = new Map<ObjId, { rect: DOMRect; el: HTMLElement }>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-obj]')) {
    const id = el.dataset.obj!; if (!rects.has(id)) rects.set(id, { rect: el.getBoundingClientRect(), el });
  }
  const anchors = new Map<string, DOMRect>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-anchor]')) anchors.set(el.dataset.anchor!, el.getBoundingClientRect());
  return { rects, anchors };
}

let fxLayer: HTMLElement | null = null;
function fx(): HTMLElement {
  if (!fxLayer || !fxLayer.isConnected) { fxLayer = h('div', { class: 'fx', 'aria-hidden': 'true' }); document.body.appendChild(fxLayer); }
  return fxLayer;
}

export function floatText(rect: DOMRect, text: string, good = false) {
  if (reducedMotion()) return;
  const el = h('div', { class: ['float-num', good && 'good'], style: { left: rect.left + rect.width / 2 + 'px', top: rect.top + rect.height * 0.3 + 'px' } }, text);
  fx().appendChild(el); setTimeout(() => el.remove(), 950);
}

let bannerEl: HTMLElement | null = null;
export function bigBanner(text: string, who: 'you' | 'opp' | '' = '') {
  if (reducedMotion()) return;
  bannerEl?.remove();
  const el = h('div', { class: ['big-banner', who] }, text);
  bannerEl = el;
  fx().appendChild(el); setTimeout(() => el.remove(), 900);
}

/** Animate from the previous snapshot to the freshly rendered root. */
export function animate(prev: Snapshot | null, root: HTMLElement, before: GameState | null, after: GameState, you: PlayerId) {
  if (!prev || !before) return;
  if (reducedMotion()) return;
  const now = snapshot(root);
  const D = 300;
  // Moves (FLIP)
  for (const [id, { rect: nr, el }] of now.rects) {
    const old = prev.rects.get(id);
    if (old) {
      const dx = old.rect.left - nr.left, dy = old.rect.top - nr.top;
      const sx = old.rect.width / (nr.width || 1);
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2 || Math.abs(sx - 1) > 0.05) {
        el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx})`, zIndex: 30 }, { transform: getComputedStyle(el).transform === 'none' ? 'none' : getComputedStyle(el).transform }],
          { duration: D + Math.min(200, Math.hypot(dx, dy) / 4), easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    } else {
      // New element: drawn into hand → fly from deck; otherwise pop in.
      const o = after.objects[id];
      const back = /^hand-(\d)-\d+$/.exec(id);     // an opponent's hand back (board.ts keys them by position)
      if ((o && o.zone === 'hand') || back) {
        const a = prev.anchors.get(`deck-${o ? o.owner : back![1]}`);
        if (a) {
          const dx = a.left - nr.left, dy = a.top - nr.top;
          el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(.4)`, opacity: 0.2 }, { transform: getComputedStyle(el).transform, opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
          continue;
        }
      }
      el.classList.add('pop-in');
    }
  }
  // Removed elements → ghosts (death/trash/recycle)
  for (const [id, { rect, el }] of prev.rects) {
    if (now.rects.has(id)) continue;
    const o = after.objects[id];
    const was = before.objects[id];
    if (!was || !o) continue;
    const died = (was.zone === 'base' || was.zone === 'battlefield') && (o.zone === 'trash' || o.zone === 'banishment');
    const toAnchor = o.zone === 'trash' ? `trash-${o.owner}` : o.zone === 'mainDeck' ? `deck-${o.owner}` : o.zone === 'runeDeck' ? `runes-${o.owner}` : o.zone === 'banishment' ? `banish-${o.owner}` : null;
    const dest = toAnchor ? now.anchors.get(toAnchor) : null;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add('ghost'); ghost.classList.remove('legal', 'selected', 'targetable');
    Object.assign(ghost.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', transform: 'none' });
    fx().appendChild(ghost);
    const frames: Keyframe[] = died
      ? [{ transform: 'none', filter: 'none', opacity: 1 }, { transform: 'scale(1.08)', filter: 'brightness(2) saturate(0) sepia(1) hue-rotate(-30deg)', opacity: 1, offset: 0.3 },
         dest ? { transform: `translate(${dest.left - rect.left}px, ${dest.top - rect.top}px) scale(.3) rotate(20deg)`, opacity: 0 } : { transform: 'scale(.5) rotate(25deg)', opacity: 0 }]
      : [{ transform: 'none', opacity: 1 }, dest ? { transform: `translate(${dest.left - rect.left}px, ${dest.top - rect.top}px) scale(.35)`, opacity: 0.1 } : { opacity: 0, transform: 'scale(.6)' }];
    ghost.animate(frames, { duration: died ? 700 : 450, easing: 'ease-in' }).onfinish = () => ghost.remove();
    setTimeout(() => ghost.remove(), 900);
  }
  // Damage numbers + shake
  for (const [id, o] of Object.entries(after.objects)) {
    const b = before.objects[id];
    if (!b) continue;
    const r = now.rects.get(id) ?? prev.rects.get(id);
    if (o.damage > b.damage && r) { floatText(r.rect, `-${o.damage - b.damage}`); now.rects.get(id)?.el.classList.add('shake'); }
    else if (o.damage > b.damage && !r) { const pr = prev.rects.get(id); if (pr) floatText(pr.rect, `-${o.damage - b.damage}`); }
  }
  // Score + conquer
  after.players.forEach((p, i) => {
    const bp = before.players[i]; if (!bp) return;
    if (p.points > bp.points) {
      const el = root.querySelector<HTMLElement>(`[data-score="${i}"]`);
      if (el) { el.classList.add('score-pop'); floatText(el.getBoundingClientRect(), `+${p.points - bp.points}`, true); }
    }
  });
  if (after.winner !== null) return;
  after.battlefields.forEach((b, i) => {
    const bb = before.battlefields[i];
    if (bb && b.controller !== null && b.controller !== bb.controller) {
      const el = root.querySelector<HTMLElement>(`[data-bf="${i}"]`);
      el?.classList.add('conquer-flash');
      bigBanner(b.controller === you ? 'Conquered!' : 'Battlefield lost', b.controller === you ? 'you' : 'opp');
    }
  });
  if (after.activePlayer !== before.activePlayer && after.phase !== 'gameOver' && before.phase !== 'mulligan') {
    bigBanner(after.activePlayer === you ? 'Your turn' : `${after.players[after.activePlayer]?.name ?? 'Opponent'}'s turn`, after.activePlayer === you ? 'you' : 'opp');
  }
}
