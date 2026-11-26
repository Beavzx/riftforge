// SELFPLAY: training-data shards (.rfs). Workers write; python/riftzero/dataset.py reads.
//
// File:   header u32[4] = 0x31534652 "RFS1" | SHARD_VERSION | schemaHash | workerId
// Record: u32 recBytes (bytes that follow in this record)
//         u32 obsBytes | RFO1 observation frame (encode/wire.ts, obsBytes long, 4-aligned)
//         f32 z (game outcome for the observing player: +1 win, -1 loss, 0 draw, optionally points-shaped)
//         f32 q (search value of the root for the observing player)
//         u32 nA | f32 pi[nA] (search policy target over the frame's nA options)
// Shards are written as <name>.rfs.tmp and renamed to <name>.rfs when complete, so readers only see whole files.
import { closeSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { packObs, schemaHash } from '../encode/index.ts';
import type { EncodedActions, Observation } from '../encode/index.ts';

export const SHARD_MAGIC = 0x31534652, SHARD_VERSION = 1;

export interface Position { obs: Observation; acts: EncodedActions; actor: number; policy: Float32Array; q: number; z?: number }

export function encodeRecord(p: Position): Uint8Array {
  const frame = packObs(p.obs, p.acts, 0);
  const nA = p.policy.length;
  if (nA !== p.acts.n) throw new Error(`policy length ${nA} != options ${p.acts.n}`);
  const bytes = 4 + 4 + frame.byteLength + 4 + 4 + 4 + 4 * nA;
  const out = new Uint8Array(bytes);
  const dv = new DataView(out.buffer);
  let k = 0;
  dv.setUint32(k, bytes - 4, true); k += 4;
  dv.setUint32(k, frame.byteLength, true); k += 4;
  out.set(frame, k); k += frame.byteLength;
  dv.setFloat32(k, p.z ?? 0, true); k += 4;
  dv.setFloat32(k, p.q, true); k += 4;
  dv.setUint32(k, nA, true); k += 4;
  for (let i = 0; i < nA; i++, k += 4) dv.setFloat32(k, p.policy[i], true);
  return out;
}

export class ShardWriter {
  private fd: number | null = null;
  private path = '';
  private seq = 0;
  private games = 0;
  positions = 0;
  shardsWritten = 0;
  constructor(private dir: string, private workerId: number, private gamesPerShard: number) { mkdirSync(dir, { recursive: true }); }

  private open() {
    this.path = join(this.dir, `w${String(this.workerId).padStart(3, '0')}-${Date.now()}-${String(this.seq++).padStart(5, '0')}.rfs`);
    this.fd = openSync(this.path + '.tmp', 'w');
    const h = new Uint32Array([SHARD_MAGIC, SHARD_VERSION, schemaHash(), this.workerId]);
    writeSync(this.fd, new Uint8Array(h.buffer));
  }

  addGame(positions: Position[]) {
    if (!positions.length) return;
    if (this.fd === null) this.open();
    for (const p of positions) writeSync(this.fd!, encodeRecord(p));
    this.positions += positions.length;
    if (++this.games >= this.gamesPerShard) this.flush();
  }

  /** Close the current shard (if it has data) and publish it. */
  flush() {
    if (this.fd === null) return;
    closeSync(this.fd); this.fd = null;
    renameSync(this.path + '.tmp', this.path);
    this.games = 0; this.shardsWritten++;
  }
}
