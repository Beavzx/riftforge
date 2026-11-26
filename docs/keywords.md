# Riftforge Keywords Reference (all sets)

Baseline: Core Rules 1.5 (Radiance, PDF dated 2026-10-09, patch effective 2026-10-16), CR §800-832 plus
the action rules §408-446 and additional rules §700-766. Set patch notes (Spiritforged 2025-12-05,
Unleashed 2026-03-30, Vendetta 2026-07-17, Radiance 2026-10-09) and set FAQs. Paraphrased, not quoted.

Card-text conventions in `data/cards.raw.json` (`abilityEffective`):
- Keywords appear in square brackets: `[Assault 2]`, `[Hidden]`, `[Level 3][>]`, `[Empower] — [1], [T]`.
- `[S]` and `[M]` both mean Might (older printings use `[S]`); `[T]` and `[E]` both mean Exhaust.
- `[A]` = one power of any domain; `[C]` = one power of this card's domain; `[R] [G] [B] [O] [P] [Y]` =
  Fury, Calm, Mind, Body, Chaos, Order power; `[1]`..`[N]` = energy; `[Add]` = the Add action.
- `[>]` after a keyword marks a dependent/permissive/triggered keyword that governs the text after it.
- Some entries contain a stale `▲ / [OLD TEXT]` suffix (scraper artefact) — strip everything from `▲` on.
- Reminder text in parentheses has no rules effect (CR 135.2.d) — the parser should drop it.

General keyword rules (CR 801-803)
- A keyword can be referenced, granted or removed by effects. A grant/removal with no duration lasts while
  the object stays in its current zone (801.3.a.3, 801.3.b.2).
- Granting a keyword the object already has: the keyword's own rule decides (redundant vs stacking).
- Keyword effects on one card are processed top-to-bottom in printed order (803).
- **Stacking keywords** (values add): Assault, Shield, Deflect, Disarm, Hunt. Missing X = 1.
- **Redundant keywords** (extra copies do nothing): Accelerate, Ambush, Backline, Ganking, Tank,
  Temporary (triggers once), Hidden, Deploy, Quick-Draw.
- **Separate instances** (each works independently): Equip, Empower, Deathknell, Vision, Weaponmaster,
  Show Off, Repeat (each Repeat cost payable once), Flow (choose one cost).
