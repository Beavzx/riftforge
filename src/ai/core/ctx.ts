// AI-CORE: builds the PlanCtx / CardInfo views that deck plans (src/ai/plans) read. Lazy: nothing is derived until a
// hook reads it, so plans without hooks cost nothing at leaf evaluations.
import type { GameState, ObjId, PlayerId } from '../../engine/types.ts';
import { chars, attachedTo, mightOr0, kwVal } from '../../engine/chars.ts';
import { victoryScore } from '../../engine/rules.ts';
import type { CardInfo, PlanCtx } from '../plans/types.ts';

export function cardInfo(g: GameState, id: ObjId): CardInfo | null {
  const o = g.objects[id];
  if (!o) return null;
  let c;
  try { c = chars(g, id); } catch { return null; }
  const def = g.cards[o.cardId];
  const kws: string[] = [];
  for (const [k, v] of c.keywords) kws.push(v && v !== 1 && typeof v === 'number' ? `${k} ${v}` : k);
  let att: ObjId[] = [];
  if (o.zone === 'base' || o.zone === 'battlefield') { try { att = attachedTo(g, id); } catch { att = []; } }
  return {
    obj: id, cardId: o.cardId, name: c.name ?? def?.name ?? '?', subtitle: def?.subtitle, type: (c.type ?? '?') as CardInfo['type'],
    tags: c.tags ?? [], keywords: kws, energy: c.energy ?? 0, power: c.power ?? 0, might: Math.max(0, c.might ?? 0),
    zone: o.zone, battlefield: o.battlefieldIndex, controller: o.controller, owner: o.owner, exhausted: !!o.exhausted,
    stunned: !!o.stunned, isToken: !!o.isToken, attachedTo: o.attachedTo, attachments: att,
    champion: (c.supertypes ?? []).includes('Champion'), text: def?.text ?? '',
  };
}

const FACEDOWN = (g: GameState, id: ObjId): CardInfo => {
  const o = g.objects[id];
  return { obj: id, cardId: 'hidden', name: 'facedown', type: '?', tags: [], keywords: [], energy: 0, power: 0, might: 0, zone: o.zone, battlefield: o.battlefieldIndex,
    controller: o.controller, owner: o.owner, exhausted: false, stunned: false, isToken: false, attachments: [], champion: false, text: '' };
};

export function makeCtx(g: GameState, me: PlayerId): PlanCtx {
  const opp = (g.players.find(x => x.id !== me && !x.conceded)?.id ?? (1 - me)) as PlayerId;
  const cache: Record<string, unknown> = {};
  const lazy = <T>(k: string, f: () => T): T => (k in cache ? cache[k] as T : (cache[k] = f()) as T);
  const infos = (ids: ObjId[]) => ids.map(id => cardInfo(g, id)).filter((x): x is CardInfo => !!x);
  const boardIds = (p: PlayerId): ObjId[] => {
    const out: ObjId[] = [];
    for (const id in g.objects) { const o = g.objects[id]; if (o.controller === p && (o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'facedown')) out.push(id); }
    return out;
  };
  const me_ = g.players[me];
  const ctx: PlanCtx = {
    g, me, opp,
    myTurn: g.activePlayer === me,
    turn: g.turn,
    victory: victoryScore(g),
    myPoints: me_.points,
    oppPoints: g.players[opp]?.points ?? 0,
    get hand() { return lazy('hand', () => infos(me_.hand)); },
    get board() { return lazy('board', () => infos(boardIds(me))); },
    get oppBoard() { return lazy('oppBoard', () => boardIds(opp).map(id => g.objects[id].zone === 'facedown' ? FACEDOWN(g, id) : cardInfo(g, id)).filter((x): x is CardInfo => !!x)); },
    get legend() { return lazy('legend', () => cardInfo(g, me_.legend)!); },
    get runes() { return me_.runesInPlay.length; },
    get readyRunes() { return me_.runesInPlay.filter(id => !g.objects[id]?.exhausted).length; },
    get poolEnergy() { return (me_.pool?.energy ?? 0) + Object.values(me_.pool?.power ?? {}).reduce((t, v) => t + (v ?? 0), 0); },
    get deckSize() { return me_.mainDeck.length; },
    get runeDeckSize() { return me_.runeDeck.length; },
    get playedThisTurn() { return lazy('played', () => (g.ex.playedThisTurn[me] ?? []).map(id => g.objects[id] ? (cardInfo(g, id)?.name ?? '?') : '?')); },
    info: (id: ObjId) => {
      const o = g.objects[id];
      if (!o) return null;
      if (o.zone === 'facedown' && o.controller !== me) return FACEDOWN(g, id);
      if ((o.zone === 'hand' || o.zone === 'mainDeck') && o.owner !== me) return null;
      return cardInfo(g, id);
    },
    count: (name, where = 'board') => {
      const list = where === 'hand' ? ctx.hand : where === 'oppBoard' ? ctx.oppBoard : ctx.board;
      return list.filter(c => typeof name === 'string' ? c.name === name : name(c)).length;
    },
    unitsAt: (loc, who) => {
      const p = who === 'me' ? me : opp;
      const out: CardInfo[] = [];
      for (const id in g.objects) {
        const o = g.objects[id];
        if (o.controller !== p) continue;
        if (loc === 'base' ? o.zone !== 'base' : (o.zone !== 'battlefield' || o.battlefieldIndex !== loc)) continue;
        const c = cardInfo(g, id);
        if (c && (c.type === 'Unit' || c.might > 0 || c.type === 'Token')) out.push(c);
      }
      return out;
    },
    mightAt: (loc, who) => {
      const p = who === 'me' ? me : opp;
      let m = 0;
      for (const id in g.objects) {
        const o = g.objects[id];
        if (o.controller !== p || o.zone !== 'battlefield' || o.battlefieldIndex !== loc) continue;
        try { m += mightOr0(g, id) + kwVal(g, id, 'Shield'); } catch { /* ignore */ }
      }
      return m;
    },
    controllerOf: bf => g.battlefields[bf]?.controller ?? null,
    get battlefields() { return lazy('bfs', () => g.battlefields.map(b => g.cards[g.objects[b.objId]?.cardId]?.name ?? '?')); },
    get chosenThisPlay() { return lazy('chosen', () => (g.ex.unit?.actions ?? []).filter(a => a.type === 'choose' && a.player === me).flatMap(a => (a as { optionIds: string[] }).optionIds).filter(id => !!g.objects[id])); },
  };
  return ctx;
}

/** Legend champion tag key: 'Azir' -> 'azir', "Rek'Sai" -> 'reksai', "Kai'Sa" -> 'kaisa'. */
export function legendKey(g: GameState, p: PlayerId): string { return legendKeys(g, p)[0] ?? ''; }
/** all candidate keys of p's legend: every tag (the champion tag is not always first: Kennen = ['Yordle', 'Kennen']), then the name */
export function legendKeys(g: GameState, p: PlayerId): string[] {
  const o = g.objects[g.players[p].legend];
  const def = o ? g.cards[o.cardId] : undefined;
  return [...(def?.tags ?? []), def?.name ?? ''].map(t => t.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean);
}
