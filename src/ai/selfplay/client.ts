// SELFPLAY: socket client for the Python inference server (python/riftzero/infer_server.py).
//
// Stream framing: every frame is preceded by a u32 little-endian byte length (encode/wire.ts withLength).
// Connection handshake (this file + infer_server.py are the only two implementations):
//   client → HELLO  u32[4]: 0x31484652 "RFH1" | PROTO_VERSION | schemaHash | clientId
//   server → ACK    u32[4]: 0x31414652 "RFA1" | status (0 ok, 1 schema mismatch, 2 protocol mismatch) | serverSchemaHash | nSlots
// Then the client pipelines RFO1 observation frames; the server answers each with an RFR1 result frame (any order), or
// an RFE1 error frame (u32[4] 0x31454652 | tag | msgBytes | 0, then the utf-8 message) when that request's batch failed:
// only that request is rejected (InferenceError), the connection stays up.
// The RFO1 `tag` word carries the request: bits 0-23 = request id, bits 24-31 = model slot (0 = latest, 1 = best,
// 2 = the pinned checkpoint under evaluation).
import net from 'node:net';
import { packObs, schemaHash, unpackResult, withLength } from '../encode/index.ts';
import type { EvalRequest, EvalResult, Evaluator } from './evaluator.ts';

/** The slot an evaluated network plays from: the pinned eval checkpoint (slot 2) when the server offers it. */
export function evalSlot(ev: Evaluator): number {
  return ev instanceof InferenceClient && ev.nSlots >= 3 ? SLOT_EVAL : SLOT_LATEST;
}

export const HELLO_MAGIC = 0x31484652, ACK_MAGIC = 0x31414652, ERR_MAGIC = 0x31454652, PROTO_VERSION = 1;
export const SLOT_LATEST = 0, SLOT_BEST = 1, SLOT_EVAL = 2;

/** The server could not evaluate this request (its batch failed). The connection is still usable. */
export class InferenceError extends Error { constructor(msg: string) { super(`inference server error: ${msg}`); this.name = 'InferenceError'; } }

export interface ClientOptions { host?: string; port?: number; path?: string; clientId?: number; connectTimeoutMs?: number; retries?: number }

export class InferenceClient implements Evaluator {
  count = 0;
  private sock!: net.Socket;
  private buf: Buffer = Buffer.alloc(0);
  private nextId = 1;
  private waiting = new Map<number, { resolve: (r: EvalResult) => void; reject: (e: Error) => void }>();
  private ackResolve: ((v: void) => void) | null = null;
  private ackReject: ((e: Error) => void) | null = null;
  private closed = false;
  nSlots = 1;

  private constructor(private o: ClientOptions) {}

  /** Connect (retrying while the server starts up) and complete the schema handshake. */
  static async connect(o: ClientOptions): Promise<InferenceClient> {
    const c = new InferenceClient(o);
    const retries = o.retries ?? 120;
    for (let attempt = 0; ; attempt++) {
      try { await c.open(); return c; } catch (e) {
        if ((e as Error & { fatal?: boolean }).fatal || attempt >= retries) throw e;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = this.o.path ? net.createConnection(this.o.path) : net.createConnection(this.o.port ?? 47000, this.o.host ?? '127.0.0.1');
      s.setNoDelay(true);
      const fail = (e: Error) => { s.destroy(); reject(e); };
      const timer = setTimeout(() => fail(new Error('inference server connect timeout')), this.o.connectTimeoutMs ?? 10000);
      s.once('error', e => { clearTimeout(timer); fail(e); });
      s.once('connect', () => {
        this.sock = s; this.buf = Buffer.alloc(0);
        s.removeAllListeners('error');
        s.on('data', (d: Buffer) => this.onData(d));
        s.on('error', e => this.failAll(e));
        s.on('close', () => this.failAll(new Error('inference server connection closed')));
        this.ackResolve = () => { clearTimeout(timer); resolve(); };
        this.ackReject = (e) => { clearTimeout(timer); reject(e); };
        const hello = new Uint32Array([HELLO_MAGIC, PROTO_VERSION, schemaHash(), this.o.clientId ?? 0]);
        s.write(withLength(new Uint8Array(hello.buffer)));
      });
    });
  }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0);
      if (this.buf.length < 4 + len) break;
      const frame = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      const magic = frame.readUInt32LE(0);
      if (magic === ACK_MAGIC) {
        const status = frame.readUInt32LE(4), serverHash = frame.readUInt32LE(8);
        this.nSlots = frame.readUInt32LE(12);
        if (status !== 0) {
          const msg = status === 1
            ? `SCHEMA MISMATCH: worker encoder schema ${schemaHash()} != server/model schema ${serverHash}. The model was trained with a different encoder; start a new run or re-export the schema.`
            : `PROTOCOL MISMATCH (status ${status})`;
          const e = Object.assign(new Error(msg), { fatal: true });
          this.ackReject?.(e); this.ackReject = this.ackResolve = null; this.sock.destroy(); return;
        }
        this.ackResolve?.(); this.ackResolve = this.ackReject = null;
        continue;
      }
      if (magic === ERR_MAGIC) {
        const id = frame.readUInt32LE(4) & 0xffffff, n = frame.readUInt32LE(8);
        const w = this.waiting.get(id);
        if (w) { this.waiting.delete(id); w.reject(new InferenceError(frame.subarray(16, 16 + n).toString('utf8'))); }
        continue;
      }
      const r = unpackResult(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
      const id = r.tag & 0xffffff;
      const w = this.waiting.get(id);
      if (w) { this.waiting.delete(id); w.resolve({ value: r.value, logits: r.logits }); }
    }
  }

  private failAll(e: Error) {
    if (this.closed) return;
    this.closed = true;
    this.ackReject?.(e);
    for (const w of this.waiting.values()) w.reject(e);
    this.waiting.clear();
  }

  evaluate(req: EvalRequest, slot = SLOT_LATEST): Promise<EvalResult> {
    if (this.closed) return Promise.reject(new Error('inference client closed'));
    const id = this.nextId; this.nextId = (this.nextId + 1) & 0xffffff || 1;
    const tag = ((slot & 0xff) << 24 | id) >>> 0;
    const frame = packObs(req.obs, req.acts, tag);
    this.count++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.sock.write(withLength(frame));
    });
  }

  get inFlight() { return this.waiting.size; }
  /** the connection is gone (server exited / restarted): every further evaluate() rejects at once */
  get isClosed() { return this.closed; }

  async close() { this.closed = true; this.sock?.end(); }
}
