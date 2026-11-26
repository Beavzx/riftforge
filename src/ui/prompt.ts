// Prompt panel: renders every Decision kind in types.ts (and a generic fallback for kinds added later).
import type { Action, Decision, DecisionOption, Domain, ObjId, PaymentPlan } from '../engine/types';
import { h } from './dom';
import { renderCard, cardBack, DOMAIN_COLORS } from './cards';
import { isMine } from './legal';
import type { Board } from './board';

export interface PromptUi {
  sel: string[]; showList: boolean; payEx: Set<ObjId>; payRc: Set<ObjId>; dmg: Record<ObjId, number>; x: number | null; collapsed: boolean;
  /** Add abilities ("<obj>:<index>" keys) in the manual payment; payInit: the selection was pre-filled from the auto-pay suggestion */
  payAdd: Set<string>; payInit: boolean;
  toggle(optId: string, d: Decision): void;
  cycleRune(id: ObjId, exhausted: boolean): void;
}
/** AUTO-AUDIT: pre-fill a payment selection from the auto-pay suggestion (once per decision; the board calls it before
 *  rendering so the rune row shows the highlight on the first frame). */
export function initPayUi(ui: PromptUi, d: Decision): void {
  if (ui.payInit || d.kind !== 'payment') return;
  ui.payInit = true;
  const plan = (d.data?.suggested ?? d.data?.auto) as PaymentPlan | null | undefined;
  if (!plan || !Array.isArray(plan.exhaust)) return;
  for (const r of plan.exhaust) ui.payEx.add(r);
  for (const r of plan.recycle ?? []) { ui.payEx.delete(r); ui.payRc.add(r); }
  for (const k of ((plan.other?.abilities as string[] | undefined) ?? [])) ui.payAdd.add(k);
}
export function freshPromptUi(): PromptUi {
  return {
    sel: [], showList: false, payEx: new Set(), payRc: new Set(), dmg: {}, x: null, collapsed: false, payAdd: new Set(), payInit: false,
    toggle(optId, d) {
      const max = d.max ?? 1;
      const i = this.sel.indexOf(optId);
      if (d.kind === 'orderTriggers') { if (i >= 0) this.sel.splice(i); else this.sel.push(optId); return; }
      if (i >= 0) this.sel.splice(i, 1);
      else if (max === 1) this.sel = [optId];
      else if (this.sel.length < max) this.sel.push(optId);
    },
    cycleRune(id, exhausted) {
      // none -> exhaust (energy) -> recycle (power) -> none ; exhausted runes can only be recycled
      if (this.payEx.has(id)) { this.payEx.delete(id); this.payRc.add(id); }
      else if (this.payRc.has(id)) this.payRc.delete(id);
      else if (exhausted) this.payRc.add(id);
      else this.payEx.add(id);
    },
  };
}

const KIND_LABEL: Record<string, string> = {
  mulligan: 'Mulligan', mainAction: 'Your turn', showdownAction: 'Showdown', chainResponse: 'Respond', chooseTargets: 'Choose target',
  chooseMode: 'Choose mode', chooseX: 'Choose X', optional: 'Optional', payment: 'Pay cost', orderTriggers: 'Order triggers',
  assignDamage: 'Assign damage', chooseBattlefield: 'Choose battlefield', chooseCards: 'Choose cards', chooseUnitsToMove: 'Choose units',
  chooseDestination: 'Choose destination', chooseNumber: 'Choose a number', confirm: 'Confirm',
  chooseOrder: 'Choose order', chooseShowdown: 'Choose showdown', chooseOpponent: 'Choose opponent',
};

