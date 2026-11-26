// Card images: candidate order (imported printing -> canonical -> other printing), code safety, the sprite atlases
// (dist/atlas/<n>.webp + images-manifest.json v3, every cell checked against data/images), the bundle's card
// scripts, and in the browser: images are cut from the atlases onto the board (right cell, imported alt-art printing
// shown), only the page's own atlas files are fetched, and missing atlases fall back to the text frame.
// Run: node --import tsx --test tests/ui/art.test.ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import { chromium, type Browser } from 'playwright';
import { art, imageCandidates, safeCode, cleanPrintMap, safeAtlasPath } from '../../src/ui/art';
import { isPrintMap } from '../../src/net/protocol';
import type { CardRec } from '../../src/ui/cards';
import { serveDist } from '../fixtures/serve';

const card = { id: 'rad-r01', name: 'Fury Rune', printings: ['rad-r01a', 'rad-r01', 'ven-r01', 'ogn-007a-298', 'ogn-007-298'] } as unknown as CardRec;

test('candidates: printed code first, then canonical, then one base printing (no manifest)', () => {
  art.manifest = null; art.failed.clear();
  assert.deepEqual(imageCandidates(card, 'ogn-007a-298'), ['ogn-007a-298', 'rad-r01', 'ven-r01']);
  assert.deepEqual(imageCandidates(card), ['rad-r01', 'ven-r01']);
  art.failed.add('rad-r01');
  assert.deepEqual(imageCandidates(card), ['ven-r01']);
  art.failed.clear();
});

test('candidates: with a manifest only existing files, any printing', () => {
  art.manifest = new Set(['ogn-007-298', 'ogn-007a-298']);
  assert.deepEqual(imageCandidates(card, 'rad-r01a'), ['ogn-007-298', 'ogn-007a-298']);
  assert.deepEqual(imageCandidates(card, 'ogn-007a-298'), ['ogn-007a-298', 'ogn-007-298']);
  art.manifest = null;
});

test('printed codes are sanitised before becoming paths', () => {
  assert.equal(safeCode('OGN-030a-298'), 'ogn-030a-298');
  for (const bad of ['../x', 'a/b', 'https://x.y/z', '', 'a b', 'x.webp', 42]) assert.equal(safeCode(bad), null, String(bad));
  assert.deepEqual(cleanPrintMap({ 'ogn-030-298': 'ogn-030a-298', bad: '../../etc' }), { 'ogn-030-298': 'ogn-030a-298' });
  assert.equal(isPrintMap({ 'ogn-030-298': 'ogn-030a-298' }), true);
  assert.equal(isPrintMap({ 'ogn-030-298': '../x' }), false);
  // atlas paths: the page's own atlas/<n>.webp files only
  assert.equal(safeAtlasPath('atlas/0.webp'), 'atlas/0.webp');
  assert.equal(safeAtlasPath('atlas/39.webp'), 'atlas/39.webp');
  for (const bad of ['https://evil.example/atlas/0.webp', '//evil.example/atlas/0.webp', '/_blob/abc123', 'atlas/../x.webp', '../atlas/0.webp', 'images/ogn.zip', 'atlas/0.png', 'javascript:alert(1)', '/atlas/0.webp', 7]) assert.equal(safeAtlasPath(bad), null, String(bad));
});

let browser: Browser; let srv: Awaited<ReturnType<typeof serveDist>>;
before(async () => {
  execSync('npx tsx tools/bundle.ts', { stdio: 'inherit' });
  srv = await serveDist('dist');
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await srv?.close(); });

const hasPack = existsSync('dist/images-manifest.json');
type Manifest = { format: string; v: number; count: number; totalBytes: number; atlases: { path: string; w: number; h: number; cell: [number, number]; bytes: number; count: number; codes: Record<string, [number, number]> }[] };
const manifest = (): Manifest => JSON.parse(readFileSync('dist/images-manifest.json', 'utf8'));

