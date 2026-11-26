// Deck builder: import (text lists / deck codes), edit, validate via the engine, save to localStorage, export.
import type { CardId, DeckList } from '../engine/types';
import { h, clear, uid } from './dom';
import { type CardDb, type CardRec, renderCard, DOMAIN_COLORS, mainDomain } from './cards';
import { type SavedDeck, loadDecks, saveDecks, parseDeckText, deckToText, deckSummary } from './decks';
import { encodeDeckCode } from './deckcode';
import { validateDeck } from './engine';
import { toast, confirmDialog, showPreview, hidePreview, modal } from './overlay';
import { resolvePrinted } from './art';

export class DeckBuilder {
  private decks: SavedDeck[];
  private cur: SavedDeck | null = null;
  private search = '';
  private importText = '';
  private importMsg: { errors: string[]; warnings: string[] } | null = null;
  constructor(private host: HTMLElement, private db: CardDb, private starters: SavedDeck[], private onChange: () => void) {
    this.decks = loadDecks();
    this.cur = this.decks[0] ?? null;
    this.render();
  }
  private all() { return [...this.starters, ...this.decks]; }
  private persist() { if (!saveDecks(this.decks)) toast('Could not save to this browser (storage blocked). Decks will last until you close the page.', 'bad'); this.onChange(); }

