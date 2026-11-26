// Card images, delivered as sprite atlases: plain WebP images published as the artifact's own files
// (atlas/<n>.webp, fetched by relative path; see tools/bundle.ts). images-manifest.json v3 lists each atlas, its
// size, its cell size and the [col, row] of every printed code in it. A card's image is its cell drawn to a canvas
// and encoded to a blob: URL (cached per code), so the components keep plain <img> elements. Choice per object: the
// printing its owner imported -> the canonical id -> another base printing. While an atlas is loading, or if it is
// missing / a cell fails, the card keeps its text frame. Without a manifest there are no images (text frames).
// Decoded atlases (~20 MB of pixels each) are released after a few idle seconds; the compressed files are kept.
import type { CardId } from '../engine/types';
import type { CardRec } from './cards';

export type PrintMap = Record<CardId, string>;

const CODE_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** Printed codes come from deck imports and the network: only plain codes may name an image. */
export const safeCode = (c: unknown): string | null => {
  if (typeof c !== 'string') return null;
  const s = c.trim().toLowerCase();
  return CODE_RE.test(s) ? s : null;
};

interface Atlas {
  path: string; w: number; h: number; cw: number; ch: number;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  promise?: Promise<void>;
  blob?: Blob;                         // the compressed atlas file
  decoded?: Promise<Decoded>;          // pixels while cells are being cut (released when idle)
  users: number; lastUse: number;
  ms?: number;                         // fetch time
}
interface Decoded { src: CanvasImageSource; release: () => void }
interface Cell { atlas: Atlas; col: number; row: number }

interface ArtState {
  manifest: Set<string> | null;   // codes present in the atlases (null = no manifest: no images)
  cells: Map<string, Cell>;       // code -> its cell
  atlases: Map<string, Atlas>;    // atlas path -> state
  urls: Map<string, string>;      // code -> blob: URL of its cut-out image
  pending: Map<string, Promise<void>>; // code -> cutting in progress
  failed: Set<string>;            // codes whose atlas or cell failed
  loaded: Set<string>;            // codes decoded once by an <img> (re-renders don't flash)
  disabled: boolean;
}
export const art: ArtState = { manifest: null, cells: new Map(), atlases: new Map(), urls: new Map(), pending: new Map(), failed: new Set(), loaded: new Set(), disabled: false };

const ATLAS_PATH = /^atlas\/[0-9]{1,4}\.webp$/;
/** Only the artifact's own atlas/<n>.webp files (relative, same-origin). */
export const safeAtlasPath = (u: unknown): string | null => typeof u === 'string' && ATLAS_PATH.test(u) ? u : null;
const dim = (x: unknown, max = 16383) => typeof x === 'number' && Number.isInteger(x) && x > 0 && x <= max ? x : 0;

