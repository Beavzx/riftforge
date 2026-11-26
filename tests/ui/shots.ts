// Screenshot helper: npx tsx tests/ui/shots.ts [hash...]  -> tests/ui/shots/*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { serveDist } from '../fixtures/serve';

const out = 'tests/ui/shots';
mkdirSync(out, { recursive: true });
const srv = await serveDist('dist');
const browser = await chromium.launch();
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['home'];
const theme = process.env.THEME ?? 'dark';
for (const t of targets) {
  for (const w of (process.env.WIDTHS ?? '1280,390').split(',').map(Number)) {
    const page = await browser.newPage({ viewport: { width: w, height: w < 600 ? 844 : 800 }, deviceScaleFactor: 1, hasTouch: w < 600 });
    page.on('console', m => { if (m.type() === 'error') console.log(`[${t}@${w}] console:`, m.text()); });
    page.on('pageerror', e => console.log(`[${t}@${w}] pageerror:`, e.message));
    await page.addInitScript(th => { try { localStorage.setItem('riftforge.theme', JSON.stringify(th)); } catch {} }, theme);
    const hash = t === 'home' ? '' : '#' + t;
    await page.goto(srv.url + hash);
    await page.waitForTimeout(t.startsWith('autoplay') ? 6000 : 900);
    const file = `${out}/${t}-${w}${theme === 'light' ? '-light' : ''}.png`;
    await page.screenshot({ path: file });
    console.log('wrote', file);
    await page.close();
  }
}
await browser.close(); await srv.close();
