// Thin, defensive wrapper over the page `room` capability. Only ever obtained via claude.use("room").
export interface RoomLike {
  emit(topic: string, data: unknown): unknown;
  on(topic: string, fn: (...args: unknown[]) => void): unknown;
  presence?(obj: unknown): unknown;
  onPeers?(fn: (peers: unknown) => void): unknown;
  join?(name: string): Promise<RoomLike> | RoomLike;
  leave?(): unknown;
}

let roomPromise: Promise<RoomLike | null> | null = null;

/** The page-level room, or null when the capability is unavailable (solo still works). */
export function getRoom(): Promise<RoomLike | null> {
  if (!roomPromise) {
    roomPromise = (async () => {
      try {
        const c = (globalThis as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
        if (!c || typeof c.use !== 'function') return null;
        const r = await Promise.race([c.use('room'), new Promise(res => setTimeout(() => res(null), 4000))]);
        return (r && typeof r === 'object' && typeof (r as RoomLike).emit === 'function') ? r as RoomLike : null;
      } catch { return null; }
    })();
  }
  return roomPromise;
}

export async function getDb(): Promise<{ get?: (k: string) => Promise<unknown>; set?: (k: string, v: unknown) => Promise<unknown> } | null> {
  try {
    const c = (globalThis as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    if (!c?.use) return null;
    return (await c.use('db')) as never;
  } catch { return null; }
}

export interface Channel {
  send(msg: Record<string, unknown>): void;
  onMessage(fn: (msg: Record<string, unknown>) => void): () => void;
  setPresence(p: Record<string, unknown>): void;
  onPeers(fn: (peers: Record<string, unknown>[]) => void): () => void;
  leave(): void;
}

const TOPIC = 'rf1';
const MAX_BYTES = 900_000;

/** Join a sub-room for a room code and expose a typed message channel. */
export async function openChannel(code: string): Promise<Channel | null> {
  const root = await getRoom();
  if (!root) return null;
  let sub: RoomLike = root;
  try { if (typeof root.join === 'function') sub = await root.join('riftforge-' + code.toUpperCase()); } catch { sub = root; }
  const msgFns = new Set<(m: Record<string, unknown>) => void>();
  const peerFns = new Set<(p: Record<string, unknown>[]) => void>();
  let active = true;
  const unwrap = (args: unknown[]): Record<string, unknown> | null => {
    for (const a of args) {
      if (a && typeof a === 'object') {
        const o = a as Record<string, unknown>;
        if (o.room === code.toUpperCase() && typeof o.t === 'string') return o;
        for (const k of ['data', 'payload', 'message', 'msg']) {
          const inner = o[k] as Record<string, unknown> | undefined;
          if (inner && typeof inner === 'object' && typeof inner.t === 'string' && inner.room === code.toUpperCase()) return inner;
        }
      } else if (typeof a === 'string' && a.length < MAX_BYTES) {
        try { const o = JSON.parse(a); if (o && o.room === code.toUpperCase() && typeof o.t === 'string') return o; } catch { /* ignore */ }
      }
    }
    return null;
  };
  try {
    sub.on(TOPIC, (...args: unknown[]) => {
      if (!active) return;
      const m = unwrap(args); if (!m) return;
      for (const f of msgFns) { try { f(m); } catch (e) { console.warn('[rf] handler error', e); } }
    });
  } catch (e) { console.warn('[rf] room.on failed', e); return null; }
  try {
    sub.onPeers?.((peers: unknown) => {
      if (!active) return;
      const list = Array.isArray(peers) ? peers : peers && typeof peers === 'object' ? Object.values(peers as object) : [];
      const pres = list.map(extractPresence).filter(Boolean) as Record<string, unknown>[];
      for (const f of peerFns) f(pres);
    });
  } catch { /* optional */ }
  return {
    send(msg) {
      if (!active) return;
      const m = { ...msg, room: code.toUpperCase() };
      try {
        const size = JSON.stringify(m).length;
        if (size > MAX_BYTES) { console.warn('[rf] message too large', size); return; }
        sub.emit(TOPIC, m);
      } catch (e) { console.warn('[rf] emit failed', e); }
    },
    onMessage(fn) { msgFns.add(fn); return () => msgFns.delete(fn); },
    setPresence(p) { try { sub.presence?.({ ...p, room: code.toUpperCase() }); } catch { /* ignore */ } },
    onPeers(fn) { peerFns.add(fn); return () => peerFns.delete(fn); },
    leave() {
      active = false; msgFns.clear(); peerFns.clear();
      try { if (sub !== root) sub.leave?.(); } catch { /* ignore */ }
    },
  };
}

function extractPresence(p: unknown): Record<string, unknown> | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  if (typeof o.cid === 'string') return o;
  for (const k of ['presence', 'state', 'data', 'meta', 'info']) {
    const inner = o[k] as Record<string, unknown> | undefined;
    if (inner && typeof inner === 'object' && typeof inner.cid === 'string') return inner;
  }
  return null;
}
