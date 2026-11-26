// Fuzz regressions (FUZZ agent): every minimised repro in tests/fuzz-repros whose triage status is "fixed" must
// no longer fail. Repros filed as engine bugs ("filed") run as todo tests: they report when they start passing
// (then flip the repro's triage.status to "fixed").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reproFails, reproFailsKind, type Repro } from '../../tools/fuzz-lib.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../fuzz-repros');
const repros: Repro[] = existsSync(dir)
  ? readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Repro)
  : [];

const title = (r: Repro) => `${r.triage?.ref ?? r.hash} ${r.kind}: ${r.message.slice(0, 90)}${r.cards.length ? ` [${r.cards.slice(0, 3).join(', ')}]` : ''}`;

for (const r of repros.filter(x => x.triage?.status === 'fixed')) {
  test(`fuzz regression ${title(r)}`, () => {
    const f = reproFails(r) ?? reproFailsKind(r);
    assert.equal(f, null, f ? `still fails: ${f.kind}: ${f.message}\n${f.stack ?? ''}` : '');
  });
}

for (const r of repros.filter(x => x.triage?.status === 'filed')) {
  test(`fuzz open engine bug ${title(r)}`, { todo: `engine bug ${r.triage?.ref ?? ''} (docs/dsl-requests.md "From FUZZ")` }, () => {
    const f = reproFails(r) ?? reproFailsKind(r);
    assert.equal(f, null, f ? `still fails: ${f.kind}: ${f.message}` : '');
  });
}

test('fuzz repro files are well-formed', () => {
  for (const r of repros) {
    assert.ok(r.hash && r.signature && r.kind && r.spec?.decks?.length === 2 && Array.isArray(r.actions), `bad repro ${r.hash}`);
  }
});
