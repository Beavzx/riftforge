# ENCODE agent notes: neural-net interface (src/ai/encode/, python/riftnet/)

Entity-set observation + candidate-action encoding for a transformer policy/value net with a pointer-style action head,
plus a compact binary wire format between Node self-play workers and a Python GPU inference server.

## TS API (src/ai/encode/index.ts) — stable

```ts
encodeObservation(state: GameState, player: PlayerId, opts?: { costs?: boolean }): Observation
  // Observation = { version, player, global: Float32Array(GLOBAL.dim), nEntities, entities: Float32Array(nEntities*ENTITY.dim),
  //                 cardIdx: Int32Array(nEntities), entityOf: Map<ObjId,row>, chainEntityOf: Map<chainItemId,row>, bfEntity: number[] }
  // compact (no padding). toPadded(obs) -> { entities: MAX_ENTITIES*F, cardIdx, mask } if fixed shapes are wanted.
  // opts.costs (default true): effective play cost of own hand/champion cards (~30% of encode time; off for cheap leaf evals).
encodeActions(state, player, legal: Action[], obs): EncodedActions
  // EncodedActions = { n, feats: Float32Array(n*ACTION.dim), ptrIdx: Int32Array(n*MAX_PTRS) (-1 = no row),
  //                    ptrRole: Int32Array(n*MAX_PTRS) (PTR_ROLES index, 0 = unused), ptrVal: Float32Array(n*MAX_PTRS) }
encodeSubChoices(state, player, sub: SubChoice, obs): EncodedActions
  // sub = node.choice of src/ai/env/factored.ts as-is: { kind: 'engine'|'pickCards'|'moveUnits'|'assignDamage'|'payment',
  //   decision, player, prompt, step, partial: { picked?, destination?, assignment?, current?, total?, min?, max? },
  //   options: [{ id, label, objIds?, value?: number|string, isDone?, action? }] }
  // - options with `action` (pass-through) get the full engine-action row (same as encodeActions) + sub:passThrough
  // - other options: type "subChoice", objIds -> pointers (role option), value / isDone / label
  // - every row: sub-choice kind one-hot, step, and the decision so far: pointers to cards already picked / moved
  //   (role picked), damage assigned so far (role assigned, ptrVal = amount/10), the recipient being decided (role current),
  //   the move destination (dest one-hot + battlefield pointer), sub:total / sub:assigned / sub:remaining, sub:min / sub:max
  //   (the option's own pointers come first, so the partial-state pointers never push them out)
packObs(obs, acts, tag = 0, out?, offset?): Uint8Array      unpackObs(buf)
packResult(tag, value, logits, extra = []): Uint8Array      unpackResult(buf)
withLength(frame): Uint8Array   // u32 length prefix for streams
obsFrameBytes(nE, nA), schemaHash(), schema()
GLOBAL / ENTITY / ACTION: { names, at: Record<name, column>, dim }   MAX_ENTITIES, MAX_PTRS, MAX_BF, PTR_ROLES, ACTION_TYPES
cardIndex(), cardIdxOf(cardId), staticTable()   // PAD_IDX 0, UNKNOWN_IDX 1, cards from 2
```

Use `observedState(state, player)` if you need the exact board the player observes (UI-CANCEL pre-play board).
Only 1v1 is encoded properly ("opp" = the other player); FFA/2v2 would need per-opponent slots.

## Dims (schema hash 2349895024)

| part | dim |
|---|---|
| global | 167 |
| entity (dynamic) | 108 |
| action row | 152 |
| pointers per action | 12 (roles: none, source, option, moved, destination, payExhaust, payRecycle, damage, pendingSource, picked, assigned, current) |
| static card table | 1105 rows (pad, unknown, 1103 cards) x 154 |
| max entities | 192 (seen max 73 in random games, mean ~57) |

Entities: battlefields, legends, champion zones, board units/gear (battlefields + base), facedown cards (opponent's as
unknown rows with location), chain (spells as objects, abilities/triggers as chain-item rows), own hand, revealed cards,
rune pools, trash + banishment (most recent first, cut first if over budget), and **unseen multiset rows**: one row per
distinct card per player with a count (open decklist: decklist minus everything seen — the same assumption as
src/ai/determinize.ts). Each row = dynamic features + `cardIdx`; the network joins `cardIdx` with a learned embedding and
the static table (python/riftnet/card_table.f32: type, cost, power, might, domains, keyword presence/values, top tags,
rarity, 32 text-regex flags, optional text embeddings).

