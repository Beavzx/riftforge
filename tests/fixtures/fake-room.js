// Fake `room` capability for tests: links pages of one browser context through BroadcastChannel.
// Injected with page.addInitScript before the app loads. Supports random message drops via window.__rfDrop (0..1).
(() => {
  const peers = new Map();
  function mkRoom(name) {
    const bc = new BroadcastChannel('fake-room:' + name);
    const handlers = new Map();
    const peerFns = new Set();
    const me = Math.random().toString(36).slice(2);
    let presence = null;
    const others = new Map();
    const notify = () => { const list = [...others.values()].map(x => x.p); if (presence) list.push(presence); peerFns.forEach(f => f(list)); };
    bc.onmessage = e => {
      const m = e.data;
      if (m.kind === 'msg') {
        if (Math.random() < (window.__rfDrop || 0)) return;
        (handlers.get(m.topic) || []).forEach(f => f(structuredClone(m.data), { from: m.from }));
      } else if (m.kind === 'presence') { others.set(m.from, { p: m.p, at: Date.now() }); notify(); }
      else if (m.kind === 'leave') { others.delete(m.from); notify(); }
    };
    setInterval(() => { if (presence) bc.postMessage({ kind: 'presence', from: me, p: presence }); for (const [k, v] of others) if (Date.now() - v.at > 5000) { others.delete(k); notify(); } }, 1000);
    return {
      emit(topic, data) { window.__rfSent = (window.__rfSent || 0) + 1; if (Math.random() < (window.__rfDrop || 0)) return; bc.postMessage({ kind: 'msg', topic, data: JSON.parse(JSON.stringify(data)), from: me }); },
      on(topic, fn) { if (!handlers.has(topic)) handlers.set(topic, []); handlers.get(topic).push(fn); },
      presence(p) { presence = p; bc.postMessage({ kind: 'presence', from: me, p }); notify(); },
      onPeers(fn) { peerFns.add(fn); },
      async join(sub) { return mkRoom(name + '/' + sub); },
      leave() { bc.postMessage({ kind: 'leave', from: me }); bc.close(); },
    };
  }
  const root = mkRoom('root');
  window.claude = { use: async (cap) => cap === 'room' ? root : null };
})();
