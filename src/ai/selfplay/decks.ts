// SELFPLAY: deck loading and per-game deck/seat selection.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { DeckList } from '../../engine/types.ts';
import type { DeckConfig } from './config.ts';

export interface NamedDeck { name: string; deck: DeckList }

/** Accepts both data/meta-decks/*.json ({ deck: DeckList, ... }) and a bare DeckList JSON. */
export function loadDeckFile(path: string): NamedDeck {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const deck: DeckList = j.deck ?? j;
  if (!deck?.legend || !Array.isArray(deck.main)) throw new Error(`${path}: not a deck (needs legend, champion, main, runes, battlefields)`);
  return { name: basename(path).replace(/\.json$/, ''), deck };
}

export class DeckPicker {
  private pool: NamedDeck[];
  private me?: NamedDeck;
  private opps: NamedDeck[];
  constructor(private cfg: DeckConfig) {
    this.pool = cfg.pool.map(loadDeckFile);
    this.me = cfg.me ? loadDeckFile(cfg.me) : undefined;
    this.opps = (cfg.opponents ?? []).map(loadDeckFile);
    if (cfg.mode === 'matchup' && (!this.me || !this.opps.length)) throw new Error('decks.mode=matchup needs decks.me and decks.opponents');
    if (cfg.mode === 'pool' && this.pool.length < (cfg.allowMirror ? 1 : 2)) throw new Error('decks.pool needs at least 2 decks (or allowMirror)');
  }
  /** [seat0, seat1]; seats are randomised so each deck plays both sides. */
  pick(r: () => number): [NamedDeck, NamedDeck] {
    let a: NamedDeck, b: NamedDeck;
    if (this.cfg.mode === 'matchup') { a = this.me!; b = this.opps[Math.floor(r() * this.opps.length)]; }
    else {
      a = this.pool[Math.floor(r() * this.pool.length)];
      do { b = this.pool[Math.floor(r() * this.pool.length)]; } while (!this.cfg.allowMirror && b === a);
    }
    return r() < 0.5 ? [a, b] : [b, a];
  }
}
