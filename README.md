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
| WASD / Arrows | Move |
| Space (or J) | Use the selected item. When facing a person, sign or ripe crop, it interacts instead |
| E (or K) | Talk, read, harvest, open |
| 1-0, Q, mouse wheel | Pick a hotbar slot |
| Esc | Menu |

**On a phone or tablet** (hold it sideways): drag anywhere on the left half to move, tap **USE** and
**TALK** on the right, tap a hotbar slot to pick it, and use the two buttons at the top for the menu
and fullscreen. Tap to advance dialogue. In the shop, tap an item twice to buy it.

## What's in it

- **Farming:** till grass with the hoe, plant seeds, water daily. Watered crops grow overnight.
  Carrots (3 days), Turnips (5 days), Moonmelons (8 days).
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
  quest.ts           The story: steps, dialogue, puzzles, Gerald, the Turnipult, the finale
  boss.ts            Lord Gloopington III
  bus.ts             Events between the world and the UI
  scenes/
    BootScene.ts     Generates textures and animations
    TitleScene.ts    Title screen (Continue / New Game)
    WorldScene.ts    Player, farming, combat, NPCs, map transitions, clock
    UIScene.ts       HUD, hotbar, dialogue boxes, shop
```

All art is generated in `textures.ts`, so there are no image files. To use real pixel art later,
load PNG spritesheets in `BootScene` under the same texture keys and frame names.