export function renderPrompt(b: Board): HTMLElement | null {
  const v = b.view!; const d = v.pending;
  if (!d) return null;
  const s = v.state;
  if (!isMine(v)) {
    if (d.kind === 'mainAction' || s.winner !== null) return null;
    return h('div', { class: 'prompt waiting min', role: 'status', 'data-testid': 'prompt-waiting' },
      h('div', { class: 'p-title' }, h('span', { class: 'p-kind' }, 'Waiting'), `${s.players[d.player]?.name ?? 'Opponent'}: ${KIND_LABEL[d.kind] ?? d.kind}`));
  }
  if (d.kind === 'mainAction' && !d.options?.length) return null;
  const ui = b.pui;
  // UI-CANCEL: while your own play is still being made, every prompt of it offers Cancel (also Esc)
  const cancelBtn = b.idx.cancel ? h('button', { class: 'btn ghost p-cancel', title: 'Cancel this play and return the card (Esc)', 'data-testid': 'cancel-play',
    onClick: () => b.act(b.idx.cancel!) }, 'Cancel') : null;
  const panel = (body: (HTMLElement | null)[], actions: (HTMLElement | null)[], min = false) => {
    if (cancelBtn) actions = [cancelBtn, ...actions];
    const top = min || d.kind === 'payment' || d.kind === 'assignDamage';
    const el = h('div', { class: ['prompt', min && 'min', top && 'top'], role: 'dialog', 'aria-label': d.prompt, 'data-testid': 'prompt', dataset: { kind: d.kind } },
      h('div', { class: 'p-title' }, h('span', { class: 'p-kind' }, KIND_LABEL[d.kind] ?? d.kind), h('span', null, d.prompt),
        h('button', { class: 'btn small ghost p-collapse', onClick: () => { ui.collapsed = !ui.collapsed; b.render(); }, 'aria-label': ui.collapsed ? 'Show prompt' : 'Hide prompt' }, ui.collapsed ? 'Show' : 'Hide')),
      ui.collapsed ? null : h('div', { class: 'p-body' }, body, h('div', { class: 'p-actions' }, actions)));
    if (d.source) { const src = s.objects[d.source]; const c = b.card(src); if (c && !ui.collapsed) el.querySelector('.p-title')!.appendChild(h('span', { class: 'pill' }, c.name)); }
    return el;
  };
  const btn = (label: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean; testid?: string } = {}) =>
    h('button', { class: ['btn', opts.primary && 'primary'], disabled: opts.disabled || false, onClick, 'data-testid': opts.testid }, label);
  const opts = d.options ?? [];
  const min = d.min ?? (d.kind === 'mulligan' ? 0 : 1), max = d.max ?? (d.kind === 'mulligan' ? 2 : 1);
  const count = ui.sel.length;
  const okCount = count >= min && count <= max;

  const optCard = (o: DecisionOption) => {
    const id = o.objIds?.[0]; const ob = id ? s.objects[id] : undefined; const c = b.card(ob);
    const sel = ui.sel.includes(o.id);
    const el = c ? renderCard(c, { size: 'sm', obj: ob, classes: [sel ? 'selected' : 'targetable'] }) : ob ? cardBack(ob.id, 'sm', [sel ? 'selected' : 'targetable']) : h('div', { class: 'btn' }, o.label);
    el.removeAttribute('data-obj'); // avoid FLIP confusion with the board copy
    el.setAttribute('role', 'checkbox'); el.setAttribute('aria-checked', String(sel)); el.tabIndex = 0;
    el.title = o.label;
    el.addEventListener('click', () => b.onTarget(o.id));
    el.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); b.onTarget(o.id); } });
    return el;
  };
  const optButtons = (multi: boolean) => h('div', { class: 'p-opts' }, opts.map(o => h('button', {
    class: ['btn', ui.sel.includes(o.id) && 'sel'], 'aria-pressed': multi ? String(ui.sel.includes(o.id)) : undefined, 'data-testid': 'opt-' + o.id,
    onClick: () => { if (!multi) b.submitChoose([o.id]); else { ui.toggle(o.id, d); b.render(); } },
  }, o.label)));
  const hasObjOpts = opts.some(o => o.objIds?.length);
  const confirmBtn = (label = 'Confirm') => btn(label, () => b.submitChoose(ui.sel), { primary: true, disabled: !okCount, testid: 'confirm' });

  switch (d.kind) {
    case 'mulligan': {
      return panel([
        h('div', { class: 'hint' }, `Select up to ${max} card${max === 1 ? '' : 's'} to recycle (to the bottom of your deck), then draw replacements. Click cards here or in your hand.`),
        h('div', { class: 'p-cards' }, opts.map(optCard)),
      ], [btn(count ? `Recycle ${count} & draw` : 'Keep hand', () => b.submitChoose(ui.sel), { primary: true, disabled: !okCount, testid: 'confirm' })]);
    }
    case 'chooseTargets': case 'chooseCards': case 'chooseUnitsToMove': {
      const BOARD = new Set(['base', 'battlefield', 'facedown', 'runePool', 'legendZone', 'championZone', 'hand']);
      const onBoard = hasObjOpts && opts.every(o => (o.objIds ?? []).every(id => BOARD.has(s.objects[id]?.zone) && (s.objects[id]?.zone !== 'hand' || s.objects[id]?.owner === v.you)));
      const showList = hasObjOpts && (!onBoard || ui.showList);
      const hint = onBoard ? 'Click a highlighted card on the board.' : d.kind === 'chooseUnitsToMove' ? 'Choose the units.' : 'Choose from these cards.';
      return panel([
        h('div', { class: 'hint' }, `${hint} ${max > 1 ? `(${min}–${max}, ${count} chosen)` : ''}`),
        showList ? h('div', { class: 'p-cards' }, opts.map(optCard)) : hasObjOpts ? null : optButtons(max > 1),
      ], [onBoard ? btn(ui.showList ? 'Hide list' : 'Show list', () => { ui.showList = !ui.showList; b.render(); }) : null,
        min === 0 ? btn(max > 1 && count ? 'Confirm' : 'Choose none', () => b.submitChoose(ui.sel), { disabled: !okCount, testid: 'confirm-none' }) : null,
        (max > 1 && count) || !hasObjOpts ? confirmBtn() : null], onBoard && !ui.showList);
    }
    case 'chooseMode': {
      return panel([max > 1 ? h('div', { class: 'hint' }, `Choose ${min === max ? min : `${min}–${max}`}.`) : null, optButtons(max > 1)],
        max > 1 ? [confirmBtn()] : []);
    }
    case 'chooseBattlefield': case 'chooseDestination': case 'chooseShowdown': {
      // Options may point at set-aside objects the view hides; fall back to the option label (card name).
      const cardFor = (o: DecisionOption) => b.card(s.objects[o.objIds?.[0] ?? '']) ?? b.db.byName.get(o.label.toLowerCase())?.[0];
      const visible = opts.length > 0 && opts.every(o => !!cardFor(o));
      const onBoard = opts.every(o => o.objIds?.some(id => s.battlefields.some(bf => bf.objId === id)));
      if (visible && !onBoard) return panel([h('div', { class: 'hint' }, 'Choose:'), h('div', { class: 'p-cards' }, opts.map(o => { const c = cardFor(o); const el = c ? renderCard(c, { size: 'md', showText: true, classes: [ui.sel.includes(o.id) ? 'selected' : 'targetable'] }) : h('button', { class: 'btn' }, o.label); el.tabIndex = 0; el.setAttribute('role', 'button'); el.title = o.label; el.dataset.testid = 'opt-' + o.id; el.addEventListener('click', () => b.onTarget(o.id)); return el; }))], max > 1 ? [confirmBtn()] : []);
      return panel([h('div', { class: 'hint' }, 'Click a highlighted battlefield/zone, or choose:'), optButtons(max > 1)], max > 1 ? [confirmBtn()] : []);
    }
    case 'optional': {
      const yes = opts.find(o => /^(yes|accept|do|true|y)$/i.test(o.id)) ?? opts[0];
      const no = opts.find(o => /^(no|decline|skip|false|n)$/i.test(o.id)) ?? opts[1];
      if (opts.length > 2) return panel([optButtons(false)], []);
      return panel([], [
        btn(no?.label ?? 'No', () => b.submitChoose([no?.id ?? 'no']), { testid: 'opt-no' }),
        btn(yes?.label ?? 'Yes', () => b.submitChoose([yes?.id ?? 'yes']), { primary: true, testid: 'opt-yes' })], true);
    }
    case 'confirm': {
      if (opts.length > 1) return panel([optButtons(false)], []);
      return panel([], [btn(opts[0]?.label ?? 'OK', () => b.submitChoose([opts[0]?.id ?? 'ok']), { primary: true, testid: 'confirm' })], true);
    }
    case 'chooseX': case 'chooseNumber': {
      const legalNums = b.idx.choose.map(c => Number(c.optionIds[0])).filter(n => Number.isFinite(n));
      const lo = Number(d.data?.min ?? (legalNums.length ? Math.min(...legalNums) : opts.length ? Math.min(...opts.map(o => +o.id).filter(Number.isFinite)) : 0));
      const hi = Number(d.data?.max ?? (legalNums.length ? Math.max(...legalNums) : opts.length ? Math.max(...opts.map(o => +o.id).filter(Number.isFinite)) : lo));
      if (ui.x === null || ui.x < lo || ui.x > hi) ui.x = Number(d.data?.default ?? hi);
      const val = h('span', { class: 'v', style: { fontSize: '22px', fontWeight: '800', minWidth: '2ch', textAlign: 'center' } }, String(ui.x));
      const range = h('input', { type: 'range', min: String(lo), max: String(hi), value: String(ui.x), 'aria-label': 'Value',
        onInput: (e: Event) => { ui.x = +(e.target as HTMLInputElement).value; val.textContent = String(ui.x); } });
      return panel([
        h('div', { class: 'row' }, btn('−', () => { ui.x = Math.max(lo, ui.x! - 1); b.render(); }), val, btn('+', () => { ui.x = Math.min(hi, ui.x! + 1); b.render(); }),
          h('span', { class: 'muted' }, `${lo}–${hi}`)),
        hi - lo <= 40 ? range : null,
      ], [btn(`Choose ${d.kind === 'chooseX' ? 'X = ' : ''}${ui.x}`, () => b.submitChoose([String(ui.x)], ui.x), { primary: true, testid: 'confirm' })]);
    }
    case 'orderTriggers': {
      const all = ui.sel.length === opts.length;
      return panel([
        h('div', { class: 'hint' }, 'Click the triggers in the order to put them on the chain (the last one you put on resolves first).'),
        h('div', { class: 'col' }, opts.map(o => {
          const n = ui.sel.indexOf(o.id);
          const c = o.objIds?.[0] ? b.card(s.objects[o.objIds[0]]) : undefined;
          return h('button', { class: ['btn', n >= 0 && 'sel'], style: { justifyContent: 'flex-start' }, onClick: () => { ui.toggle(o.id, d); b.render(); }, 'data-testid': 'opt-' + o.id },
            n >= 0 ? h('span', { class: 'order-n' }, String(n + 1)) : h('span', { class: 'order-n', style: { background: 'var(--line)' } }, '·'),
            c ? h('b', null, c.name + ': ') : null, o.label);
        })),
      ], [btn('Reset', () => { ui.sel = []; b.render(); }), btn('Confirm order', () => b.submitChoose(ui.sel, undefined, true), { primary: true, disabled: !all, testid: 'confirm' })]);
    }
    case 'assignDamage': {
      // data.targets: ObjId[] or engine AssignTarget[] ({obj, lethal, groups}); data.total|amount; data.suggested
      const rawT = (d.data?.targets as unknown[] | undefined) ?? opts.flatMap(o => o.objIds ?? []);
      const targets: ObjId[] = rawT.map(t => typeof t === 'string' ? t : (t as { obj: ObjId }).obj);
      const lethal: Record<ObjId, number | null> = { ...((d.data?.lethal as Record<ObjId, number> | undefined) ?? {}) };
      for (const t of rawT) if (t && typeof t === 'object' && 'obj' in (t as object)) lethal[(t as { obj: ObjId }).obj] = (t as { lethal: number | null }).lethal;
      const amount = Number(d.data?.total ?? d.data?.amount ?? 0);
      const legalAuto = b.idx.assign[0]?.type === 'assignDamage' ? b.idx.assign[0].assignment : undefined;
      const auto = (d.data?.suggested as Record<ObjId, number> | undefined) ?? legalAuto;
      if (!Object.keys(ui.dmg).length) for (const t of targets) ui.dmg[t] = auto?.[t] ?? 0;
      const used = targets.reduce((a, t) => a + (ui.dmg[t] ?? 0), 0);
      const left = amount - used;
      return panel([
        h('div', { class: 'hint' }, `Distribute ${amount} damage. ${left ? `${left} left to assign.` : 'All damage assigned.'} Assign lethal damage in order (Tank first, Backline last) before moving on.`),
        h('div', { class: 'col' }, targets.map(t => {
          const ob = s.objects[t]; const c = b.card(ob);
          const need = t in lethal ? lethal[t] : (c?.might != null ? Math.max(0, (c.might ?? 0) - (ob?.damage ?? 0)) : undefined);
          return h('div', { class: 'stepper', dataset: { target: t } },
            h('span', { class: 'nm' }, c?.name ?? 'Unit', need !== undefined ? h('span', { class: 'muted' }, need === null ? ' (can\u2019t be dealt damage: only excess)' : need >= 1e9 ? ' (damage prevented: can\u2019t die, takes the rest)' : ` (lethal ${need})`) : null),
            btn('−', () => { ui.dmg[t] = Math.max(0, (ui.dmg[t] ?? 0) - 1); b.render(); }, { disabled: !ui.dmg[t] }),
            h('span', { class: 'v' }, String(ui.dmg[t] ?? 0)),
            btn('+', () => { ui.dmg[t] = (ui.dmg[t] ?? 0) + 1; b.render(); }, { disabled: left <= 0 }));
        })),
      ], [auto ? btn('Suggested', () => { ui.dmg = { ...auto }; b.render(); }) : null,
        btn('Assign', () => { const asg: Record<ObjId, number> = {}; for (const t of targets) if (ui.dmg[t]) asg[t] = ui.dmg[t]; b.act({ type: 'assignDamage', player: v.you, assignment: asg }); }, { primary: true, disabled: left !== 0, testid: 'confirm' })]);
    }
    case 'payment': return paymentPanel(b, d, panel, btn);
    case 'chainResponse': case 'showdownAction': {
      const plays = b.idx.play.size + b.idx.activate.size + b.idx.moves.length;
      return panel([
        h('div', { class: 'hint' }, plays ? 'You may respond: highlighted cards and abilities can be used now.' : 'No responses available.'),
        opts.length ? optButtons(false) : null,
        b.idx.other.length ? h('div', { class: 'p-opts' }, b.idx.other.map(a => btn(b.describe(a), () => b.act(a)))) : null,
      ], [], true); // docked beside the end-turn button, which passes (data-testid="pass")
    }
    default: {
      // Generic fallback: options as buttons, else every legal action as a button. Never stalls.
      if (opts.length) return panel([optButtons(max > 1)], max > 1 ? [confirmBtn()] : []);
      const acts: Action[] = v.legal.filter(a => a.type !== 'concede');
      return panel([h('div', { class: 'p-opts' }, acts.map(a => btn(b.describe(a), () => b.act(a))))], []);
    }
  }
}

