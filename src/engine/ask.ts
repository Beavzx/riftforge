// Decision plumbing. In-step decisions (targets, "you may", order triggers, damage assignment, ...)
// are asked synchronously with ask(). If the answer is not yet known the engine throws Suspend;
// game.ts stores the last quiescent state + the actions since then (g.ex.unit) and, when the
// answer arrives, replays deterministically from that state feeding the recorded answers.
import type { Action, Decision, DecisionOption, GameState, PlayerId, ObjId } from './types.ts';
import { log } from './util.ts';

export class Suspend {
  constructor(public decision: Decision) {}
}
/** Thrown to undo an illegal play (CR 358): the whole play is rolled back to the quiescent state. */
export class Rollback {
  constructor(public reason: string) {}
}

interface RunCtx { answers: Action[]; pos: number }
let RUN: RunCtx = { answers: [], pos: 0 };

export function beginRun(answers: Action[], pos: number): void { RUN = { answers, pos }; }
export function runPos(): number { return RUN.pos; }

type Validator = (g: GameState, d: Decision, a: Action) => string | null;
const validators = new Map<string, Validator>();
export function registerValidator(kind: string, v: Validator): void { validators.set(kind, v); }

/** Validate an answer to an in-step decision. Returns an error string or null. */
export function validateAnswer(g: GameState, d: Decision, a: Action): string | null {
  if (a.player !== d.player) return `decision belongs to player ${d.player}`;
  const custom = (d.data?.validator as string | undefined) ?? d.kind;
  const v = validators.get(custom);
  if (v) return v(g, d, a);
  if (a.type !== 'choose') return `expected a 'choose' action for ${d.kind}`;
  const ids = a.optionIds;
  const opts = new Set((d.options ?? []).map(o => o.id));
  if (new Set(ids).size !== ids.length) return 'duplicate option';
  for (const id of ids) if (!opts.has(id)) return `unknown option ${id}`;
  const min = d.min ?? 1, max = d.max ?? 1;
  if (ids.length < min || ids.length > max) return `choose between ${min} and ${max} options`;
  const check = d.data?.check as string | undefined;
  if (check) { const cv = validators.get(check); if (cv) return cv(g, d, a); }
  return null;
}

/** Ask a decision. Auto-answers when there is exactly one legal answer and it isn't optional. */
export function ask(g: GameState, d: Decision): Action {
  d.inStep = true;
  const opts = d.options ?? [];
  const min = d.min ?? 1, max = d.max ?? 1;
  if (d.kind !== 'assignDamage' && d.kind !== 'payment' && !d.data?.noAuto) {
    if (opts.length === 0 && min === 0) return { type: 'choose', player: d.player, optionIds: [] };
    if (opts.length === min && min === max && min >= 1 && opts.length >= 1) {
      // exactly one legal answer (choose all of them)
      if (opts.length === 1) log(g, d.player, `(auto) ${d.prompt}: ${opts[0].label}`, opts[0].objIds);
      return { type: 'choose', player: d.player, optionIds: opts.map(o => o.id) };
    }
  }
  if (d.data?.auto) {
    const a = d.data.auto as Action;
    return a;
  }
  if (RUN.pos < RUN.answers.length) {
    const a = RUN.answers[RUN.pos++];
    return a;
  }
  throw new Suspend(d);
}

// ---------- convenience wrappers ----------

export function chooseOptions(g: GameState, player: PlayerId, kind: Decision['kind'], prompt: string,
  options: DecisionOption[], min = 1, max = 1, extra: Partial<Decision> = {}): string[] {
  if (max > options.length) max = options.length;
  if (min > max) min = max;
  const a = ask(g, { kind, player, prompt, options, min, max, ...extra });
  return a.type === 'choose' ? a.optionIds : [];
}

export function chooseOne(g: GameState, player: PlayerId, kind: Decision['kind'], prompt: string,
  options: DecisionOption[], extra: Partial<Decision> = {}): string {
  return chooseOptions(g, player, kind, prompt, options, 1, 1, extra)[0];
}

export function askYesNo(g: GameState, player: PlayerId, prompt: string, source?: ObjId): boolean {
  const r = chooseOne(g, player, 'optional', prompt, [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], { source });
  return r === 'yes';
}

export function chooseNumber(g: GameState, player: PlayerId, prompt: string, min: number, max: number, source?: ObjId): number {
  if (min === max) return min;
  const options: DecisionOption[] = [];
  for (let i = min; i <= max; i++) options.push({ id: String(i), label: String(i) });
  return Number(chooseOne(g, player, 'chooseNumber', prompt, options, { source }));
}

/** Ask a player to order items (returns option ids in chosen order). Asks one at a time. */
export function chooseOrder(g: GameState, player: PlayerId, prompt: string, options: DecisionOption[], source?: ObjId): string[] {
  return chooseOrderKind(g, player, 'chooseOrder', prompt, options, source);
}
export function chooseOrderKind(g: GameState, player: PlayerId, kind: Decision['kind'], prompt: string, options: DecisionOption[], source?: ObjId): string[] {
  const left = [...options];
  const out: string[] = [];
  while (left.length > 1) {
    const id = chooseOne(g, player, kind, `${prompt} (${out.length + 1} of ${options.length})`, left, { source, data: { noAuto: false } });
    out.push(id);
    left.splice(left.findIndex(o => o.id === id), 1);
  }
  if (left.length) out.push(left[0].id);
  return out;
}
