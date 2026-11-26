// Minimal static server for dist/ (fetch() of cards.json doesn't work over file://). Serves the page, its data and
// the card-image atlases (dist/atlas/<n>.webp) the same way the artifact host serves the artifact's own files.
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
export async function serveDist(dir: string): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
  const server = createServer(async (req, res) => {
    const p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(dir, p === '/' ? 'index.html' : p);
    try { const body = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}/`, server, close: () => new Promise(r => server.close(() => r())) };
}
