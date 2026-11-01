# Hollowbrook

A small top-down 2D farming game with light combat, built with **Phaser 3 + TypeScript + Vite**.

You've taken over Thistle Farm in the valley of Hollowbrook. Grow crops, sell them for gold, and
clear the slimes out of Mossy Woods.

## Run it

```bash
npm install
npm run dev        # open the printed URL (usually http://localhost:5173)
npm run build      # production build in dist/ (static files, works on GitHub Pages)
```

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrows | Move one tile at a time (hold to keep walking, tap to just turn) |
| Space (or J) | Use the selected item. When facing a person, sign or ripe crop, it interacts instead |
| E (or K) | Talk, read, harvest, open |
| 1-0, Q, mouse wheel | Pick a hotbar slot |
| Esc | Menu |

The game switches to fullscreen on your first tap, click or key press (browsers don't allow it
any sooner). Press Esc or the fullscreen button to leave it. On iPhone, where websites can't go
fullscreen, use Share → **Add to Home Screen** and open it from there.

**On a phone or tablet** (hold it sideways): drag anywhere on the left half to move, tap **USE** and
**TALK** on the right, tap a hotbar slot to pick it, and use the two buttons at the top for the menu
and fullscreen. Tap to advance dialogue. In the shop, tap an item twice to buy it.

## What's in it

- **Farming:** till grass with the hoe, plant seeds, water daily. Watered crops grow overnight.
  Strawberries (3 days), Onions (4), Potatoes (5), Leeks (6), Moonmelons (8).
- **Day cycle:** 6 AM to 2 AM (about 14 real minutes), with nightfall. Energy is spent by tools.
  Sleep in your bed to end the day and save. Staying up past 2 AM makes you pass out.
- **Combat:** slimes roam Mossy Woods. Swing the sword to defeat them and collect Slime Gel.
  Getting knocked out sends you home and costs 10% of your gold.
- **Economy:** sell crops, forage and gel in the shipping bin. Buy seeds, bread and Heart Charms
  (+1 max heart) at Bram's shop in town.
- **Places:** farm, house, Hollowbrook town (Mayor Orla, Pip), Bram's shop, Mossy Woods.
- **Saving:** automatic on sleep, stored in the browser's localStorage.

## The story: "The Moon Is in My Turnip"

At 10 PM on Day 1 the moon falls onto your farm. It's a talking turnip named Gerald, and it has to be
back in the sky by midnight on Day 4. Follow the goal panel under the clock (top right). The full
design, including every scene and both endings, is in [docs/STORY.md](docs/STORY.md).

Spoiler-free tips: talk to everyone, keep some Slime Gel, and water the soil right next to Gerald.

## Accounts and cloud saves (Neon)

Players can create an account and keep their farm in the cloud, so they can continue on any device.
The browser never talks to the database directly:

```
Game (GitHub Pages) --sign in--> Neon Auth (managed accounts)
        |                          | short-lived login token (JWT)
        +--Bearer token--> "saves" Neon Function --pg--> Postgres table `saves` (one row per player)
```

- `neon.ts`: declares Neon Auth (`auth: true`) and the `saves` Function.
- `functions/saves/`: the Function (Hono + `pg` + `jose`). It checks the token against Neon Auth's keys and
  only ever reads or writes the row for that token's user. `saves.test.mts` covers it end to end.
- `migrations/` + `npm run db:migrate`: the database schema, applied once each.
- `src/cloud.ts`, `src/accountPrompt.ts`: sign-in, sign-up and save upload/download in the game.
- Without `VITE_NEON_AUTH_URL` and `VITE_SAVES_URL` at build time, accounts are hidden and the game
  saves on the device only. Saves always go to the device first, so a failed upload loses nothing.

Deploying it (needs a Neon login or `NEON_API_KEY`):

```bash
neon deploy                 # creates Auth + the saves Function, writes .env.local
npm run db:migrate          # creates the saves table
neon functions get saves    # -> invocation_url
neon neon-auth domain add https://gonereng.github.io
```

Then put the two public URLs in `.env.production` (`VITE_NEON_AUTH_URL`, `VITE_SAVES_URL`) and push.

Testing locally without Neon: `tests/fake-neon-auth.mts` stands in for Neon Auth and
`tests/serve-function.mts` serves the real Function against a local Postgres.

## Code layout

```
src/
  main.ts            Phaser game config
  config.ts          Tile size, zoom, screen size
  tiles.ts           Tile ids and which ones are solid
  maps.ts            All maps, built in code (tiles, warps, NPCs, signs, spawns)
  items.ts           Items and crops
  state.ts           Game state, inventory, day advance, save/load
  textures.ts        All pixel art, drawn with canvas at startup
  slime.ts           Slime enemy
  critters.ts        Farm animals
  quest.ts           The story: steps, dialogue, puzzles, Gerald, the Turnipult, the finale
  boss.ts            Lord Gloopington III
  bus.ts             Events between the world and the UI
  scenes/
    BootScene.ts     Generates textures and animations
    TitleScene.ts    Title screen (Continue / New Game)
    WorldScene.ts    Player, farming, combat, NPCs, map transitions, clock
    UIScene.ts       HUD, hotbar, dialogue boxes, shop
```

## Art

- The farmer, crops, houses, furniture, maple trees, chest and farm animals are from
  [Tiny Farm RPG - Asset Pack](https://maevedevs.itch.io/farm-rpg) by **Maeve Devs** (free version),
  in `public/assets/tiny-farm/`. Its license allows use in games but not redistributing the files,
  so if you want to reuse them, please get the pack from the author's page.
- Everything else (tiles, NPCs, slimes, Gerald, UI, icons) is drawn in code in `src/textures.ts`.
- Sprite rectangles inside the pack sheets are listed in `src/scenes/BootScene.ts`.
