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
encodeSubChoices(state, player, sub: { kind: string; prompt?; partial?; options: { label; objIds?; value?; isDone? }[] }, obs): EncodedActions
  // same layout, type "subChoice" — for the factored sub-choice layer in src/ai/env/
packObs(obs, acts, tag = 0, out?, offset?): Uint8Array      unpackObs(buf)
packResult(tag, value, logits, extra = []): Uint8Array      unpackResult(buf)
withLength(frame): Uint8Array   // u32 length prefix for streams
obsFrameBytes(nE, nA), schemaHash(), schema()
GLOBAL / ENTITY / ACTION: { names, at: Record<name, column>, dim }   MAX_ENTITIES, MAX_PTRS, MAX_BF, PTR_ROLES, ACTION_TYPES
cardIndex(), cardIdxOf(cardId), staticTable()   // PAD_IDX 0, UNKNOWN_IDX 1, cards from 2
```

Use `observedState(state, player)` if you need the exact board the player observes (UI-CANCEL pre-play board).
Only 1v1 is encoded properly ("opp" = the other player); FFA/2v2 would need per-opponent slots.

## Dims (schema hash 1713244677)

| part | dim |
|---|---|
| global | 167 |
| entity (dynamic) | 108 |
| action row | 138 |
| pointers per action | 12 (roles: none, source, option, moved, destination, payExhaust, payRecycle, damage, pendingSource) |
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

- `tsx --test tests/ai/encode/leak.test.ts tests/ai/encode/actions.test.ts`
- `python3 -m unittest discover -s python/tests` (decodes TS-written frames byte-exactly, collation, result frames)

## API changes

None since the WIP commit 529970a (names and frame layouts unchanged; only internals and new files).
