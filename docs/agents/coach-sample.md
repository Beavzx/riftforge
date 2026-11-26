# Coach sample output

Generated with:

```
node --import tsx tools/review.ts --sim 25 --decks 02-vex.json,06-kai-sa.json --budget medium --out review
```

"You" is the heuristic rules bot (src/engine/bot.ts) piloting Vex; the opponent is SearchAI on Kai'Sa. So the
"mistakes" below are the rules bot's, judged by the search AI (25 s on a loaded 2-core box). The markdown is reproduced
unedited.

---

# Game review: You (vex) (Gloomist) vs Opponent (kai-sa) (Daughter of the Void)

Result: you lost, 7-8 on turn 14. Reviewed from You (vex)'s side, 26 decisions analysed (budget "medium", 25 s).

Win chances are the bot's estimate: a hand-tuned evaluation mapped to a probability by a logistic fit on bot-vs-bot games. Treat gaps under ~3% as noise and the opponent's cards in an "expected line" as guesses (sampled from their decklist).

## Overview

- Moves matching the bot's top choice: 16/26
- Average estimated cost per decision: 4.7%
- Decisions costing more than 5%: 6; more than 10%: 4

Estimated win chance at the start of your turns: T1 53%, T3 33%, T5 26%, T7 15%, T9 12%, T11 16%, T13 29%

## Biggest mistakes

### 1. Turn 7, mainAction: "Your turn: play cards, move units, or end your turn" (cost 41.3%)

