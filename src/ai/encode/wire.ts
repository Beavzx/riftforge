// ENCODE: compact binary wire format between Node self-play workers and the Python inference server.
// Everything little-endian, 4-byte aligned. On a byte stream each frame is preceded by a u32 byte length
// (not counting the length word itself). python/riftnet/wire.py is the reader/writer on the Python side.
//
// Observation frame ("RFO1"), header = 11 x u32:
//   magic 0x314F4652 | version | schemaHash | tag | player | nE | nA | G | F | A | P
//   f32 global[G] | f32 entities[nE*F] | i32 cardIdx[nE] | f32 actions[nA*A] | i32 ptrIdx[nA*P] | i32 ptrRole[nA*P] | f32 ptrVal[nA*P]
// Result frame ("RFR1"), header = 4 x u32:
//   magic 0x31524652 | tag | nA | nExtra
//   f32 value | f32 logits[nA] | f32 extra[nExtra]
// `tag` is caller-defined (request id). schemaHash = schemaHash() (changes whenever any feature list changes).
import { ACTION, MAX_PTRS, type EncodedActions } from './actions.ts';
import { ENCODER_VERSION, ENTITY, GLOBAL, type Observation } from './obs.ts';
import { staticTable } from './cards.ts';

export const OBS_MAGIC = 0x314f4652;   // bytes "RFO1"
export const RES_MAGIC = 0x31524652;   // bytes "RFR1"
export const OBS_HEADER_WORDS = 11;
export const RES_HEADER_WORDS = 4;

let HASH: number | null = null;
/** FNV-1a over every feature name of every layout (+ version). */
export function schemaHash(): number {
  if (HASH !== null) return HASH;
  const s = [ENCODER_VERSION, MAX_PTRS, ...GLOBAL.names, '|', ...ENTITY.names, '|', ...ACTION.names, '|', ...staticTable().featureNames].join('\n');
  let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return HASH = h >>> 0;
}

export function obsFrameBytes(nE: number, nA: number): number {
  return 4 * (OBS_HEADER_WORDS + GLOBAL.dim + nE * ENTITY.dim + nE + nA * ACTION.dim + 3 * nA * MAX_PTRS);
}

/** Pack one observation + its encoded actions. With `out`, writes at `offset` (no length prefix) and returns bytes written. */
export function packObs(o: Observation, a: EncodedActions, tag = 0, out?: Uint8Array, offset = 0): Uint8Array {
  const nE = o.nEntities, nA = a.n, bytes = obsFrameBytes(nE, nA);
  const buf = out ?? new Uint8Array(bytes);
  if (buf.byteLength - offset < bytes) throw new Error('packObs: buffer too small');
  if ((buf.byteOffset + offset) % 4) throw new Error('packObs: unaligned offset');
  const u = new Uint32Array(buf.buffer, buf.byteOffset + offset, bytes / 4);
  const f = new Float32Array(buf.buffer, buf.byteOffset + offset, bytes / 4);
  const i32 = new Int32Array(buf.buffer, buf.byteOffset + offset, bytes / 4);
  u.set([OBS_MAGIC, ENCODER_VERSION, schemaHash(), tag >>> 0, o.player, nE, nA, GLOBAL.dim, ENTITY.dim, ACTION.dim, MAX_PTRS]);
  let k = OBS_HEADER_WORDS;
  f.set(o.global, k); k += GLOBAL.dim;
  f.set(o.entities, k); k += nE * ENTITY.dim;
  i32.set(o.cardIdx, k); k += nE;
  f.set(a.feats, k); k += nA * ACTION.dim;
  i32.set(a.ptrIdx, k); k += nA * MAX_PTRS;
  i32.set(a.ptrRole, k); k += nA * MAX_PTRS;
  f.set(a.ptrVal, k); k += nA * MAX_PTRS;
  return out ? buf.subarray(offset, offset + bytes) : buf;
}

export interface UnpackedObs {
  tag: number; player: number; nE: number; nA: number;
  global: Float32Array; entities: Float32Array; cardIdx: Int32Array;
  actions: Float32Array; ptrIdx: Int32Array; ptrRole: Int32Array; ptrVal: Float32Array;
}
export function unpackObs(buf: Uint8Array): UnpackedObs {
  const u = new Uint32Array(buf.buffer, buf.byteOffset, OBS_HEADER_WORDS);
  if (u[0] !== OBS_MAGIC) throw new Error('unpackObs: bad magic');
  if (u[2] !== schemaHash()) throw new Error(`unpackObs: schema hash ${u[2]} != ${schemaHash()}`);
  const [, , , tag, player, nE, nA, G, F, A, P] = u;
  let k = buf.byteOffset + OBS_HEADER_WORDS * 4;
  const take = <T>(C: { new (b: ArrayBufferLike, o: number, n: number): T }, n: number): T => { const v = new C(buf.buffer, k, n); k += 4 * n; return v; };
  return {
    tag, player, nE, nA,
    global: take(Float32Array, G), entities: take(Float32Array, nE * F), cardIdx: take(Int32Array, nE),
    actions: take(Float32Array, nA * A), ptrIdx: take(Int32Array, nA * P), ptrRole: take(Int32Array, nA * P), ptrVal: take(Float32Array, nA * P),
  };
}

/** Length-prefixed stream framing. */
export function withLength(frame: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + frame.byteLength);
  new DataView(out.buffer).setUint32(0, frame.byteLength, true); out.set(frame, 4); return out;
}

export function packResult(tag: number, value: number, logits: ArrayLike<number>, extra: ArrayLike<number> = []): Uint8Array {
  const n = RES_HEADER_WORDS + 1 + logits.length + extra.length;
  const buf = new Uint8Array(4 * n); const u = new Uint32Array(buf.buffer); const f = new Float32Array(buf.buffer);
  u.set([RES_MAGIC, tag >>> 0, logits.length, extra.length]); f[RES_HEADER_WORDS] = value;
  f.set(logits, RES_HEADER_WORDS + 1); f.set(extra, RES_HEADER_WORDS + 1 + logits.length);
  return buf;
}
export function unpackResult(buf: Uint8Array): { tag: number; value: number; logits: Float32Array; extra: Float32Array } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== RES_MAGIC) throw new Error('unpackResult: bad magic');
  const tag = dv.getUint32(4, true), nA = dv.getUint32(8, true), nX = dv.getUint32(12, true);
  const f = new Float32Array(buf.buffer.slice(buf.byteOffset + 16, buf.byteOffset + 16 + 4 * (1 + nA + nX)));
  return { tag, value: f[0], logits: f.subarray(1, 1 + nA), extra: f.subarray(1 + nA) };
}
