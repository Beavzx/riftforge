// Tiny DOM helpers (no framework). Everything the UI draws goes through h().
export type Child = Node | string | number | null | undefined | false | Child[];
export type Props = Record<string, unknown> & {
  class?: string | (string | false | null | undefined)[];
  style?: string | Record<string, string | number>;
  dataset?: Record<string, string | number | undefined>;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement;
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') {
        el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
      } else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else for (const [sk, sv] of Object.entries(v as Record<string, string | number>)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
          else (el.style as unknown as Record<string, string>)[sk] = String(sv);
        }
      } else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v as Record<string, string | number | undefined>)) if (dv !== undefined) el.dataset[dk] = String(dv);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'html') {
        el.innerHTML = String(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else if (k in el && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** localStorage that never throws (sandboxed iframes may deny storage). */
export const store = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v) as T; } catch { return fallback; }
  },
  set(key: string, value: unknown): boolean {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  del(key: string): void { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

export const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off'; } catch { return false; }
};

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const uid = (n = 8) => {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = ''; const r = new Uint32Array(n);
  try { crypto.getRandomValues(r); } catch { for (let i = 0; i < n; i++) r[i] = Math.floor(Math.random() * 1e9); }
  for (let i = 0; i < n; i++) s += a[r[i] % a.length];
  return s;
};