Situation:
```
Turn 7 (your turn), phase action, deciding: mainAction - "Your turn: play cards, move units, or end your turn".
Points: you 2, opponent 3. Runes in play: you 7 (7 ready), opponent 3.
Your hand: The Good Stuff, Astral Heron, Astral Heron, Scuttle Crab. Opponent hand: 3 cards. Decks: you 31, opponent 30.
Base units: you Sneaky Deckhand 2, Steel Paws 0; opponent none.
Battlefield 1 (Bandle Scouts' Academy): opponent controls. You: none. Opponent: Lecturing Yordle 2, Noxus Hopeful 4 (exhausted).
Battlefield 2 (Rockfall Path): opponent controls. You: none. Opponent: Kai'Sa 4 (exhausted).
```
- You played: **Play Astral Heron to base** (estimated win chance 21%)
- Bot preferred: **Activate Steel Paws: Empower** (62%)
- All options considered:
  - 62% Activate Steel Paws: Empower
  - 59% Move Sneaky Deckhand to Battlefield 1 (Bandle Scouts' Academy)
  - 55% Move Sneaky Deckhand to Battlefield 2 (Rockfall Path)
  - 21% Play Astral Heron to base (played)
  - 20% Move Steel Paws to Battlefield 1 (Bandle Scouts' Academy)
  - 17% Play The Good Stuff to Battlefield 1 (Bandle Scouts' Academy)
- Bot's expected line after its move:
  - T7 you: Activate Steel Paws: Empower
  - T7 you: Move Steel Paws to Battlefield 2 (Rockfall Path)
  - T7 opp: Play Stupefy (sampled)
  - T7 opp: Target: Steel Paws @Rockfall Path (sampled)
  - T7 you: Move Sneaky Deckhand to Battlefield 1 (Bandle Scouts' Academy)
  - T7 you: End turn
  - T8 opp: Play Lecturing Yordle to base (sampled)
  - T8 opp: Activate Daughter of the Void: Add A (spells only) (sampled)
  - T8 opp: End turn (sampled)
- Opponent's 3-card hand (from their decklist): removal 97%, reaction 42%, draw 51%. Most likely cards: Thousand-Tailed Watcher 28%, Ferrous Forerunner 27%, Bilgewater Tracker 26%, Plundering Poro 26%, Stupefy 24%.

### 2. Turn 4, chainResponse: "Respond to the chain or pass" (cost 30.7%)

Situation:
```
Turn 4 (opponent's turn), phase action, deciding: chainResponse - "Respond to the chain or pass".
Points: you 1, opponent 0. Runes in play: you 3 (0 ready), opponent 4.
Your hand: The Good Stuff, Astral Heron, Sneaky Deckhand, Steel Paws. Opponent hand: 5 cards. Decks: you 33, opponent 32.
Base units: you Vex 4 (exhausted); opponent Kai'Sa 4 (exhausted), Lecturing Yordle 2.
Battlefield 1 (Bandle Scouts' Academy): you control. You: Steel Paws 0 (exhausted). Opponent: none; facedown: your Tornado Warrior.
Battlefield 2 (Rockfall Path): uncontrolled. You: none. Opponent: none.
Chain (top last): their Hextech Ray.
```
- You played: **Pass** (estimated win chance 45%)
- Bot preferred: **Play Tornado Warrior (from facedown) to Battlefield 1 (Bandle Scouts' Academy)** (76%)
- Bot's expected line after its move:
  - T4 you: Play Tornado Warrior (from facedown) to Battlefield 1 (Bandle Scouts' Academy)
  - T4 you: Choose (Tornado Warrior: empower something here (disempower it at end of tu...): Yes
  - T4 you: Target: Steel Paws @Bandle Scouts' Academy
  - T4 opp: Move Lecturing Yordle to Battlefield 2 (Rockfall Path) (sampled)
  - T4 opp: End turn (sampled)
- Opponent's 5-card hand (from their decklist): removal 100%, reaction 65%, draw 67%. Most likely cards: Stupefy 42%, Plundering Poro 37%, Falling Star 36%, Watchful Sentry 35%, Bilgewater Tracker 34%.

### 3. Turn 13, mainAction: "Your turn: play cards, move units, or end your turn" (cost 13.3%)

Situation:
```
Turn 13 (your turn), phase action, deciding: mainAction - "Your turn: play cards, move units, or end your turn".
Points: you 7, opponent 7. Runes in play: you 10 (1 ready), opponent 7.
Your hand: The Good Stuff, Star-Crossed, Abandon. Opponent hand: 1 cards. Decks: you 26, opponent 27.
Base units: you Astral Heron 9, Scuttle Crab 2, Kharox 7 (exhausted), Tornado Warrior 5 (exhausted); opponent none.
Battlefield 1 (Bandle Scouts' Academy): opponent controls. You: none. Opponent: Lecturing Yordle 2, Noxus Hopeful 4, Noxus Hopeful 4, Watchful Sentry 1, Plundering Poro 2 (exhausted).
Battlefield 2 (Rockfall Path): you control. You: Steel Paws 2. Opponent: none.
Battlefield 3 (Baron Pit): you control. You: Baron Nashor 12. Opponent: none.
```
- You played: **End turn** (estimated win chance 48%)
- Bot preferred: **Move Astral Heron to Battlefield 1 (Bandle Scouts' Academy)** (61%)
- All options considered:
  - 61% Move Astral Heron to Battlefield 1 (Bandle Scouts' Academy)
  - 61% Move Scuttle Crab to Battlefield 2 (Rockfall Path)
  - 60% Move Steel Paws to base
  - 60% Move Steel Paws to Battlefield 3 (Baron Pit)
  - 55% Move Scuttle Crab to Battlefield 1 (Bandle Scouts' Academy)
  - 55% Move Astral Heron to Battlefield 2 (Rockfall Path)
- Bot's expected line after its move:
  - T13 you: Move Astral Heron to Battlefield 1 (Bandle Scouts' Academy)
  - T13 you: Assign combat damage: 2 to Lecturing Yordle, 1 to Watchful Sentry, 2 to Plundering Poro, 4 to Noxus Hopeful
  - T13 you: Move Scuttle Crab to Battlefield 2 (Rockfall Path)
  - T13 you: End turn
- Opponent's 1-card hand (from their decklist): removal 58%, reaction 22%, draw 35%. Most likely cards: Stupefy 15%, Lecturing Yordle 11%, The Empyrean 9%, Thousand-Tailed Watcher 8%, Watchful Sentry 8%.

### 4. Turn 5, mainAction: "Your turn: play cards, move units, or end your turn" (cost 10.9%)

Situation:
```
Turn 5 (your turn), phase action, deciding: mainAction - "Your turn: play cards, move units, or end your turn".
Points: you 1, opponent 1. Runes in play: you 5 (5 ready), opponent 4.
Your hand: The Good Stuff, Astral Heron, Sneaky Deckhand, Steel Paws, Astral Heron. Opponent hand: 5 cards. Decks: you 32, opponent 32.
Base units: you Vex 4; opponent Kai'Sa 4 (exhausted).
Battlefield 1 (Bandle Scouts' Academy): opponent controls. You: none. Opponent: Lecturing Yordle 2 (exhausted).
Battlefield 2 (Rockfall Path): uncontrolled. You: none. Opponent: none.
```
- You played: **Move Vex to Battlefield 2 (Rockfall Path)** (estimated win chance 64%)
- Bot preferred: **Move Vex to Battlefield 1 (Bandle Scouts' Academy)** (75%)
- All options considered:
  - 75% Move Vex to Battlefield 1 (Bandle Scouts' Academy)
  - 75% Play The Good Stuff to Battlefield 1 (Bandle Scouts' Academy), paying by exhausting Chaos rune, Chaos rune and Chaos rune and with extra cost choices
  - 74% Play The Good Stuff to Battlefield 2 (Rockfall Path), paying by exhausting Chaos rune, Chaos rune and Chaos rune and with extra cost choices
  - 73% Play Steel Paws to base
  - 73% Play Sneaky Deckhand to base
  - 72% Activate Gold: Kill this, Exhaust: Add A.
- Bot's expected line after its move:
  - T5 you: Move Vex to Battlefield 1 (Bandle Scouts' Academy)
  - T5 you: Play The Good Stuff to Battlefield 1 (Bandle Scouts' Academy), paying by exhausting Chaos rune, Chaos rune and Chaos rune and with extra cost choices
  - T5 you: Choose cards: Steel Paws
  - T5 you: Hide Bedeviling Stranger facedown at Battlefield 1 (Bandle Scouts' Academy) (card drawn in this sample)
  - T5 you: End turn
  - T6 opp: Move Kai'Sa to Battlefield 2 (Rockfall Path) (sampled)
  - T6 opp: Play Noxus Hopeful to base (sampled)
  - T6 opp: Play Plundering Poro to base (sampled)
  - T6 opp: Activate Daughter of the Void: Add A (spells only) (sampled)
  - T6 opp: End turn (sampled)
- Opponent's 5-card hand (from their decklist): removal 100%, reaction 54%, draw 66%. Most likely cards: Falling Star 42%, Thousand-Tailed Watcher 40%, Stupefy 38%, Watchful Sentry 37%, Bilgewater Tracker 37%.

### 5. Turn 11, mainAction: "Your turn: play cards, move units, or end your turn" (cost 7.7%)

Situation:
```
Turn 11 (your turn), phase action, deciding: mainAction - "Your turn: play cards, move units, or end your turn".
Points: you 5, opponent 6. Runes in play: you 8 (1 ready), opponent 5.
Your hand: The Good Stuff, Star-Crossed, Kharox. Opponent hand: 1 cards. Decks: you 28, opponent 28.
Base units: you Astral Heron 9, Scuttle Crab 2; opponent none.
Battlefield 1 (Bandle Scouts' Academy): opponent controls. You: none. Opponent: Lecturing Yordle 2, Noxus Hopeful 4, Noxus Hopeful 4, Watchful Sentry 1.
Battlefield 2 (Rockfall Path): you control. You: Steel Paws 2 (exhausted). Opponent: none.
Battlefield 3 (Baron Pit): you control. You: Baron Nashor 12 (exhausted). Opponent: none.
```
- You played: **End turn** (estimated win chance 72%)
- Bot preferred: **Move Astral Heron and Scuttle Crab to Battlefield 1 (Bandle Scouts' Academy)** (80%)
- All options considered:
  - 80% Move Astral Heron and Scuttle Crab to Battlefield 1 (Bandle Scouts' Academy)
  - 73% Move Astral Heron to Battlefield 2 (Rockfall Path)
  - 72% Move Scuttle Crab to Battlefield 2 (Rockfall Path)
  - 72% End turn (played)
  - 72% Move Astral Heron to Battlefield 3 (Baron Pit)
  - 72% Move Scuttle Crab to Battlefield 3 (Baron Pit)
- Bot's expected line after its move:
  - T11 you: Move Astral Heron and Scuttle Crab to Battlefield 1 (Bandle Scouts' Academy)
  - T11 you: Assign combat damage: 2 to Lecturing Yordle, 1 to Watchful Sentry, 4 to Noxus Hopeful, 4 to Noxus Hopeful
  - T11 opp: Assign combat damage: 2 to Scuttle Crab, 9 to Astral Heron (sampled)
  - T11 you: End turn
  - T12 opp: Play Ferrous Forerunner to base (sampled)
  - T12 opp: Activate Daughter of the Void: Add A (spells only) (sampled)
  - T12 opp: End turn (sampled)
- Opponent's 1-card hand (from their decklist): removal 57%, reaction 13%, draw 23%. Most likely cards: Plundering Poro 11%, Bellows Breath 10%, The Empyrean 10%, Thousand-Tailed Watcher 10%, Ferrous Forerunner 9%.

## All analysed decisions

| Turn | Decision | You played | Bot preferred | Cost |
|---|---|---|---|---|
| 0 | mulligan | Mulligan (set aside): Astral Heron | (same) |  |
| 1 | mainAction | Play Steel Paws to base | (same) |  |
| 3 | mainAction | Move Steel Paws to Battlefield 1 (Bandle Scouts' Academy) | Move Steel Paws to Battlefield 2 (Rockfall Path) | 2.1% |
| 3 | mainAction | Play Vex (champion) to base | Play Vex (champion) to Battlefield 1 (Bandle Scouts' Academy) | 2.2% |
| 3 | mainAction | Hide Tornado Warrior facedown at Battlefield 1 (Bandle Scouts' Academy) | (same) |  |
| 4 | chainResponse | Pass | Play Tornado Warrior (from facedown) to Battlefield 1 (Bandle Scouts' Academy) | 30.7% |
| 5 | mainAction | Move Vex to Battlefield 2 (Rockfall Path) | Move Vex to Battlefield 1 (Bandle Scouts' Academy) | 10.9% |
| 5 | showdownAction | Pass (no more showdown actions) | (same) |  |
| 5 | mainAction | Play Sneaky Deckhand to base | Play The Good Stuff to Battlefield 2 (Rockfall Path), paying by exhausting Chaos rune, Chaos rune and Chaos rune and with extra cost choices | 7.1% |
| 5 | mainAction | Play Steel Paws to base | (same) |  |
| 5 | mainAction | Activate Gold: Kill this, Exhaust: Add A. | End turn | 1.1% |
| 7 | mainAction | Play Astral Heron to base | Activate Steel Paws: Empower | 41.3% |
| 7 | mainAction | End turn | (same) |  |
| 9 | mainAction | Play Astral Heron to base | (same) |  |
| 9 | mainAction | Move Astral Heron to Battlefield 2 (Rockfall Path) | (same) |  |
| 9 | mainAction | Move Sneaky Deckhand to Battlefield 2 (Rockfall Path) | (same) |  |
| 9 | mainAction | Play Scuttle Crab to base | (same) |  |
| 9 | mainAction | End turn | (same) |  |
| 11 | mainAction | Play Baron Nashor to base | (same) |  |
| 11 | mainAction | Move Steel Paws to Battlefield 2 (Rockfall Path) | Move Steel Paws, Astral Heron and Scuttle Crab to Battlefield 1 (Bandle Scouts' Academy) | 4.0% |
| 11 | mainAction | End turn | Move Astral Heron and Scuttle Crab to Battlefield 1 (Bandle Scouts' Academy) | 7.7% |
| 13 | optional | Choose (Exhaust Gloomist to draw 1?): Yes | (same) |  |
| 13 | chainResponse | Pass | (same) |  |
| 13 | mainAction | Play Kharox to base | (same) |  |
| 13 | mainAction | Play Tornado Warrior to base | (same) |  |
| 13 | mainAction | End turn | Move Astral Heron to Battlefield 1 (Bandle Scouts' Academy) | 13.3% |

## Talking it through

Paste this file (or one mistake section) into a chat with Claude and ask, for example: "Why is the bot's move better here?", "What was I missing about their hand?", or "Is there a pattern in my mistakes?".