/** Mean absolute difference per channel between two same-size RGB buffers. */
const mad = (a: Buffer, b: Buffer) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };
const thumb = (img: ReturnType<typeof sharp>, w: number, h: number) => img.resize(w, h, { fit: 'fill' }).flatten({ background: '#000' }).removeAlpha().raw().toBuffer();

test('atlases: plain webp images, every source image in exactly one cell, right picture in each cell', { skip: !hasPack && 'no images', timeout: 120_000 }, async () => {
  const m = manifest();
  assert.equal(m.format, 'atlas'); assert.equal(m.v, 3);
  assert.ok(m.atlases.length >= 1 && m.atlases.length <= 200, `${m.atlases.length} atlases (one publish call takes 256 files)`);
  const seen = new Map<string, string>();
  let total = 0;
  for (const a of m.atlases) {
    assert.ok(safeAtlasPath(a.path), a.path);
    const buf = readFileSync('dist/' + a.path);
    assert.equal(buf.length, a.bytes); total += buf.length;
    assert.ok(buf.length <= 3 * 1024 * 1024, `${a.path} is ${buf.length} bytes (max 3 MB)`);
    const meta = await sharp(buf).metadata();
    assert.equal(meta.format, 'webp'); assert.equal(meta.width, a.w); assert.equal(meta.height, a.h);
    assert.ok(a.cell[0] === 320 && a.cell[1] === 447 || a.cell[0] === 447 && a.cell[1] === 320, String(a.cell));
    assert.equal(Object.keys(a.codes).length, a.count);
    const used = new Set<string>();
    for (const [code, [c, r]] of Object.entries(a.codes)) {
      assert.ok(safeCode(code) === code, code);
      assert.ok(!seen.has(code), `${code} in ${seen.get(code)} and ${a.path}`); seen.set(code, a.path);
      assert.ok((c + 1) * a.cell[0] <= a.w && (r + 1) * a.cell[1] <= a.h, `${code} cell in bounds`);
      assert.ok(!used.has(c + ',' + r), `${a.path} cell ${c},${r} used twice`); used.add(c + ',' + r);
    }
    // the right picture in each cell: a 16x22 thumbnail of each cell is close to its own source image and closer to
    // it than to any other source in the atlas (lossy re-encoding and resampling noise stay well under 12/255)
    const [cw, ch] = a.cell, [tw, th] = cw < ch ? [16, 22] : [22, 16];
    const raw = await sharp(buf).removeAlpha().raw().toBuffer();
    const srcs = new Map<string, Buffer>();
    for (const code of Object.keys(a.codes)) if (existsSync(`data/images/${code}.webp`)) srcs.set(code, await thumb(sharp(`data/images/${code}.webp`), tw, th));
    for (const [code, [c, r]] of Object.entries(a.codes)) {
      const mine = srcs.get(code); if (!mine) continue;
      const cell = await thumb(sharp(raw, { raw: { width: a.w, height: a.h, channels: 3 } }).extract({ left: c * cw, top: r * ch, width: cw, height: ch }), tw, th);
      const d = mad(cell, mine);
      assert.ok(d < 12, `${code} in ${a.path} [${c},${r}] differs from its source by ${d.toFixed(1)}`);
      for (const [other, b] of srcs) if (other !== code) assert.ok(d < mad(cell, b), `${code} in ${a.path} [${c},${r}] looks more like ${other}`);
    }
  }
  assert.equal(total, m.totalBytes);
  assert.ok(total < 40 * 1024 * 1024, `atlases total ${(total / 1048576).toFixed(1)} MB`);
  const sources = readdirSync('data/images').filter(f => f.endsWith('.webp')).map(f => f.slice(0, -5));
  for (const c of sources) assert.ok(seen.has(c), `${c} missing from the atlases`);
  assert.equal(m.count, seen.size);
});

