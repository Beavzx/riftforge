// TS client ↔ Python inference server (mock backend): handshake, batched round trips, schema mismatch rejection.
// Needs python3 with numpy + pyyaml; skipped otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evalSlot, InferenceClient, InferenceError, SLOT_EVAL } from '../../../src/ai/selfplay/client.ts';
import net from 'node:net';
import { encodeActions, encodeObservation } from '../../../src/ai/encode/index.ts';
import { getLegalActions } from '../../../src/engine/index.ts';
import { samplePositions } from './_util.ts';

const ROOT = join(import.meta.dirname, '../../..');
// the repo's venv (scripts/setup.sh) when present, like scripts/*.sh; else the system python
const VENV_PY = join(ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const PY = existsSync(VENV_PY) ? VENV_PY : process.platform === 'win32' ? 'python' : 'python3';
const hasPy = spawnSync(PY, ['-c', 'import numpy, yaml'], { encoding: 'utf8' }).status === 0;

function makeRun(mutateHash = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'rfrun-'));
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'tools/train-schema.ts'), '--out', dir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  if (mutateHash) {
    const s = JSON.parse(readFileSync(join(dir, 'schema.json'), 'utf8')); s.schemaHash = (s.schemaHash + 1) >>> 0;
    writeFileSync(join(dir, 'schema.json'), JSON.stringify(s));
  }
  const cfg = spawnSync(PY, ['-c', `import json,sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, 'python'))}); from riftzero.config import DEFAULTS; print(json.dumps(DEFAULTS))`], { encoding: 'utf8' });
  writeFileSync(join(dir, 'config.json'), cfg.stdout);
  return dir;
}

/** A free TCP port (tests never use fixed ports: a run may be active on the machine). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.unref(); s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
}

async function startServer(dir: string, port: number, extra: string[] = []): Promise<ChildProcess> {
  const p = spawn(PY, ['-m', 'riftzero.infer_server', '--run', dir, '--port', String(port), '--backend', 'mock', ...extra],
    { cwd: ROOT, env: { ...process.env, PYTHONPATH: join(ROOT, 'python') }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    p.stdout!.on('data', d => { if (String(d).includes('serving')) { clearTimeout(t); resolve(); } });
    p.on('exit', c => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
  return p;
}

test('client ↔ mock server: handshake and 500 pipelined requests on two slots', { skip: !hasPy && 'python3 with numpy+pyyaml not available' }, async () => {
  const dir = makeRun(); const port = await freePort();
  const srv = await startServer(dir, port);
  try {
    const c = await InferenceClient.connect({ port, retries: 5 });
    const gs = samplePositions(3, 5);
    const reqs = gs.map(g => { const p = g.pending!.player; const legal = getLegalActions(g, p); const obs = encodeObservation(g, p); return { obs, acts: encodeActions(g, p, legal, obs), n: legal.length }; });
    const res = await Promise.all(Array.from({ length: 500 }, (_, i) => c.evaluate(reqs[i % reqs.length], i % 2)));
    res.forEach((r, i) => { assert.equal(r.logits.length, reqs[i % reqs.length].n); assert.equal(r.value, 0); });
    await c.close();
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('server refuses a worker whose encoder schema differs (loud, fatal)', { skip: !hasPy && 'python3 with numpy+pyyaml not available' }, async () => {
  const dir = makeRun(true); const port = await freePort();
  const srv = await startServer(dir, port);
  try {
    await assert.rejects(InferenceClient.connect({ port, retries: 3 }), /SCHEMA MISMATCH/);
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
});

function sampleReq() {
  const g = samplePositions(4, 1)[0]; const p = g.pending!.player; const legal = getLegalActions(g, p);
  const obs = encodeObservation(g, p); return { obs, acts: encodeActions(g, p, legal, obs), n: legal.length };
}

test('a failed batch rejects only its requests (InferenceError); the connection keeps working', { skip: !hasPy && 'python3 with numpy+pyyaml not available' }, async () => {
  const dir = makeRun(); const port = await freePort();
  const srv = await startServer(dir, port, ['--mock-fail-first', '1']);
  try {
    const c = await InferenceClient.connect({ port, retries: 5 });
    const req = sampleReq();
    await assert.rejects(c.evaluate(req), (e: unknown) => e instanceof InferenceError && /injected failure/.test((e as Error).message));
    const ok = await c.evaluate(req);
    assert.equal(ok.logits.length, req.n);
    assert.equal(c.isClosed, false);
    await c.close();
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('eval plays the pinned slot 2; requests are routed by slot', { skip: !hasPy && 'python3 with numpy+pyyaml not available' }, async () => {
  const dir = makeRun(); const port = await freePort();
  const srv = await startServer(dir, port, ['--mock-slot-value']);
  try {
    const c = await InferenceClient.connect({ port, retries: 5 });
    assert.equal(c.nSlots, 3);
    assert.equal(evalSlot(c), SLOT_EVAL);
    const req = sampleReq();
    const vals = await Promise.all([0, 1, 2].map(slot => c.evaluate(req, slot)));
    assert.deepEqual(vals.map(v => Math.round(v.value * 10)), [0, 1, 2]);
    await c.close();
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('client reports a lost server (isClosed) so a worker can exit and be restarted', { skip: !hasPy && 'python3 with numpy+pyyaml not available' }, async () => {
  const dir = makeRun(); const port = await freePort();
  const srv = await startServer(dir, port);
  try {
    const c = await InferenceClient.connect({ port, retries: 5 });
    srv.kill();
    await new Promise(r => setTimeout(r, 500));
    assert.equal(c.isClosed, true);
    await assert.rejects(c.evaluate(sampleReq()), /closed/);
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
});