/** Load images-manifest.json if present ({format:'atlas', atlases: [{path, w, h, cell, codes}]}). Never throws. */
export async function loadImageManifest(): Promise<void> {
  try {
    const r = await fetch('images-manifest.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const j = await r.json() as { format?: unknown; atlases?: { path?: unknown; w?: unknown; h?: unknown; cell?: unknown; codes?: unknown }[] };
    if (!j || j.format !== 'atlas' || !Array.isArray(j.atlases)) return;
    const codes = new Set<string>();
    for (const x of j.atlases) {
      const path = safeAtlasPath(x.path), w = dim(x.w), h = dim(x.h);
      const cw = Array.isArray(x.cell) ? dim(x.cell[0], 2048) : 0, ch = Array.isArray(x.cell) ? dim(x.cell[1], 2048) : 0;
      if (!path || !w || !h || !cw || !ch || !x.codes || typeof x.codes !== 'object' || Array.isArray(x.codes)) continue;
      const a = art.atlases.get(path) ?? { path, w, h, cw, ch, status: 'idle', users: 0, lastUse: 0 };
      art.atlases.set(path, a);
      for (const [c, pos] of Object.entries(x.codes as Record<string, unknown>)) {
        const s = safeCode(c);
        if (!s || !Array.isArray(pos)) continue;
        const [col, row] = pos as unknown[];
        if (!Number.isInteger(col) || !Number.isInteger(row) || (col as number) < 0 || (row as number) < 0 || ((col as number) + 1) * cw > w || ((row as number) + 1) * ch > h) continue;
        codes.add(s); art.cells.set(s, { atlas: a, col: col as number, row: row as number });
      }
    }
    art.manifest = codes;
    art.disabled = codes.size === 0;
  } catch { /* no manifest: text frames */ }
}

/** Fetch an atlas file once. Resolves when ready or failed (never rejects). */
function loadAtlas(a: Atlas): Promise<void> {
  if (a.promise) return a.promise;
  a.status = 'loading';
  const t0 = performance.now();
  a.promise = (async () => {
    try {
      const r = await fetch(a.path);
      if (!r.ok) throw new Error(String(r.status));
      a.blob = await r.blob();
      a.status = 'ready';
    } catch { a.status = 'failed'; }
    a.ms = Math.round(performance.now() - t0);
  })();
  return a.promise;
}

const KEEP_DECODED_MS = 4000;
let sweeper: ReturnType<typeof setTimeout> | null = null;
/** Drop decoded pixels of atlases nobody has cut from for a while (the compressed blob stays). */
function sweep() {
  sweeper = null;
  const now = performance.now();
  let live = false;
  for (const a of art.atlases.values()) {
    if (!a.decoded) continue;
    if (a.users === 0 && now - a.lastUse > KEEP_DECODED_MS) { const d = a.decoded; a.decoded = undefined; void d.then(x => x.release(), () => {}); }
    else live = true;
  }
  if (live) sweeper = setTimeout(sweep, KEEP_DECODED_MS);
}

function decode(a: Atlas): Promise<Decoded> {
  if (!a.decoded) {
    const blob = a.blob!;
    a.decoded = (async (): Promise<Decoded> => {
      if (typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(blob);
        return { src: bmp, release: () => bmp.close() };
      }
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw e; }
      return { src: img, release: () => URL.revokeObjectURL(url) };
    })();
    a.decoded.catch(() => { a.decoded = undefined; });
    if (!sweeper) sweeper = setTimeout(sweep, KEEP_DECODED_MS);
  }
  return a.decoded;
}

/** Cut one cell out of its atlas into a blob: URL. */
async function cut(cell: Cell): Promise<string> {
  const a = cell.atlas;
  a.users++;
  try {
    const d = await decode(a);
    let blob: Blob | null;
    if (typeof OffscreenCanvas === 'function') {
      const cv = new OffscreenCanvas(a.cw, a.ch);
      const g = cv.getContext('2d'); if (!g) throw new Error('no 2d context');
      g.drawImage(d.src, cell.col * a.cw, cell.row * a.ch, a.cw, a.ch, 0, 0, a.cw, a.ch);
      blob = await cv.convertToBlob({ type: 'image/webp', quality: 0.92 });
    } else {
      const cv = document.createElement('canvas'); cv.width = a.cw; cv.height = a.ch;
      const g = cv.getContext('2d'); if (!g) throw new Error('no 2d context');
      g.drawImage(d.src, cell.col * a.cw, cell.row * a.ch, a.cw, a.ch, 0, 0, a.cw, a.ch);
      blob = await new Promise<Blob | null>(res => cv.toBlob(res, 'image/webp', 0.92));
    }
    if (!blob) throw new Error('encode failed');
    return URL.createObjectURL(blob);
  } finally { a.users--; a.lastUse = performance.now(); }
}

/** Make the blob: URL for a code (fetching its atlas if needed). Never rejects; failures land in art.failed. */
function ensure(code: string): Promise<void> {
  const busy = art.pending.get(code); if (busy) return busy;
  const cell = art.cells.get(code);
  if (!cell || art.urls.has(code) || art.failed.has(code)) return Promise.resolve();
  const p = (async () => {
    try {
      await loadAtlas(cell.atlas);
      if (cell.atlas.status !== 'ready') throw new Error('atlas unavailable');
      art.urls.set(code, await cut(cell));
    } catch { art.failed.add(code); }
    art.pending.delete(code);
  })();
  art.pending.set(code, p);
  return p;
}

/** blob: URL for a code: string = ready, '' = unavailable (no atlas / not in it / failed), null = not cut yet. */
export function urlFor(code: string): string | '' | null {
  const hit = art.urls.get(code); if (hit) return hit;
  if (art.failed.has(code)) return '';
  const cell = art.cells.get(code);
  if (!cell || cell.atlas.status === 'failed') return '';
  return null;
}

const isAlt = (code: string) => /^[a-z]+-(?:[a-z]*\d+)[a-z]+(?:-|$)/.test(code);