function paymentPanel(b: Board, d: Decision, panel: (body: (HTMLElement | null)[], actions: (HTMLElement | null)[], min?: boolean) => HTMLElement,
  btn: (label: string, onClick: () => void, o?: { primary?: boolean; disabled?: boolean; testid?: string }) => HTMLElement): HTMLElement {
  const v = b.view!; const s = v.state; const ui = b.pui;
  // cost: mock {energy, power: {Domain: n}} or engine ResolvedCost {energy, power: ('any' | Domain[])[]}
  const cost = (d.data?.cost ?? {}) as { energy?: number; power?: unknown };
  const energy = Number(cost.energy ?? 0);
  const pips: string[] = [];
  if (Array.isArray(cost.power)) for (const p of cost.power) pips.push(p === 'any' ? 'Any' : Array.isArray(p) && p.length === 1 ? String(p[0]) : 'Class');
  else if (typeof cost.power === 'number') for (let i = 0; i < cost.power; i++) pips.push('Any');
  else for (const [dom, n] of Object.entries((cost.power ?? {}) as Record<string, number>)) for (let i = 0; i < (n ?? 0); i++) pips.push(dom);
  const power: Record<string, number> = {}; for (const p of pips) power[p] = (power[p] ?? 0) + 1;
  const pool = s.players[v.you]?.pool;
  const autoOpt = d.options?.find(o => /auto/i.test(o.id));
  const otherOpts = (d.options ?? []).filter(o => o !== autoOpt && !/manual/i.test(o.id));
  const manualId = d.options?.find(o => /manual/i.test(o.id))?.id ?? 'manual';
  const autoPlan = (d.data?.suggested ?? d.data?.auto) as PaymentPlan | null | undefined;
  // AUTO-AUDIT: start from the auto-pay suggestion (its runes are highlighted), so changing one rune is one click
  const sugAdds = ((autoPlan?.other?.abilities as string[] | undefined) ?? []);
  initPayUi(ui, d);
  // a ready rune chosen for recycling is exhausted for its [1] first (it leaves play anyway; the [1] floats — rules-decisions #65)
  const exN = ui.payEx.size, rcN = ui.payRc.size;
  const exhaust = [...ui.payEx, ...[...ui.payRc].filter(r => !ui.payEx.has(r) && s.objects[r] && !s.objects[r].exhausted)];
  // Add sources: listed by the engine (data.adds) or at least the ones the suggestion uses
  const addList = ((d.data?.adds as { key: string; label?: string }[] | undefined) ?? sugAdds.map(key => ({ key } as { key: string; label?: string })))
    .map(a => ({ key: a.key, label: a.label ?? b.card(s.objects[a.key.split(':')[0]])?.name ?? 'Add ability' }));
  const adds = addList.filter(a => ui.payAdd.has(a.key)).map(a => a.key);
  const addDomains = Object.fromEntries(Object.entries((autoPlan?.other?.addDomains as Record<string, string> | undefined) ?? {}).filter(([k]) => adds.includes(k)));
  const plan: PaymentPlan = { exhaust, recycle: [...ui.payRc], ...(adds.length ? { other: { abilities: adds, addDomains } } : {}) };
  return panel([
    h('div', { class: 'cost-need' }, 'Cost:',
      energy ? h('i', { class: 'ico ico-energy', style: { fontSize: '15px' } }, String(energy)) : null,
      Object.entries(power).flatMap(([dom, n]) => Array.from({ length: n ?? 0 }, () => h('i', { class: `ico ico-pip pip-${dom}`, style: { width: '14px', height: '14px' }, title: dom }))),
      !energy && !Object.keys(power).length ? h('span', { class: 'muted' }, 'free') : null,
      pool?.energy ? h('span', { class: 'muted' }, `· pool ${pool.energy} energy`) : null),
    h('div', { class: 'hint' }, 'Highlighted: what Auto-pay would use. Click a rune to change it: exhaust (energy) → recycle (power) → unused.'),
    addList.length ? h('div', { class: 'row p-adds' }, addList.map(a => h('label', { class: 'row', style: { gap: '4px' } },
      h('input', { type: 'checkbox', 'data-testid': 'pay-add', checked: ui.payAdd.has(a.key), onChange: (e: Event) => { if ((e.target as HTMLInputElement).checked) ui.payAdd.add(a.key); else ui.payAdd.delete(a.key); b.render(); } }), a.label))) : null,
    autoPlan === null ? h('div', { class: 'err' }, 'You can’t currently afford this cost.') : null,
    exN || rcN ? h('div', { class: 'row' }, h('span', { class: 'pill' }, `Exhaust ${exN}`), h('span', { class: 'pill' }, `Recycle ${rcN}`),
      ...[...ui.payRc].map(id => { const c = b.card(s.objects[id]); const dom = c?.domains[0] as Domain | undefined; return h('i', { class: 'dom-dot', style: { background: DOMAIN_COLORS[dom ?? 'Colorless'] } }); })) : null,
    otherOpts.length ? h('div', { class: 'p-opts' }, otherOpts.map(o => btn(o.label, () => b.submitChoose([o.id])))) : null,
  ], [
    exN || rcN || adds.length ? btn('Clear', () => { ui.payEx.clear(); ui.payRc.clear(); ui.payAdd.clear(); b.render(); }) : null,
    btn('Pay with selected', () => b.submitChoose([manualId], plan), { disabled: !(exN || rcN || adds.length || (pool?.energy ?? 0) > 0 || Object.values(pool?.power ?? {}).some(n => (n ?? 0) > 0)), testid: 'pay-manual' }),
    btn('Auto-pay', () => b.submitChoose([autoOpt?.id ?? 'auto']), { primary: true, disabled: autoPlan === null, testid: 'pay-auto' }),
  ]);
}
