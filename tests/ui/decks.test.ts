// Deck import/export, deck codes, starter decks, protocol validation, host/guest sync (no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDb } from '../../src/ui/cards';
import { parseDeckText, deckToText, starterDecks } from '../../src/ui/decks';
import { decodeRaw, decodeDeckCode, encodeDeckCode } from '../../src/ui/deckcode';
import { validateDeck } from '../../src/ui/engine';
import { parseMsg, isAction, isView, packView, unpackView } from '../../src/net/protocol';
import * as E from '../../src/ui/engine';

const db = buildDb(JSON.parse(readFileSync('data/cards.json', 'utf8')));
const V2 = 'CIAAAAAAAAAQCAAAA4AACAIAABMQAAILAAAAICIMDMOVOX3AM5UHIAIDAAACO6XYAEAQKAAABX3QDGACUABKIAQAAEBQAAAWDBOQCAQAABMHE';
const V3 = 'CMAAAAAAAAAQCAAAA4AACAIAACTACAABBMAAABAYDMSCPKABVUA3AANWAG3QDOIBAIAQAAANAEAQACYCAUAAAHNJAGRAFJACVIBAEAIABIIQAAIDAAAKSANMAG2ACAICAAAB2IYBAEAAU';
const fmt = (l: { card: { code: string }; count: number }[]) => l.map(e => `${e.count}x${e.card.code}`).join(' ');

test('deck code V2 test vector decodes (docs/deck-formats.md §2.5)', () => {
  const r = decodeRaw(V2);
  assert.equal(r.version, 2);
  assert.equal(fmt(r.main), '7xOGN-007 5xOGN-089 3xOGN-004 3xOGN-009 3xOGN-012 3xOGN-027 3xOGN-029 3xOGN-087 3xOGN-095 3xOGN-096 3xOGN-103 3xOGN-104 3xOGN-116 2xOGN-039 2xOGN-122 2xOGN-248 1xOGN-013 1xOGN-247 1xOGN-280 1xOGN-288 1xOGN-292');
  assert.equal(fmt(r.side), '2xOGN-022 2xOGN-024 2xOGN-093 1xOGN-088 1xOGN-114');
});

test('deck code V3 test vector decodes, classifies by type, and re-encodes identically', () => {
  const r = decodeRaw(V3);
  assert.equal(r.version, 3);
  assert.equal(r.champion?.code, 'OGS-010');
  assert.equal(fmt(r.side), '2xOGN-169 2xOGN-172 2xOGN-180 1xOGN-029 1xOGN-035');
  const p = decodeDeckCode(V3, db)!;
  assert.deepEqual(p.errors, []);
  assert.equal(db.byId[p.deck.legend].type, 'Legend');
  assert.equal(p.deck.battlefields.length, 3);
  assert.equal(p.deck.runes.length, 12);
  assert.equal(p.deck.main.length + 1, 40);
  assert.equal(db.byId[p.deck.champion].name, 'Annie');
  const enc = encodeDeckCode(p.deck, db, p.printings);
  assert.deepEqual(enc.skipped, []);
  assert.equal(enc.code, V3);
  assert.ok(validateDeck(p.deck, db.byId).ok, validateDeck(p.deck, db.byId).errors.join('; '));
  // without remembered printings, still a valid code that decodes to the same deck
  const again = decodeDeckCode(encodeDeckCode(p.deck, db).code, db)!;
  assert.deepEqual([...again.deck.main].sort(), [...p.deck.main].sort());
  assert.equal(again.deck.champion, p.deck.champion);
  assert.deepEqual([...again.deck.runes].sort(), [...p.deck.runes].sort());
});

test('text deck lists: sectioned, unsectioned, x-counts, codes, TTS', () => {
  const t = `Name: Test\nLegend:\n1 Dark Child\n\nChampion:\n1 Annie, Fiery\n\nMainDeck:\n3x Firestorm\nIncinerate x3\n2 OGN-001\n1 Cleave (OGN-004)\n\nBattlefields:\n1 Altar to Unity\n\nRune Pool:\n6 Fury Rune\n6 Chaos Rune\n\nSideboard:\n2 Gust`;
  const r = parseDeckText(t, db);
  assert.deepEqual(r.errors, []);
  assert.equal(r.name, 'Test');
  assert.equal(db.byId[r.deck.legend].name, 'Dark Child');
  assert.equal(db.byId[r.deck.champion].name, 'Annie');
  assert.equal(r.deck.main.length, 9);
  assert.equal(r.deck.runes.length, 12);
  assert.equal(r.deck.sideboard!.length, 2);
  // round trip through export text
  const back = parseDeckText(deckToText(r.deck, db, 'Test'), db);
  assert.deepEqual([...back.deck.main].sort(), [...r.deck.main].sort());
  assert.equal(back.deck.champion, r.deck.champion);
  // unsectioned infers legend/runes/battlefields/champion by type
  const u = parseDeckText('1 Dark Child\n1 Annie, Fiery\n3 Firestorm\n12 Fury Rune\n1 Altar to Unity', db);
  assert.equal(db.byId[u.deck.legend].type, 'Legend');
  assert.equal(db.byId[u.deck.champion].name, 'Annie');
  assert.equal(u.deck.runes.length, 12);
  // TTS
  const tts = parseDeckText('OGN-004-1 OGN-004-2 OGN-007-1', db);
  assert.equal(tts.deck.main.length, 2); assert.equal(tts.deck.runes.length, 1);
  // unknown
  assert.ok(parseDeckText('3 Definitely Not A Card', db).errors.length === 1);
});

test('starter decks are legal per the engine validator', () => {
  const st = starterDecks(db);
  assert.ok(st.length >= 4);
  for (const d of st) { const v = validateDeck(d.deck, db.byId); assert.ok(v.ok, d.name + ': ' + v.errors.join('; ')); }
});

test('protocol rejects malformed / hostile messages', () => {
  assert.equal(parseMsg({ t: 'act', cid: 'x', gid: 'g', seq: 1, ver: 0, action: { type: 'rm -rf', player: 0 } } as never), null);
  assert.equal(parseMsg({ t: 'act', cid: 'x', gid: 'g', seq: -1, ver: 0, action: { type: 'pass', player: 1 } } as never), null);
  assert.equal(parseMsg({ t: 'view', cid: 'x', gid: 'g', to: 'y', ver: 0, ack: 0, view: { you: 7 } } as never), null);
  assert.equal(parseMsg({ t: 'hello', cid: 'x'.repeat(500), name: 'a', v: 1 } as never), null);
  assert.ok(isAction({ type: 'move', player: 1, units: ['o1'], to: 'base' }));
  assert.ok(!isAction({ type: 'move', player: 1, units: ['o1'], to: 'moon' }));
});

test('redacted views survive the wire and hide the opponent hand', () => {
  const st = starterDecks(db);
  const s = E.createGame({ seed: 3, cardDb: db.byId, players: [{ name: 'A', deck: st[0].deck }, { name: 'B', deck: st[1].deck }] });
  const v = packView(E.getView(s, 1));
  const wire = JSON.parse(JSON.stringify(v));
  assert.ok(isView(wire));
  const u = unpackView(wire, db.byId);
  for (const id of u.state.players[0].hand) assert.equal(u.state.objects[id].cardId, 'hidden');
  for (const id of u.state.players[1].hand) assert.notEqual(u.state.objects[id].cardId, 'hidden');
  assert.ok(JSON.stringify(wire).length < 200_000);
});