/** Image candidates for a card, best first (filtered by the manifest and known failures). */
export function imageCandidates(card: CardRec | undefined, printed?: string | null): string[] {
  if (!card || art.disabled) return [];
  const out: string[] = [];
  const add = (c: unknown) => { const s = safeCode(c); if (s && !out.includes(s)) out.push(s); };
  add(printed);
  add(card.id);
  const others = (card.printings ?? []).map(p => p.toLowerCase());
  const extra = [...others.filter(p => !isAlt(p)), ...others.filter(isAlt)];
  // with a manifest, any printing that has a cell; without one (no images are shown) only one extra guess
  if (art.manifest) for (const p of extra) add(p); else add(extra.find(p => !out.includes(p)));
  return out.filter(c => !art.failed.has(c) && (!art.manifest || art.manifest.has(c)));
}

export interface ImgOpts { printed?: string | null; eager?: boolean; landscape?: boolean }

/**
 * An <img> for the card, or null when no candidate can exist. Its parent card gets `has-img` once a source
 * is assigned and `img-ok` once decoded; until then (atlas still loading) the text frame stays visible.
 */
export function cardImg(card: CardRec | undefined, opts: ImgOpts = {}): HTMLImageElement | null {
  const cands = imageCandidates(card, opts.printed);
  if (!cands.length) return null;
  const img = document.createElement('img');
  img.className = 'c-img';
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  let cur = -1;
  const give = (i: number, url: string) => {
    cur = i;
    if (art.loaded.has(cands[i])) img.decoding = 'sync';
    img.dataset.code = cands[i];
    img.src = url;
    img.parentElement?.classList.add('has-img');
  };
  const drop = () => { const host = img.parentElement; img.remove(); host?.classList.remove('has-img', 'img-ok'); };
  /** Walk candidates from i: 'set' (assigned now), 'wait' (an atlas is loading / a cell being cut), 'none'. */
  const walk = (i: number): 'set' | 'wait' | 'none' => {
    for (; i < cands.length; i++) {
      const u = urlFor(cands[i]);
      if (u) { give(i, u); return 'set'; }
      if (u === null) {
        const at = i;
        void ensure(cands[i]).then(() => { if (walk(at) === 'none') drop(); });
        return 'wait';
      }
    }
    return 'none';
  };
  img.addEventListener('load', () => { if (cur >= 0) art.loaded.add(cands[cur]); img.parentElement?.classList.add('img-ok'); });
  img.addEventListener('error', () => {
    if (cur < 0) return;
    art.failed.add(cands[cur]);
    img.parentElement?.classList.remove('has-img', 'img-ok');
    if (walk(cur + 1) === 'none') drop();
  });
  return walk(0) === 'none' ? null : img;
}

/**
 * The cards of this game first: fetch their atlases and cut their cells, then fetch every other atlas file when
 * the page is idle (compressed only; cells are cut when a card needs them).
 */
export function warmArt(codes: Iterable<string>) {
  if (art.disabled) return;
  const want: string[] = [];
  for (const c of codes) { const s = safeCode(c); if (s && art.cells.has(s) && !want.includes(s)) want.push(s); }
  const first: Atlas[] = [];
  for (const c of want) { const a = art.cells.get(c)!.atlas; if (!first.includes(a)) first.push(a); }
  void (async () => {
    for (const a of first) { await loadAtlas(a); for (const c of want) if (art.cells.get(c)!.atlas === a) void ensure(c); }
    const idle = (f: () => void) => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
      if (ric) ric(f, { timeout: 5000 }); else setTimeout(f, 300);
    };
    const next = () => { const a = [...art.atlases.values()].find(x => x.status === 'idle'); if (a) void loadAtlas(a).then(() => idle(next)); };
    idle(next);
  })();
}

/** Sanitise a {cardId: printedCode} map from storage or the network. */
export function cleanPrintMap(x: unknown, max = 120): PrintMap | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out: PrintMap = {};
  let n = 0;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const kk = safeCode(k), vv = safeCode(v);
    if (!kk || !vv) continue;
    out[k] = vv;
    if (++n >= max) break;
  }
  return n ? out : undefined;
}

/** Resolve a remembered printing ("OGN-030a" from a deck code, or a full key) to a printings.json key for that card. */
export function resolvePrinted(raw: string | undefined | null, cardId: CardId, printings: Record<string, CardId>): string | null {
  const k = safeCode(raw);
  if (!k) return null;
  if (printings[k] === cardId) return k;
  return Object.keys(printings).find(p => p.startsWith(k + '-') && printings[p] === cardId) ?? null;
}