  render() {
    clear(this.host);
    const list = h('div', { class: 'panel col', style: { gap: '4px', alignSelf: 'start' } },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h3', { style: { margin: 0 } }, 'Decks'),
        h('div', { class: 'row' }, h('button', { class: 'btn small primary', onClick: () => this.newDeck(), 'data-testid': 'new-deck' }, 'New / Import'))),
      ...this.all().map(d => {
        const ok = validateDeck(d.deck, this.db.byId).ok;
        return h('div', { class: ['deck-list-item', this.cur?.id === d.id && 'active'], tabindex: 0, role: 'button', onClick: () => { this.cur = d; this.importMsg = null; this.render(); },
          onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { this.cur = d; this.render(); } } },
          h('span', { class: 'row', style: { gap: '2px' } }, (this.db.byId[d.deck.legend]?.domains ?? []).map(x => h('i', { class: 'dom-dot', style: { background: DOMAIN_COLORS[x] } }))),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, d.name), h('div', { class: 'sub' }, deckSummary(d.deck, this.db))),
          h('span', { class: ok ? 'ok' : 'err', title: ok ? 'Legal' : 'Not legal' }, ok ? '✓' : '!'));
      }));
    this.host.append(h('div', { class: 'deck-layout' }, list, this.cur ? this.editor(this.cur) : this.importer()));
  }

  private newDeck() { this.cur = null; this.importText = ''; this.importMsg = null; this.render(); }

  private importer(): HTMLElement {
    const ta = h('textarea', { placeholder: 'Paste a deck list or deck code, e.g.\n\nLegend:\n1 Dark Child\nChampion:\n1 Annie, Fiery\nMain Deck:\n3 Firestorm\n...\nBattlefields:\n1 Altar to Unity\nRunes:\n6 Fury Rune\n6 Chaos Rune', 'aria-label': 'Deck list', 'data-testid': 'import-text' }) as HTMLTextAreaElement;
    ta.value = this.importText;
    ta.addEventListener('input', () => (this.importText = ta.value));
    const name = h('input', { type: 'text', placeholder: 'Deck name', 'aria-label': 'Deck name', value: '' }) as HTMLInputElement;
    return h('div', { class: 'panel col' },
      h('h2', null, 'Import a deck'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Supports “3 Card Name” / “3x Name” / “Name x3” lines, card codes like OGN-001, section headers (Legend, Champion, Main Deck, Battlefields, Runes, Sideboard), and Riftbound deck codes.'),
      name, ta,
      this.importMsg ? h('ul', { class: 'issues' }, this.importMsg.errors.map(e => h('li', { class: 'err' }, e)), this.importMsg.warnings.map(w => h('li', { class: 'warn' }, w))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', 'data-testid': 'import-btn', onClick: () => {
          const r = parseDeckText(ta.value, this.db);
          this.importMsg = { errors: r.errors, warnings: r.warnings };
          if (!r.deck.legend && !r.deck.main.length) { this.render(); return; }
          const d: SavedDeck = { id: uid(), name: name.value.trim() || r.name || (this.db.byId[r.deck.legend]?.name ?? 'Imported deck'), deck: r.deck, updated: Date.now(), printings: r.printings };
          this.decks.unshift(d); this.cur = d; this.persist(); this.render();
          toast(r.errors.length ? `Imported with ${r.errors.length} problem(s).` : 'Deck imported.', r.errors.length ? 'bad' : 'info');
        } }, 'Import'),
        h('button', { class: 'btn', onClick: () => { const d: SavedDeck = { id: uid(), name: 'New deck', deck: { legend: '', champion: '', main: [], runes: [], battlefields: [] }, updated: Date.now() }; this.decks.unshift(d); this.cur = d; this.persist(); this.render(); } }, 'Start empty')));
  }

  private editor(d: SavedDeck): HTMLElement {
    const db = this.db; const deck = d.deck;
    const v = validateDeck(deck, db.byId);
    const ro = !!d.starter;
    const mutate = (fn: (dk: DeckList) => void) => {
      if (ro) { // editing a starter makes a copy
        const copy: SavedDeck = { id: uid(), name: d.name.replace(/^Starter: /, '') + ' (copy)', deck: structuredClone(d.deck), updated: Date.now() };
        fn(copy.deck); this.decks.unshift(copy); this.cur = copy;
      } else { fn(d.deck); d.updated = Date.now(); }
      this.persist(); this.render();
    };
    const line = (id: CardId, n: number, sec: keyof DeckList | 'champion' | 'legend') => {
      const c = db.byId[id] as CardRec | undefined;
      const printed = resolvePrinted(d.printings?.[id], id, db.printings);
      const el = h('div', { class: 'deck-line', dataset: { card: id } },
        h('span', { class: 'n' }, String(n)),
        h('span', { class: 'cost', style: { borderColor: DOMAIN_COLORS[mainDomain(c)] } }, c?.energy != null ? String(c.energy) : '·'),
        h('span', { style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: c ? 'pointer' : 'default' }, onClick: () => { if (c) { hidePreview(); modal(c.name, h('div', { style: { display: 'grid', placeItems: 'center' } }, renderCard(c, { size: 'xl', showText: true, printed }))); } } }, c ? c.name + (c.subtitle ? ', ' + c.subtitle : '') : `Unknown ${id}`),
        sec === 'main' || sec === 'runes' || sec === 'battlefields' || sec === 'sideboard' ? [
          h('button', { class: 'btn small ghost', 'aria-label': 'Remove one', onClick: () => mutate(dk => { const arr = dk[sec] as CardId[]; const i = arr.lastIndexOf(id); if (i >= 0) arr.splice(i, 1); }) }, '−'),
          h('button', { class: 'btn small ghost', 'aria-label': 'Add one', onClick: () => mutate(dk => { (dk[sec] as CardId[]).push(id); }) }, '+')] : null);
      el.addEventListener('pointerenter', e => { if ((e as PointerEvent).pointerType === 'mouse') showPreview(c, el, [], printed); }); el.addEventListener('pointerleave', hidePreview);
      return el;
    };
    const group = (ids: CardId[], sec: keyof DeckList) => {
      const m = new Map<CardId, number>(); for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
      return [...m].sort((a, b) => (db.byId[a[0]]?.energy ?? 0) - (db.byId[b[0]]?.energy ?? 0) || (db.byId[a[0]]?.name ?? '').localeCompare(db.byId[b[0]]?.name ?? ''))
        .map(([id, n]) => line(id, n, sec));
    };
    const sec = (title: string, n: number | string, body: HTMLElement[]) => h('div', { class: 'deck-sec' }, h('h4', null, `${title} (${n})`), h('div', { class: 'deck-cards' }, body.length ? body : h('span', { class: 'faint' }, 'None')));
    const nameIn = h('input', { type: 'text', value: d.name, 'aria-label': 'Deck name', disabled: ro, style: { flex: '1', minWidth: '180px' } }) as HTMLInputElement;
    nameIn.addEventListener('change', () => { d.name = nameIn.value.trim() || d.name; this.persist(); this.render(); });
    return h('div', { class: 'panel col' },
      h('div', { class: 'row' }, nameIn,
        ro ? h('span', { class: 'pill' }, 'Starter deck — edits create a copy') : null),
      h('div', { class: v.ok ? 'ok' : 'err', 'data-testid': 'deck-valid' }, v.ok ? '✓ Legal deck' : `Not legal yet (${v.errors.length} issue${v.errors.length === 1 ? '' : 's'}):`),
      !v.ok ? h('ul', { class: 'issues' }, v.errors.slice(0, 12).map(e => h('li', { class: 'err' }, e))) : null,
      this.importMsg ? h('ul', { class: 'issues' }, this.importMsg.errors.map(e => h('li', { class: 'err' }, e)), this.importMsg.warnings.map(w => h('li', { class: 'warn' }, w))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onClick: () => this.exportDeck(d) }, 'Export'),
        h('button', { class: 'btn small', onClick: () => mutate(() => { /* copy */ }) , disabled: !ro }, 'Make editable copy'),
        h('button', { class: 'btn small', onClick: () => { const copy: SavedDeck = { ...structuredClone(d), id: uid(), name: d.name + ' (copy)', starter: undefined, updated: Date.now() }; this.decks.unshift(copy); this.cur = copy; this.persist(); this.render(); } }, 'Duplicate'),
        !ro ? h('button', { class: 'btn small danger', onClick: async () => { if (await confirmDialog('Delete deck?', `Delete “${d.name}”?`, 'Delete')) { this.decks = this.decks.filter(x => x !== d); this.cur = this.all()[0] ?? null; this.persist(); this.render(); } } }, 'Delete') : null),
      sec('Legend', deck.legend ? 1 : 0, deck.legend ? [line(deck.legend, 1, 'legend')] : []),
      sec('Chosen champion', deck.champion ? 1 : 0, deck.champion ? [line(deck.champion, 1, 'champion')] : []),
      sec('Main deck', deck.main.length + (deck.champion ? 1 : 0) + ' incl. champion', group(deck.main, 'main')),
      sec('Battlefields', deck.battlefields.length, group(deck.battlefields, 'battlefields')),
      sec('Runes', deck.runes.length, group(deck.runes, 'runes')),
      deck.sideboard?.length ? sec('Sideboard', deck.sideboard.length, group(deck.sideboard, 'sideboard')) : null,
      this.cardSearch(d, mutate));
  }

  private cardSearch(d: SavedDeck, mutate: (fn: (dk: DeckList) => void) => void): HTMLElement {
    const results = h('div', { class: 'search-results' });
    const L = this.db.byId[d.deck.legend];
    const fill = () => {
      clear(results);
      const q = this.search.trim().toLowerCase();
      if (q.length < 2) { results.append(h('div', { class: 'faint', style: { padding: '8px' } }, 'Type 2+ letters to search cards' + (L ? ` (filtered to ${L.domains.join('/')})` : '') + '.')); return; }
      const hits = this.db.list.filter(c => c.type !== 'Token' && (c.name.toLowerCase().includes(q) || c.tags.some(t => t.toLowerCase() === q) || c.type.toLowerCase() === q) &&
        (!L || c.type === 'Legend' || c.type === 'Battlefield' || c.domains.every(x => x === 'Colorless' || L.domains.includes(x)))).slice(0, 60);
      for (const c of hits) {
        const row = h('div', { class: 'deck-line' },
          h('span', { class: 'cost', style: { borderColor: DOMAIN_COLORS[mainDomain(c)] } }, c.energy != null ? String(c.energy) : '·'),
          h('span', { style: { flex: '1' } }, c.name + (c.subtitle ? ', ' + c.subtitle : ''), h('span', { class: 'faint' }, ` · ${c.type}${c.supertypes.length ? ' · ' + c.supertypes.join('/') : ''}`)),
          c.type === 'Legend' ? h('button', { class: 'btn small', onClick: () => mutate(dk => { dk.legend = c.id; }) }, 'Set legend')
            : c.type === 'Unit' && c.supertypes.includes('Champion') ? h('button', { class: 'btn small', onClick: () => mutate(dk => { if (dk.champion) dk.main.push(dk.champion); dk.champion = c.id; }) }, 'Champion') : null,
          h('button', { class: 'btn small', 'aria-label': `Add ${c.name}`, onClick: () => mutate(dk => { if (c.type === 'Legend') dk.legend = c.id; else if (c.type === 'Battlefield') dk.battlefields.push(c.id); else if (c.type === 'Rune') dk.runes.push(c.id); else dk.main.push(c.id); }) }, '+ Add'));
        row.addEventListener('pointerenter', e => { if ((e as PointerEvent).pointerType === 'mouse') showPreview(c, row); }); row.addEventListener('pointerleave', hidePreview);
        results.append(row);
      }
      if (!hits.length) results.append(h('div', { class: 'faint', style: { padding: '8px' } }, 'No matches.'));
    };
    const input = h('input', { type: 'text', placeholder: 'Search cards by name, tag or type…', value: this.search, 'aria-label': 'Search cards', style: { width: '100%' } }) as HTMLInputElement;
    input.addEventListener('input', () => { this.search = input.value; fill(); });
    fill();
    return h('div', { class: 'col', style: { marginTop: '10px' } }, h('h4', { style: { margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: '400' } }, 'Add cards'), input, results);
  }

  private exportDeck(d: SavedDeck) {
    const text = deckToText(d.deck, this.db, d.name);
    let code = ''; let note = '';
    try { const r = encodeDeckCode(d.deck, this.db, d.printings); code = r.code; if (r.skipped.length) note = `Not in code (unknown set id): ${r.skipped.join(', ')}`; } catch (e) { note = (e as Error).message; }
    const ta = h('textarea', { readonly: true, 'aria-label': 'Deck list text' }) as HTMLTextAreaElement; ta.value = text;
    const codeIn = h('input', { type: 'text', readonly: true, value: code, style: { width: '100%' }, 'aria-label': 'Deck code' }) as HTMLInputElement;
    const copy = (s: string) => { navigator.clipboard?.writeText(s).then(() => toast('Copied.'), () => toast('Copy blocked — select the text and copy it manually.', 'bad')); };
    modal('Export deck', h('div', { class: 'col' },
      h('label', null, 'Deck list'), ta, h('button', { class: 'btn small', onClick: () => copy(text) }, 'Copy list'),
      h('label', null, 'Deck code'), codeIn, h('button', { class: 'btn small', onClick: () => copy(code), disabled: !code }, 'Copy code'),
      note ? h('div', { class: 'warn' }, note) : null,
      h('div', { class: 'gallery', style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
        [d.deck.legend, d.deck.champion].filter(Boolean).map(id => renderCard(this.db.byId[id], { size: 'md' })))), undefined, { wide: true });
  }
}