Card index is persisted append-only in data/encode-card-index.json so model embedding rows survive card-pool updates.
Text-embedding hook: drop `data/card-text-embeddings.json` (`{dim, vectors: {cardId: number[]}}`) and re-run the schema
tool (TS appends the vectors to the static table), or use `Schema.load_text_embeddings()` on the Python side.

## Wire format (src/ai/encode/wire.ts, python/riftnet/wire.py) — stable

Little-endian, 4-byte aligned; on streams each frame has a u32 byte-length prefix.

```
RFO1  header 11 x u32: magic 0x314F4652 | version | schemaHash | tag | player | nE | nA | G | F | A | P
      f32 global[G] | f32 entities[nE*F] | i32 cardIdx[nE] | f32 actions[nA*A] | i32 ptrIdx[nA*P] | i32 ptrRole[nA*P] | f32 ptrVal[nA*P]
RFR1  header 4 x u32:  magic 0x31524652 | tag | nA | nExtra
      f32 value | f32 logits[nA] | f32 extra[nExtra]
```
Frames are variable length (only real entity/action rows); ~27 KB per observation on average. `python/riftnet/batch.py
collate()` pads a list of frames to (B, E, F) / (B, A, ...) with masks. Decoders check `schemaHash` against schema.json.

## Measured cost (per observation, thread CPU time; wall time on this oversubscribed 2-core box is ~5x higher)

| | ms |
|---|---|
| encodeObservation (with costs) | 0.37–0.43 (two runs) |
| encodeObservation (costs: false) | 0.30 |
| of which chars() layer computation | ~0.06 |
| of which effectivePlayCost | ~0.09 |
| encodeActions (whole legal list, avg 3.6 actions) | 0.02 |
| packObs | 0.03 |
| getView, for comparison | 2.24 |

## Leak safety

- Visibility is exactly `hiddenIdsFor()` (the rule getView uses). Hidden objects give only public facts (counts, facedown
  locations) and the per-player unseen multiset (invariant under any resampling of hidden identities).
- While an opponent can still cancel a play in progress, the pre-play board is encoded (`cancelBase`, as getView).
- The opponent's pending decision is reduced to kind / player / inStep.
- tests/ai/encode/leak.test.ts: (1) encoding identical across 2 determinizations of every 3rd state of 4 random games for
  both players; (2) identical after scrambling counters/modifiers/epoch of hidden objects and the RNG; (3) cross-check with
  getView: known rows are exactly the objects getView shows, with the same card. No leak found.
- Not modelled (same as determinize): cards a player has seen and that went back into a hidden zone (e.g. a card revealed
  from hand that stays in hand) count as unseen again — conservative, not a leak.

## Regenerating

`tsx tools/encode-schema.ts` (after any feature change or cards.json update) -> data/encode-card-index.json,
python/riftnet/schema.json, python/riftnet/card_table.f32. `--frames N` also writes the Python test fixture.
actions.test.ts fails if schema.json is stale.

## Tests

- `tsx --test tests/ai/encode/leak.test.ts tests/ai/encode/actions.test.ts tests/ai/encode/subchoice.test.ts`
  (subchoice: 12 random games driven only through factor()/pick() — maxFlat 1 on every 3rd seed, manual payment on even
  seeds — 2,800 sub-choices / 11,600 options of all five kinds encoded with valid pointers; plus a stepwise
  damage-assignment check of the assigned / current / remaining encoding)
- `python3 -m unittest discover -s python/tests` (decodes TS-written frames byte-exactly, collation, result frames)

## API changes

Since the WIP commit 529970a (all backward compatible; frame layouts unchanged):
- `encodeSubChoices` now takes the factored layer's `SubChoice` exactly (src/ai/env/factored.ts node.choice: kind, decision,
  step, partial object, options with id / value number|string / action). The old `{ kind, partial: [], options }` form is
  still accepted (an array partial = picked ids).
- New exports: `SUB_KINDS`, type `SubChoicePartial`; `schema().action.subKinds`.
- `PTR_ROLES` gained `picked`, `assigned`, `current` (appended: existing role ids unchanged).
- Action features: `sub:partial` replaced by `sub:<kind>` x5, `sub:step`, `sub:picked`, `sub:min`, `sub:max`, `sub:total`,
  `sub:assigned`, `sub:remaining`, `sub:valueBase`, `sub:valueStr`, `sub:passThrough` (ACTION.dim 138 -> 152). Manual payment
  answers (`choose` with a plan in `data`) now also get payExhaust / payRecycle pointers.
- Schema hash 1713244677 -> 2349895024 (schema.json, card table and the Python fixture regenerated). Re-run
  `tsx tools/encode-schema.ts` after merging and before training.
- This branch merges agent/enum (d46bb97, new files only) for the sub-choice test.