- Inactive text (e.g. an attached card's rules text) still "has" its keywords for reference/targeting
  ("kill a unit with Temporary" can pick it), but they do nothing (722.1).

Legend: **Cat** = category (Passive / Triggered / Activated / Permissive / Optional additional cost /
Dependent / Deck constraint / Action-word). **Sets** = sets in which the keyword appears in the card data
(OGS Proving Grounds, OGN Origins, SFD Spiritforged, UNL Unleashed, VEN Vendetta, RAD Radiance).

---------------------------------------------------------------------------------------------------

## A. Keywords (CR 800-832)

### Accelerate — CR 805 — Optional additional cost — OGN SFD UNL VEN RAD
- Gist: "You may pay an extra cost as you play this unit; if you do it enters ready."
- Cost: **[1] energy + 1 power of one of the unit's domains** ([1][C]); a domainless unit uses [A].
- DECISION at Make Choices (play step 2): pay Accelerate or not. Only payable while playing the card.
- Paying creates a delayed replacement "enters ready" — so it still enters ready even if it loses
  Accelerate before finalizing (Unleashed FAQ: Atakhan killing Rek'Sai) (805.2.b).
- Does nothing on the board. Redundant. Entering ready via Accelerate is not "becoming ready" (doesn't
  trigger "when readied") (805.6.a).
- Cost reducers of optional additional costs (Ezreal, Prodigy) can reduce it (Spiritforged FAQ #24).
- Edge: a unit played via an effect that plays it ("play X from your trash") can still pay Accelerate
  unless the effect forbids it, since it's a normal play with overrides.

### Action — CR 806 (and 159.2.a) — Permissive — all sets
- Gist: "Play on your turn or in showdowns."
- The card/ability may also be played/activated in **Showdown Open** states (by the Focus holder), on any
  player's turn. Does NOT allow play in Closed states (that's Reaction).
- Doesn't override other restrictions (a unit with Action still needs a legal location).
- Conditional Action ("[Action] while X"): may be put on the chain if the condition could be true while it
  is on the chain; checked at Check Legality; if false, the play is undone and the card returns (Unleashed
  patch).
- On activated abilities `[Action] — cost: effect` or `[>]` form: the ability gets Action timing.

### Ambush — CR 822 — Passive (permission) — UNL VEN RAD
- Gist: "You may play me to a battlefield where you have units, and I have Reaction while doing so."
- Adds a play location: any battlefield where you control ≥1 unit (even one you don't control, e.g. during
  combat at an enemy battlefield). While being played there, the card has Reaction (so it can be played as a
  response in a Closed state, including on the opponent's turn and during combat).
- Choice made at Make Choices. If by finalization you no longer have units there, the permission fails and
  the play is undone (822.3).
- Played into an ongoing combat: the unit gets the attacker/defender designation in the next cleanup and
  contributes to combat damage. Units enter exhausted (exhausted units still deal combat damage).
- Redundant. As a verb ("give X Ambush" / "you may ambush"), grants the same permission.

### Assault X — CR 807 — Passive — all sets
- Gist: "+X Might while I'm an attacker."
- Applies while the unit has the Attacker designation (arithmetic layer). Stacks additively (Assault 3 +
  Assault 1 = Assault 4). X missing = 1.
- Edge: a unit that joins a combat on the attacking side mid-combat (e.g. via Ambush) gains Assault's
  bonus once it receives the designation (next cleanup).

### Backline — CR 826 — Passive (damage assignment) — UNL
- Gist: "I must be assigned combat damage last."
- During combat damage assignment, lethal must be assigned to every non-Backline unit of the same
  controller before any damage goes to this unit. Several Backline units: any order among themselves.
- A unit with both Tank and Backline: the assigning player picks which one applies (467.2.c.8).
- Redundant.

### Deathknell — CR 808 — Triggered (when killed) — OGN SFD UNL VEN RAD
- Gist: "When I die, do X."
- Triggers when the permanent is **killed** and goes to the trash (lethal damage in cleanup, or a kill
  instruction). Not on banish, recall, recycle, return to hand.
- Processed just BEFORE the permanent leaves: it goes on the chain as pending; its info (location "here",
  Might, controller) is recorded at that moment (808.1.d.2-3). If a replacement effect stops the death
  (e.g. "instead recall it"), the trigger is removed.
- Each instance triggers separately; controller orders them. Past tense in the effect refers to the
  moment of triggering.
- "When I die" abilities without the keyword use the same look-back (Vendetta patch #16).
- Combat: Deathknell triggers from combat deaths are put on the chain during the combat cleanup and resolve
  after the cleanup (468.2) — i.e. after surviving units have been healed and attackers recalled. (Derived
  from CR 468.1-468.2; the Origins FAQ asks this exact question about Kog'Maw but its answer text was not
  retrievable — treat as INFERENCE.)

### Deflect X — CR 809 — Passive (applied cost) — OGN SFD UNL VEN RAD
- Gist: "Opponents must pay [A] (X times) to choose me with a spell or ability."
- Each spell/ability controlled by an opponent that **targets** this permanent costs X additional power of
  any domain ([A] each) — a mandatory additional cost (356.2.a). Charged **once per choice** of this object
  (Spiritforged FAQ errata note: "Deflect once per choice"). Stacks (Deflect + Deflect 2 = Deflect 3).
- Not charged for non-targeting effects ("each enemy unit", combat damage) or for your own spells.
- Not reducible by "optional additional cost" reducers (Ezreal, Prodigy) (Spiritforged FAQ #25). Some
  battlefields let you ignore it (Heisho, Vendetta FAQ #31).

### Deploy — CR 830 — Passive + Triggered (gear) — RAD
- Gist (card reminder): "Play this only to a battlefield. When an opponent holds here, kill this."
- CR: the gear may be played or created at **any battlefield** — including one you don't control, an open
  one, or one with enemy units (830.1.b.1). It isn't recalled in cleanup step 5. It has "When an
  opponent holds here, kill this."
- Playing it to a battlefield you don't control does NOT contest it (it's not a unit), unless it becomes a
  unit (Radiance patch ruling: a Deploy gear that becomes a unit at a battlefield its controller doesn't
  hold contests it).
- Can be moved only by effects that move gear. Redundant.
- See open question in rules-spec §23 (whether base is a legal destination).
- Token: **Bomb** gear has Deploy.

### Disarm X — CR 831 — Triggered (attack trigger) — RAD
- Gist: "When I attack, give an enemy unit here −X Might this turn."
- Attack trigger (first time the unit gains Attacker in a combat). DECISION target: an enemy unit at this
  battlefield. Multiple Disarm instances/sources combine into ONE trigger using the summed X (831).
- "Reduce Might" interactions (Ahri, Confident): applying a −X effect counts as reducing Might even if the
  result floors at 0 (Radiance ruling).

### Equip [cost] — CR 818 — Activated (Equipment gear) — SFD UNL VEN RAD
- Gist: "[cost]: attach this to a unit you control."
- Activated ability of gear with the Equipment tag; default timing = your Main phase, Neutral Open (no Action
  unless granted). Cost may be energy/power or non-resource (e.g. "Equip — exhaust a unit").
- DECISION target: a unit you control (any location). On resolution the gear attaches (becomes "Equipped"
  on that unit; the unit is the top-most card).
- Can't be activated while the gear is attached (its rules text is inactive) — to move equipment between
  units use Weaponmaster or effects. If the unit dies/leaves, the gear stays on the board (detaches at the
  unit's last location, then is recalled to base in cleanup) and can be re-equipped.
- Multiple Equip instances = separate abilities.

### Flow [cost] — CR 829 — Passive (alternate cost + zone permission) — VEN
- Gist: "You may play this from your trash for its Flow cost. Then banish it."
- Allows playing the spell from your **trash** paying the Flow cost INSTEAD of its base cost (an alternate
  cost, chosen at finalization). Timing is unchanged (an Action spell is still only Action speed).
- If the card would leave the chain after finalizing (resolving or being countered), it is banished instead
  (delayed replacement) (Vendetta FAQ #1: countered by Abandon → banished).
- Several Flow costs: choose one.

### Ganking — CR 810 (144.4.c) — Passive (movement permission) — all sets
- Gist: "I can move from battlefield to battlefield."
- Adds the battlefield → battlefield route to this unit's Standard Move. No extra move, no cost change;
  still exhausts to move; still Main-phase Neutral Open only. Redundant.
- Edge: a group move with a Ganking and a non-Ganking unit from a battlefield to another battlefield is
  illegal for the non-Ganking unit (it can't be part of that move).

### Hidden — CR 811 (422) — Prerequisite for the Hide action — OGN SFD UNL VEN RAD
- Gist: "Hide now for [A] to react with later for [0]."
- **Hide** (discretionary action, your turn, Neutral Open — i.e. your Main phase outside chains/showdowns):
  pay **[A]** and place the card from your **hand or champion zone** facedown at a **battlefield you
  control** whose facedown zone is empty (max 1 facedown card per battlefield, 107.3.b). Hiding does not
  use the chain (it is not "playing" the card, so it doesn't satisfy Legion — derived from CR 422/812;
  the Origins FAQ asks this but its answer text was not retrievable).
- Starting with the **next turn** after it was hidden (in 1v1 that is the opponent's following turn; never
  the same turn it was hidden) and on every later turn, the facedown card has **Reaction** and may be played
  **ignoring its base cost** (additional costs still apply). Playing it uses the chain normally.
- Restrictions when played from facedown (811.1.d): a permanent must be played to **that battlefield**;
  each target of the spell / play effect must be at that battlefield (checked per target); a spell with no
  valid target under that restriction can't be played. Other abilities work normally.
  ENGINE (ENGINE-3, DECISIONS #2696/#11828, principle 12): a permanent's play effect uses the battlefield it was played to, read
  from its source — if the source has left the board the effect has no legal choice (finalization) or mistargets (resolution,
  811.1.d.3.a). A target group whose own text makes "here" impossible ("at a different location": Resonating Strike's unit,
  Smoke and Mirrors' second unit, Tideturner) is free (`anyLocation`, 811.1.d.4); the other groups stay restricted.
- It may instead be played normally (from hand/champion zone) for its cost without restrictions.
- If you lose control of that battlefield, the facedown card is trashed at the next cleanup (107.3.d,
  323.6.a); also trashed at combat resolution if the battlefield's controller ≠ its controller (468.5.c).
- A facedown card is NOT "a card with Hidden" and has no visible characteristics (811.5.a). Its Reaction
  property is hidden information. When a facedown card changes zones it is revealed (422.4).
- Recycling/"return to hand" of a facedown card: it's a new object; revealed.
- ENGINE: track `hiddenOnTurn` to enforce "next turn". The opponent sees a facedown card exists at a
  battlefield.

### Hunt X — CR 823 — Triggered (conquer + hold) — UNL VEN
- Gist: "When I conquer or hold, gain X XP."
- Both a Conquer effect and a Hold effect on the unit. Controller gains X XP. Stacks. X missing = 1.

### Legion — CR 812 — Dependent — OGN SFD UNL
- Gist: "Get the effect if you've played another card this turn."
- Text after `[Legion][>]` (or `[Legion] —`) is active only if its controller has **finalized a different
  card** this turn (812.1.c). One other card satisfies all Legion instances.
- "Card" = main-deck card (052): tokens, activated abilities and hiding do NOT count (derived from CR 052,
  812.1.c; INFERENCE for tokens — a played token is "played" but is not a card);
  playing a card from facedown counts. A countered card still counts (it was finalized).
- If the Legion text is a play effect ("Legion — when you play me, ready me"), the condition is evaluated
  when the trigger would fire.

### Level N — CR 824 — Dependent — UNL (referenced later)
- Gist: "While you have N+ XP, get the effect."
- Active while the controller has ≥ N XP; turns off if XP drops below N; re-evaluated on control change.

### Quick-Draw — CR 819 — Permissive + Triggered (Equipment) — SFD RAD
- Gist: "This has Reaction. When you play it, attach it to a unit you control."
- The Equipment card has Reaction (play from hand at reaction speed, any turn). Play effect: attach to a
  unit you control (DECISION target; no Equip cost). Does not change the Equip ability's timing.
- If no unit is available the trigger has no legal target and is removed; the gear stays in base.
- Redundant.

### Reaction — CR 813 (159.2.b) — Permissive — all sets
- Gist: "Play any time, even before spells and abilities resolve."
- Includes all Action permissions, plus play/activate in **any Closed state** (in response on the chain)
  when you hold priority, on any player's turn. Since it is added on top, it resolves before the items
  already on the chain.
- Rune "Add" abilities and the Gold token are Reaction abilities and may be used during cost payment.
- Conditional Reaction: like conditional Action.

### Repeat [cost] — CR 820 — Optional additional cost — SFD UNL
- Gist: "You may pay the Repeat cost as you play this to do its effect again."
- DECISION at Make Choices. Each Repeat instance payable once. On resolution the effect executes one more
  time; the repeat's choices (targets, destinations; same mode) are made when the spell is played, right after
  the Repeat cost is chosen, and may differ (CR 1.5 820.2/820.2.a; Deflect is paid per choice). Still played
  only once (Ravenbloom Student triggers once). (ENGINE-2 2026-11-26, DECISIONS principle 4.)
- Each execution is a new execution: "one or more" triggers trigger once per execution (Radiant Dawn, RJ#6584, DECISIONS
  principle 7), and a Repeat execution's choices count as choices of the spell (Prodigal Explorer, principle 6; "spells that choose
  me cost [1] less" — two Irelia, Graceful chosen by the spell and its repeat each discount, RJ#5435). (ENGINE-3.)
- Repeat repeats instructions, not cost reductions printed on the spell (Spiritforged FAQ #27).

### Shield X — CR 814 — Passive — all sets
- Gist: "+X Might while I'm a defender." Stacks; X missing = 1.

### Show Off [quality] — CR 832 — Passive (optional reveal) — RAD
- Gist: "As you play this, you may reveal a [quality] card from hand or pick another friendly [quality]."
- DECISION during finalization: reveal matching card(s) from hand and/or pick matching friendly objects on
  the board (not targeting). Linked text ("if you showed off", "its Might") reads the shown object's info
  locked at that moment (Radiance ruling: Primordial Roar/Star-Crossed). Facedown cards can't be shown off.
- Shown objects leaving afterwards doesn't undo it. Multiple instances separate.

### Tank — CR 815 — Passive (damage assignment) — OGN SFD UNL VEN RAD
- Gist: "I must be assigned combat damage first."
- Opposing assigner must assign lethal to all Tank units of that controller before non-Tank units; several
  Tank units in any order among themselves. Redundant.

### Temporary — CR 816 — Triggered — OGN SFD UNL RAD
- Gist: "Kill me at the start of your Beginning phase, before scoring."
- Trigger at the start of its controller's Beginning phase (beginning step, before the scoring step):
  kill this permanent. So a Temporary unit at a battlefield does NOT help hold it next turn.
- Multiple instances trigger once. An attached Equipment that was GRANTED Temporary (e.g. Turn to Dust)
  still dies (granted text stays active) (Unleashed FAQ #3-4).
- Token Sprite has Temporary.

### Unique — CR 825 — Deck construction — SFD
- Gist: "Your deck can have only 1 card with this name." No gameplay effect. Unique Signature cards still
  count toward the 3-Signature limit.

### Vision — CR 817 — Triggered (play effect) — OGN SFD UNL VEN
- Gist: "When you play me, look at the top card of your Main Deck. You may recycle it." (= Predict 1)
- Each instance triggers separately (each predicts; may see the same card again if not recycled).

### Weaponmaster — CR 821 — Triggered (play effect) — SFD UNL VEN RAD
- Gist: "When you play me, you may attach an Equipment you control to me, paying its Equip cost minus [A]."
- DECISION optional + choose an Equipment you control (attached to another unit or not; it may be moved
  off another unit). Pay its Equip cost reduced by one [A] (if the cost has no [A], pay it in full; a cost of
  just [A] becomes free). Not an Equip activation (Equip discounts don't apply). If not paid or impossible,
  the equipment stays where it is. No Equip cost → can't be used on it.

### Empower — CR 827 — Activated — VEN RAD
- Gist: "[Empower] — cost: Empower me. Use only if not Empowered."
- Activated ability (Main-phase timing unless granted Action/Reaction): pay the cost; the source becomes
  Empowered (not targeted). Normally can't activate if already Empowered; cards that allow multiple
  Empowered statuses (Kayle) can still activate at max, doing nothing (Radiance patch).
- Some Empower costs have conditional reductions ("costs [3] less if you control 4 or fewer runes").

### Empowered — CR 828 — Dependent — VEN (and status referenced everywhere)
- Text after `[Empowered][>]` is active while this object has the Empowered status. "When I become
  Empowered" triggers on gaining it. Empowered is a status (lost on leaving the board, not copied by copy
  effects — Vendetta FAQ #8). Disempower removes one Empowered status (443).

---------------------------------------------------------------------------------------------------

## B. Keyword actions and status words (bracketed in card text but defined as actions/states)

| Word | CR | Behaviour |
|---|---|---|
| **[Buff]** (RAD UNL) | 427, 701-705 | Put a +1 Might buff counter on a unit if it has none (max 1 normally). Already buffed → nothing (and "if it's already buffed ... instead" alternatives apply). "Spend a buff" removes it (only from units you control). Not targeting the counter; buffing a unit you *choose* does target the unit. |
| **[Stun]** (RAD VEN UNL) | 424 | Stunned status until the end-of-turn expiration (3d): unit deals **no combat damage** (contributes 0 Might); still needs full Might in damage to die; can't be re-stunned (no second "when you stun"). Stun doesn't exhaust or prevent moving/abilities. |
| **[Predict N]** (RAD VEN UNL) | 437 | Look at top N (1 if omitted), recycle any number, rest back on top in any order. No burn out. |
| **[Burn N]** (RAD VEN) | 441 | Top N of main deck → trash; too few → Burn Out then continue. |
| **[Mighty]** (state) (RAD UNL SFD OGN) | 706-711 | Might ≥ 5. "Becomes Mighty" = crosses up through 5. |
| **[Add] X** | 430 | Put resources in pool; ability-adds are instant (no chain wait). |
| **Recall** | 456-460 | Send to controller's base without moving; keeps damage/statuses. |
| **Recycle** | 417 | Bottom of owner's deck (runes: rune deck). |
| **Channel N** | 431 | Top N runes → base, ready. |
| **Ready / Exhaust ([T]/[E])** | 415-416 | Cost "[T]" = exhaust this (must be ready). |
| **Kill / Banish / Discard / Counter / Reveal / Heal / Deal / Move / Play / Create / Replace / Double / Swap / Skip / Prevent / Pay / Copy / Attach / Detach / Disempower** | 408-446 | See rules-spec §11. |
| **Gain / spend XP** | 728-733 | Player resource; Hunt/Level. |
| **Score N points** | 470.2 | Gain N points (not the Scoring process; not limited by the final-point rule). |
| **Conquer / Hold** | 471, 383.4.c-d | Scoring methods; trigger words "When I/you conquer/hold". |
| **Pick** | Radiance patch | Non-targeting selection ("choose" = targeting). |
| **Unique, Signature, Champion** | 103.3, 825, 133.7 | Deck-building words; Champion/Signature are supertypes. |

## C. Status flags the engine must track per object
Exhausted/Ready, Stunned, Buffed (counter), Empowered (count), Attacker/Defender designation, Attached /
Top-most, Facedown (+ turn hidden), Revealed, Contested (battlefield, + contesting player), Damage marked,
XP (player), Prevent value(s) (delayed replacements), "entered this turn", "scored this turn" (per
battlefield per player), counts for "this turn" checks (cards played/finalized, units died, burned, etc.).

## D. Defined tokens (CR 187) — see rules-spec §18
Recruit 1 · Sprite 3 (Temporary) · Sand Soldier 2 · Mech 3 · Gold (gear, Reaction: kill+exhaust → add
[A]) · Reflection 0 · Bird 1 (Deflect) · Brush (battlefield) · Baron Pit (battlefield) · Tentacle 1 ·
Shadow Clone 0 (attack: may banish a unit from trash → Assault 4) · Bomb (gear, Deploy, Deathknell 2 dmg).

## E. Coverage check against card data (2026-11-25)
Every bracketed keyword found in `data/cards.raw.json` is covered above: Accelerate, Action, Ambush,
Assault, Backline, Buff, Burn, Deathknell, Deflect, Deploy, Disarm, Empower, Empowered, Equip, Flow,
Ganking, Hidden, Hunt, Legion, Level, Mighty, Predict, Quick-Draw, Reaction, Repeat, Shield, Show Off,
Stun, Tank, Temporary, Unique, Vision, Weaponmaster. Promo/Proving Grounds (OGS) cards introduce no new
keywords. No keyword was found in official set articles that is absent from CR 1.5 §800-832.