test('no zips or asset (/_blob/) urls anywhere in the build', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
  const files = walk('dist');
  assert.deepEqual(files.filter(f => !/^dist\/(index\.html|app\.js|cards\.json|images-manifest\.json|atlas\/\d+\.webp)$/.test(f)), []);
  const js = readFileSync('dist/app.js', 'utf8');
  assert.ok(!js.includes('/_blob/'), 'app.js mentions /_blob/');
  assert.ok(!/\.zip\b/.test(js), 'app.js mentions .zip');
  if (hasPack) assert.ok(!readFileSync('dist/images-manifest.json', 'utf8').includes('_blob'));
});

test('the bundled app registers the card scripts (>1000)', { timeout: 60_000 }, async () => {
  const page = await browser.newPage();
  await page.goto(srv.url);
  const info = await page.waitForFunction(() => (globalThis as any).__riftforgeInfo).then(h => h.jsonValue()) as { engine: string; scripts: number };
  assert.equal(info.engine, 'engine');
  assert.ok(info.scripts > 1000, `only ${info.scripts} card scripts in dist/app.js`);
  await page.close();
});

test('board shows card images; the imported alt-art printing is used', { skip: !hasPack && 'no images', timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url + '#autoplay-bot-100000');
  await page.waitForFunction(() => (globalThis as any).__riftforge?.board?.view);
  await page.waitForSelector('.table .card.img-ok', { timeout: 10_000 });
  // relaunch with alt-art printings for every card of seat 0 that has one
  const alts = await page.evaluate(async () => {
    const r = (globalThis as any).__riftforge; const app = r.app;
    const s = r.session.state; const map: Record<string, string> = {};
    for (const o of Object.values(s.objects) as any[]) {
      if (o.owner !== 0) continue;
      const c = app.db.byId[o.cardId]; if (!c) continue;
      const altCode = (c.printings as string[]).find(p => /^[a-z]+-[a-z]*\d+[a-z]+(-|$)/.test(p) && p !== o.cardId);
      if (altCode) map[o.cardId] = altCode;
    }
    app.lastLocal.printings = [map, undefined];
    app.launchLocal(20);
    // play seat 0 (bot suggestions) until some runes are channelled (the starter alt arts are runes)
    for (let i = 0; i < 600; i++) {
      const g = (globalThis as any).__riftforge; const v = g.board.view;
      if (v && v.state.players[0].runesInPlay.length >= 2) break;
      if (v?.pending?.player === 0) { const a = g.session.suggest(); if (a) await g.board.act(a); }
      await new Promise(res => setTimeout(res, 25));
    }
    return Object.values(map);
  });
  assert.ok(alts.length > 0, 'starter deck has cards with alt-art printings');
  // the cut-out images are whole cards (portrait 320x447, battlefields 447x320) showing the right picture
  const shown = await page.evaluate(() => [...document.querySelectorAll('.table .card.img-ok img.c-img')].slice(0, 12).map(i => {
    const img = i as HTMLImageElement; const land = img.naturalWidth > img.naturalHeight;
    const [w, h] = land ? [22, 16] : [16, 22];
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d')!; g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data; const rgb: number[] = [];
    for (let k = 0; k < d.length; k += 4) rgb.push(d[k], d[k + 1], d[k + 2]);
    return { code: img.dataset.code!, nw: img.naturalWidth, nh: img.naturalHeight, rgb };
  }));
  assert.ok(shown.length >= 3, `${shown.length} images on the board`);
  const srcs = new Map<string, Buffer>();
  for (const s of shown) srcs.set(s.code, await thumb(sharp(`data/images/${s.code}.webp`), ...(s.nw > s.nh ? [22, 16] : [16, 22]) as [number, number]));
  for (const s of shown) {
    assert.ok(s.nw === 320 && s.nh === 447 || s.nw === 447 && s.nh === 320, `${s.code} is ${s.nw}x${s.nh}`);
    const px = Buffer.from(s.rgb), d = mad(px, srcs.get(s.code)!);
    assert.ok(d < 14, `${s.code} on the board differs from its source by ${d.toFixed(1)}`);
    for (const [other, b] of srcs) if (other !== s.code && b.length === px.length) assert.ok(d < mad(px, b), `${s.code} on the board looks more like ${other}`);
  }
  // zoom shows the big image plus the parsed rules text
  await page.locator('.mat.me .z-legend .card').hover();
  await page.waitForSelector('.preview .card.size-xl.has-img');
  assert.ok(await page.locator('.preview .zoom-text .z-name').count());
  assert.deepEqual(errors, []);
  await page.close();
});

