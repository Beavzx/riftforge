// ENCODE: neural-net interface for Riftforge (see docs/agents/encoder.md).
import { ACTION, ACTION_TYPES, ABILITY_BUCKETS, LABEL_BUCKETS, MAX_PTRS, PTR_ROLES } from './actions.ts';
import { cardIndex, staticTable, PAD_IDX, UNKNOWN_IDX, FIRST_CARD_IDX } from './cards.ts';
import { ENCODER_VERSION, ENTITY, GLOBAL, MAX_ENTITIES, MAX_BF } from './obs.ts';
import { schemaHash, OBS_MAGIC, RES_MAGIC, OBS_HEADER_WORDS, RES_HEADER_WORDS } from './wire.ts';

export { encodeObservation, observedState, toPadded, GLOBAL, ENTITY, MAX_ENTITIES, MAX_BF, ENCODER_VERSION } from './obs.ts';
export type { Observation } from './obs.ts';
export { encodeActions, encodeSubChoices, ACTION, MAX_PTRS, PTR_ROLES, ACTION_TYPES } from './actions.ts';
export type { EncodedActions, SubChoice, SubChoiceOption } from './actions.ts';
export { cardIndex, cardIdxOf, staticTable, PAD_IDX, UNKNOWN_IDX } from './cards.ts';
export { packObs, unpackObs, packResult, unpackResult, withLength, obsFrameBytes, schemaHash } from './wire.ts';

/** Everything the Python side needs to build tensors (dims + feature names + wire constants). */
export function schema() {
  const st = staticTable();
  return {
    version: ENCODER_VERSION, schemaHash: schemaHash(),
    maxEntities: MAX_ENTITIES, maxBattlefields: MAX_BF, maxPtrs: MAX_PTRS, labelBuckets: LABEL_BUCKETS,
    global: { dim: GLOBAL.dim, names: GLOBAL.names },
    entity: { dim: ENTITY.dim, names: ENTITY.names },
    action: { dim: ACTION.dim, names: ACTION.names, types: ACTION_TYPES, abilityBuckets: ABILITY_BUCKETS },
    ptrRoles: PTR_ROLES,
    cards: { padIdx: PAD_IDX, unknownIdx: UNKNOWN_IDX, firstCardIdx: FIRST_CARD_IDX, nRows: st.nRows, staticDim: st.dim, staticNames: st.featureNames, textDim: st.textDim, nCards: cardIndex().ids.length },
    wire: { obsMagic: OBS_MAGIC, resMagic: RES_MAGIC, obsHeaderWords: OBS_HEADER_WORDS, resHeaderWords: RES_HEADER_WORDS, endian: 'little', lengthPrefix: 'u32' },
  };
}
