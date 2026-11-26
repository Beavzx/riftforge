# Riftforge Deck Import / Export Formats

Sources (2026-11-25): `@piltoverarchive/riftbound-deck-codes` npm package v1.5.0 (README, CHANGELOG,
dist/deckCode.js — format adapted from Riot's LoR deck codes), Piltover Archive deck pages, magicalmeta.ink
plain-text export, riftformat-tools (GitHub), silhouette-card-maker Riftbound plugin docs (TTS format).
There is **no official Riot deck-code spec**; Piltover Archive's code is the de-facto community standard
(also used on deck links like `piltoverarchive.com/deckbuilder?code=...`).

The importer should auto-detect: (1) a single token of `[A-Z2-7]+` → deck code; (2) lines with section
headers → sectioned text; (3) space-separated `SET-NNN-N` tokens → TTS; (4) otherwise `count name` lines →
plain text with type inference.

---------------------------------------------------------------------------------------------------

## 1. Card identifiers

Card codes in deck codes / TTS: `SET-NUMBER[VARIANT]`, e.g. `OGN-007`, `OGN-007a`, `SFD-190`, `UNL-R01`,
`VEN-SP1a`, `OGN-103s` / `OGN-103*` (signed).
- SET: OGN, OGS, ARC, SFD, UNL, VEN, RAD.
- NUMBER: 3 digits zero-padded (`007`); rune cards `R` + 2 digits (`R01`..`R06`); special `SP` + unpadded
  number (`SP1`).
- VARIANT: none (base), `a` (alt art A), `b` (alt art B), `s` or `*` (signed).

Mapping to `data/cards.raw.json` `cardCode` (lower-case, `set-number-setsize`): `OGN-007` ↔ `ogn-007-298`,
`OGN-007a` ↔ `ogn-007a-298`, `RAD-001` ↔ `rad-001-167`, `RAD-SP1` ↔ `rad-sp1-005`, `RAD-R01` ↔ `rad-r01`,
`UNL-T08` ↔ `unl-t08` (token). Rule: lower-case; match on `setCode` + the part of `cardNumber` before the
first `-` (that part includes the variant letter). Alternate arts and signed variants map to the base card
for rules (ARCHITECTURE: alt arts share the base script); keep the variant for display only. Variant `s`
has no separate entry in the data — strip it.

Verified examples from the data: OGN-007 Fury Rune, OGN-089 Mind Rune, OGN-166 Chaos Rune, OGN-247
Daughter of the Void (legend), OGN-280 Grove of the God-Willow, OGN-288 Startipped Peak, OGN-292 The
Dreaming Tree, OGN-298 Zaun Warrens (battlefields), OGN-103 Ravenbloom Student (unit), OGN-004 Cleave
(spell).

---------------------------------------------------------------------------------------------------

## 2. Piltover Archive deck code (binary, base32)

### 2.1 Envelope
- String alphabet: RFC 4648 base32 `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`, upper-case, **no `=` padding**.
  Decode: accumulate 5 bits per char, emit a byte whenever ≥8 bits are buffered, discard the leftover <8
  bits at the end. (Accept lower-case input by upper-casing.)
- Integers are **varints, LEB128 style**: 7 data bits per byte, least-significant group first, high bit
  (0x80) = "more bytes follow". (Verified by decoding the two sample codes below — they consume exactly all
  bytes.)
- Single raw bytes (not varints) are used for: header, set id, variant id, prefix flags, champion presence.

### 2.2 Header
- Byte 0: high nibble = **format** (always 1), low nibble = **version** (1-6). Reject format ≠ 1 or
  version > 6.
- Encoders use the lowest version that fits: V3 normal decks; V4 if any rune-number card (`R01`); V5 if
  any count > 12 in main / > 3 in sideboard, or any `SP` card; V6 if additional legends (Neeko).

| Ver | Date | Adds |
|---|---|---|
| 1 | 2025-04-01 | main deck only |
| 2 | 2025-11-20 | sideboard |
| 3 | 2026-01-10 | chosen champion trailer |
| 4 | 2026-03-04 | rune-number cards: a flag byte before every card number |
| 5 | 2026-07-15 | sparse counts (any count), `SP` prefix, deck-level prefix bit |
| 6 | 2026-09-19 | additional-legends block |

Set ids: 0 OGN, 1 OGS, 2 ARC, 3 SFD, 4 UNL, 5 VEN, 6 RAD. Variant ids: 0 base, 1 `a`, 2 signed, 3 `b`.

### 2.3 Body layout (decoder pseudocode)
```
header = byte(); format = header >> 4; version = header & 0xF
flagged = (version >= 5) ? (byte() == 1) : (version >= 4)       # V5: deck-level prefix byte (0/1)

readCardNumber():
  if flagged:
    f = byte()                       # 0 normal, 1 rune, 2 special
    if f == 0: return pad3(varint())
    if f == 1: return "R" + pad2(varint())
    if f == 2 and version >= 5: return "SP" + varint()
    error
  return pad3(varint())

readGroups(count, out):
  nLists = varint()
  repeat nLists:
    nCards = varint(); set = byte(); variant = byte()
    repeat nCards: out.add(count × SET[set] + "-" + readCardNumber() + VARIANT[variant])

MAIN:  if version >= 5: nCounts = varint(); repeat: count = varint(); readGroups(count, main)
       else: for count in 12, 11, ..., 1: readGroups(count, main)      # every count present, maybe 0 lists
SIDE:  if version >= 5: same sparse form
       elif version >= 2: for count in 3, 2, 1: readGroups(count, side)
       else: side = []
CHAMP: if version >= 3: if byte() == 1: champion = byte set, byte variant, readCardNumber()
LEGENDS (V6): n = varint(); repeat n: legend = byte set, byte variant, readCardNumber()
```
Encoder ordering (for byte-identical round trips): within a count, lists ordered by set id then variant id
ascending; cards in a list by card number (numeric compare of digit runs).

### 2.4 What the list contains
The code is a **flat list of every card in the deck**: legend (1×), chosen champion (counted inside the
main list as one of its copies), main deck cards, runes (e.g. 7× Fury Rune), battlefields (1× each). There
are no sections — the importer must **classify by card type** from the card DB: Legend → legend; Rune →
runes; Battlefield → battlefields; everything else → main. The V3 champion trailer names which main-deck
card is the Chosen Champion (it is ALSO counted in the main list). For V1/V2 codes (no trailer), ask the user
to pick the champion (DECISION in deck builder) or default to the first Champion-supertype unit whose tag
matches the legend.

### 2.5 Test vectors (decoded locally with the algorithm above)
V2 (Kai'Sa, from the package README):
```
CIAAAAAAAAAQCAAAA4AACAIAABMQAAILAAAAICIMDMOVOX3AM5UHIAIDAAACO6XYAEAQKAAABX3QDGACUABKIAQAAEBQAAAWDBOQCAQAABMHE
```
→ format 1, version 2, 68 bytes. Main: 7× OGN-007, 5× OGN-089, 3× OGN-004, 3× OGN-009, 3× OGN-012,
3× OGN-027, 3× OGN-029, 3× OGN-087, 3× OGN-095, 3× OGN-096, 3× OGN-103, 3× OGN-104, 3× OGN-116,
2× OGN-039, 2× OGN-122, 2× OGN-248, 1× OGN-013, 1× OGN-247 (legend), 1× OGN-280, 1× OGN-288,
1× OGN-292 (battlefields). Sideboard: 2× OGN-022, 2× OGN-024, 2× OGN-093, 1× OGN-088, 1× OGN-114.
Same main deck without sideboard ends `...QAAAAA` (also V2).

V3 (Annie, from a Piltover Archive deck page):
```
CMAAAAAAAAAQCAAAA4AACAIAACTACAABBMAAABAYDMSCPKABVUA3AANWAG3QDOIBAIAQAAANAEAQACYCAUAAAHNJAGRAFJACVIBAEAIABIIQAAIDAAAKSANMAG2ACAICAAAB2IYBAEAAU
```
→ version 3, 88 bytes. Main: 7× OGN-007 (Fury Rune), 5× OGN-166 (Chaos Rune), 3× OGN-004, 3× OGN-024,
3× OGN-027, 3× OGN-036, 3× OGN-039, 3× OGN-168, 3× OGN-173, 3× OGN-176, 3× OGN-182, 3× OGN-183,
3× OGN-185, 2× OGN-013, 2× OGS-011, 1× OGN-029, 1× OGN-169, 1× OGN-290, 1× OGN-292, 1× OGN-298,
1× OGS-010, 1× OGS-017. Sideboard: 2× OGN-169, 2× OGN-172, 2× OGN-180, 1× OGN-029, 1× OGN-035.
Champion trailer: OGS-010.

Unit tests for the codec should decode both vectors to the lists above and re-encode to the same string.

---------------------------------------------------------------------------------------------------

## 3. Sectioned plain text (Piltover Archive "Export", magicalmeta.ink, riftformat-tools)

```
Legend:
1 Miss Fortune, Bounty Hunter

Champion:
1 Miss Fortune, Captain

MainDeck:
3 Mindsplitter
3 Challenge
...

Battlefields:
1 Forgotten Monument
1 Sigil of the Storm
1 <third battlefield>

Runes:
6 Chaos Rune
6 Body Rune

Sideboard:
3 Unyielding Spirit
2 Gust
```
Parsing rules:
- Section header = a line ending in `:`; match case-insensitively and ignoring spaces: `Legend`,
  `Champion` / `Chosen Champion`, `MainDeck` / `Main Deck` / `Main`, `Battlefields` / `Battlefield`,
  `Runes` / `Rune Pool` / `Runepool` / `Rune Deck`, `Sideboard` / `Side Deck`. Blank lines optional.
- Card line = `<count> <name>`; also accept `<count>x <name>` and `<name> x<count>`. Name includes the
  subtitle after a comma (`Jinx, Rebel`). Match names case-insensitively, normalising curly quotes /
  apostrophes (`Kai'Sa`), en/em dashes, and extra spaces.
- **Champion vs MainDeck count**: in this format the champion is listed ONLY under `Champion:` and the
  `MainDeck:` section has 39 cards (the site shows "Main Deck (39)"); the total main deck is 39 + 1 = 40.
  Some exporters instead also include the champion inside MainDeck (40). Importer: if the MainDeck section
  already contains a copy of the champion card AND MainDeck totals 40, don't add another.
- Runes are named `Fury Rune`, `Calm Rune`, `Mind Rune`, `Body Rune`, `Chaos Rune`, `Order Rune`; map to the
  base-art rune card id of any set (they're functionally identical; prefer OGN printing).
- If a name matches several printings, pick the base (non-alt-art) printing from the newest set unless a
  set code is given in brackets, e.g. `3 Cleave (OGN-004)` — accept an optional trailing `(SET-NNN)`.

## 4. Unsectioned plain text (`count name` only, e.g. Piltover Archive "piltover_archive" plugin format)
```
1 Viktor, Herald of the Arcane
1 Viktor, Leader
3 Seal of Unity
...

12 Order Rune
```
Blank lines separate groups but there are no headers. Classify by card type from the DB: Legend type →
legend; Rune → runes; Battlefield → battlefields; Unit/Gear/Spell → main. Champion: the Chosen Champion
can't be determined reliably; pick the first Champion-supertype unit matching the legend tag, and let the
user change it. A trailing group after the runes may be the sideboard — not recoverable; treat all
non-rune/legend/battlefield cards as main and warn if main > 40.

## 5. Tabletop Simulator (TTS) string
```
OGN-265-1 OGN-246-1 OGN-245-1 OGN-004-1 OGN-004-1 OGN-004-1 ...
```
Space-separated tokens `SET-NNN-K`, one token per physical card (3 copies = 3 tokens). The trailing `-K`
is a copy/printing index — ignore it for identity. Classify by type as in §4. (Format as documented by the
silhouette-card-maker Riftbound plugin; sections not present.)

## 6. Pixelborn codes
Base64-looking strings ending in `==` from the defunct Pixelborn simulator (shut down 2025-08-07). Layout
undocumented — NOT supported; show "unsupported format".

## 7. Export (what Riftforge should emit)
- Primary: Piltover Archive deck code V3 (V4 if rune-number cards, V6 if additional legends) — round-trips
  with the community tools.
- Secondary: the sectioned text format of §3 (champion listed under `Champion:`, MainDeck without it,
  `Runes:` header, `Sideboard:` only if non-empty).

## 8. Validation after import
Run the deck legality checks in rules-spec §13 and show per-rule errors (count, copies, domain identity,
champion tag match, signature limit, 12 runes, 3 distinct battlefields, sideboard ≤ 10, banned cards) with
a "play anyway (casual)" option.