test('only the page\'s own atlas files are fetched; the game\'s atlases come first', { skip: !hasPack && 'no images', timeout: 60_000 }, async () => {
  const m = manifest() as Manifest & { atlases: unknown[] };
  // hostile entries are ignored: off-origin, asset urls, traversal, wrong type
  for (const path of ['https://evil.example/atlas/0.webp', '/_blob/abc123', '../atlas/0.webp', 'images/ogn.zip'])
    m.atlases.push({ path, w: 320, h: 447, cell: [320, 447], codes: { 'ogn-001-298': [0, 0] } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const hits: string[] = [];
  ctx.on('request', r => hits.push(r.url()));
  await ctx.route('**/images-manifest.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m) }));
  await ctx.route('https://evil.example/**', r => r.abort());
  const page = await ctx.newPage();
  await page.goto(srv.url + '#autoplay-bot-100000');
  await page.waitForSelector('.table .card.img-ok', { timeout: 10_000 });
  await page.waitForTimeout(500);
  const own = hits.filter(u => u.startsWith(srv.url));
  assert.ok(!hits.some(u => /evil\.example|_blob|\.zip/.test(u)), hits.filter(u => /evil|_blob|zip/.test(u)).join(','));
  const atl = own.filter(u => u.includes('/atlas/'));
  assert.ok(atl.length > 0 && atl.every(u => /^atlas\/\d+\.webp$/.test(u.slice(srv.url.length))), atl.join(','));
  // the first atlas fetched holds a card of this game
  const codes = await page.evaluate(() => [...document.querySelectorAll('.table img.c-img')].map(i => (i as HTMLImageElement).dataset.code));
  const firstPath = atl[0].slice(srv.url.length);
  const first = (manifest().atlases.find(a => a.path === firstPath))!;
  assert.ok(codes.some(c => c && c in first.codes), `${firstPath} has none of ${codes.join(',')}`);
  await ctx.close();
});

test('missing atlases fall back to the text frame', { skip: !hasPack && 'no images', timeout: 60_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**/atlas/**', r => r.fulfill({ status: 404, body: 'nope' }));
  const page = await ctx.newPage();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url + '#autoplay-bot-100000');
  await page.waitForFunction(() => (globalThis as any).__riftforge?.board?.view);
  await page.waitForFunction(() => document.querySelectorAll('.table .card').length > 3 && !document.querySelector('.table .card.has-img'), null, { timeout: 10_000 });
  assert.ok(await page.locator('.table .card .c-frame').first().isVisible());
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no manifest: text frames, no image requests', { timeout: 60_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**/images-manifest.json', r => r.fulfill({ status: 404, body: 'nope' }));
  const hits: string[] = []; ctx.on('request', r => hits.push(r.url()));
  const page = await ctx.newPage();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url + '#autoplay-bot-100000');
  await page.waitForFunction(() => (globalThis as any).__riftforge?.board?.view);
  await page.waitForFunction(() => document.querySelectorAll('.table .card').length > 3 && !document.querySelector('.table .card.has-img'), null, { timeout: 10_000 });
  assert.ok(await page.locator('.table .card .c-frame').first().isVisible());
  assert.deepEqual(hits.filter(u => /atlas|\.webp|\.zip/.test(u)), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});
