# The Wayfarer's Rest

You are a disillusioned young archivist who has inherited **The Wayfarer's Rest**, your grandfather's sprawling,
dilapidated inn at the collapsing crossroads of the **Greenveil Realm**. A rift between the **Iron Crown Kingdom**
(north) and the **Verdant Freeholds** (south) turned the crossroads into a ghost town. You have a leaking roof,
a field choked with briars, and a mountain of debt.

**Your mission:** restore the inn, tame the land to feed your guests, and turn the hearth into neutral ground where
bitter factions learn to talk instead of fight.

The story's code is in `src/inn.ts`. The step numbers below are `state.inn.step`.

## Act I: Kindling the First Spark

| Step | What happens | What you do |
| --- | --- | --- |
| 0 | You arrive. **Barnaby**, a retired carpenter, sits on the porch. | Talk to him. You learn to brew Honey-Wine and Root Ale at the hearth. |
| 1 | He won't lift a hammer until someone pours him a decent pint. | Brew **Honey-Wine** (4 Wild Berries) and give it to him. He fixes the door and the roof. |
| 2 | The first guests arrive: **Pell**, a runaway scribe; **Maeve**, a grumpy herbalist; **Finn**, a bard with broken strings. | Pell wants a **Root Ale** (2 Potatoes), Maeve wants **3 Woodcaps**, Finn wants **2 Slime Gel** for new strings. |
| 3 | **Stew Night.** | Bring **3 hot dishes** to the hearth after 6 PM. **Corvin**, a northern merchant, brings word that the magistrate has blockaded the high roads. The inn becomes an information hub. |

## Act II: Smoke on the Horizon

| Step | What happens | What you do |
| --- | --- | --- |
| 4 | Travelers start stopping by. | Serve them what they order until your **reputation reaches 40**. |
| 5 | **Sir Raymond** (Iron Crown) and **Isla** (Freehold Guilds) arrive and clash. **Jorah**, a disgraced palace chef, takes over your kitchen. | Talk to Jorah: he teaches Berry Tart, Leek Pie and Moon Stew. Serve Raymond an **Omelette** and Isla a **Honey-Wine**. |
| 6 | The crisis: each wants the inn, as a military outpost or as a tax haven. | Taking a side drives the other away (until you talk again). The way forward is **"Neither. This hearth belongs to everyone."** |
| 7 | **The Summit Feast.** | After 6 PM, with **Hearth Warmth 60+**, bring **2 Omelettes, 2 Honey-Wines and 1 Moonmelon** to the hearth. A ceasefire. Then news: the Grand Chancellor is coming. |

## Act III: The Great Convergence

| Step | What happens | What you do |
| --- | --- | --- |
| 8 | **Grand Chancellor Vexmoor** marches down the pass to shut every independent inn. | Collect **8 signatures** from everyone you've helped (guests, Barnaby, and the townsfolk Bram, Pip, Orla, Hazel, Mortimer), and earn **1,500g** at the inn. |
| 9 | He arrives at your door the next morning. | Face him. The whole crossroads stands with you, armed with petitions, trade, and the ledger. He leaves; his regiment stays for lunch. |
| 10 | **The Grand Festival of the Hearth.** | Bring **5 different dishes** to the hearth after 6 PM. Raymond and Isla sign the **Crossroads Accord**. |
| 11 | Epilogue. | The most famous sanctuary in the realm. Keep farming, cooking and serving travelers. |

## Systems

- **Reputation** (0-100): rises with each story step and every guest served. As it grows, travelers get stranger and
  richer. Under 35: peddlers and pilgrims. From 35: monster-hunters and scholars. From 70: elven diplomats, dwarven
  master-smiths and goblin truffle-hunters, who order rarer dishes and pay more.
- **Hearth Warmth** (0-100): +10 for every guest served, +15 each night Finn plays (once his strings are fixed),
  -15 every night. A warm hearth lowers guards: at 50, Maeve asks for help with her failing eyesight (bring her a
  Moonmelon; she gives you +1 heart) and Barnaby tells you about his family. The Summit needs 60.
- **Inn Ledger** (the common-room table): reputation, warmth, earnings and tonight's orders. Travelers pay about twice
  what the shipping bin does, plus a bonus for the fancier ones.

## What's simplified

The design document describes more than this first pass builds:
- The regions are the existing maps, renamed: the Whispering Woods, plus the Deep Woods standing in for the Sunken
  Quarries.
- Raymond and Isla's relationship is told through their dialogue rather than a seating-arrangement mechanic.
- Barnaby's inn expansions happen in the story text, not as buildings.
- The festival is one evening scene.

Good next steps: real inn upgrades, live lute music, staff, and more traveler types with their own little quests.
