import Phaser from 'phaser';
import { T, TILE_COUNT } from './tiles';
import { mulberry32 } from './rng';
import { CROPS, ITEM_ORDER, type CropId, type ItemId } from './items';

/**
 * All art is drawn here with canvas calls, so the game needs no image files.
 * Swap any texture for a real PNG later by loading one under the same key/frame names.
 */

type Ctx = CanvasRenderingContext2D;
const S = 16;
/** Each tile sits in an 18x18 cell: the 16x16 tile plus a 1-pixel extruded border. */
export const TILE_CELL = S + 2;

function fill(c: Ctx, x: number, y: number, w: number, h: number, color: string) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}
const px = (c: Ctx, x: number, y: number, color: string) => fill(c, x, y, 1, 1, color);

function disc(c: Ctx, ox: number, oy: number, cx: number, cy: number, r: number, color: string, clip?: (x: number, y: number) => boolean) {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r && (!clip || clip(x, y))) px(c, ox + x, oy + y, color);
    }
}

function speckle(c: Ctx, ox: number, oy: number, colors: string[], n: number, r: () => number) {
  for (let i = 0; i < n; i++)
    px(c, ox + Math.floor(r() * S), oy + Math.floor(r() * S), colors[Math.floor(r() * colors.length)]);
}

function sprite(c: Ctx, ox: number, oy: number, rows: string[], pal: Record<string, string>) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (col) px(c, ox + x, oy + y, col);
    }
  });
}

// ---------------------------------------------------------------- tiles

function grass(c: Ctx, ox: number, r: () => number) {
  fill(c, ox, 0, S, S, '#79bf56');
  speckle(c, ox, 0, ['#6db24c', '#86c862', '#72b850'], 34, r);
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(r() * 15), y = Math.floor(r() * 14);
    px(c, ox + x, y, '#94d26c');
    px(c, ox + x, y + 1, '#3d993d');
  }
}

function darkGrass(c: Ctx, ox: number, r: () => number) {
  fill(c, ox, 0, S, S, '#4f9a44');
  speckle(c, ox, 0, ['#448a3c', '#5aa84e', '#3d993d'], 40, r);
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(r() * 15), y = Math.floor(r() * 14);
    px(c, ox + x, y, '#5a9a4e');
  }
}

function floor(c: Ctx, ox: number) {
  fill(c, ox, 0, S, S, '#c08a55');
  for (const x of [3, 7, 11, 15]) fill(c, ox + x, 0, 1, S, '#a5703f');
  for (const [x, y] of [[0, 5], [4, 11], [8, 3], [12, 9]]) fill(c, ox + x, y, 3, 1, '#a5703f');
}

function wall(c: Ctx, ox: number) {
  fill(c, ox, 0, S, S, '#a8763f');
  for (const y of [3, 7, 11, 15]) fill(c, ox, y, S, 1, '#7d5530');
  for (const [x, y] of [[4, 0], [11, 4], [4, 8], [11, 12]]) fill(c, ox + x, y, 1, 3, '#7d5530');
  for (const y of [0, 4, 8, 12]) fill(c, ox, y, S, 1, '#bd8a50');
}

function drawTile(c: Ctx, i: number, r: () => number) {
  const ox = i * S;
  switch (i) {
    case T.GRASS: grass(c, ox, r); break;
    case T.FLOWER: {
      grass(c, ox, r);
      const colors = [['#ffffff', '#f2d14a'], ['#f28ab8', '#ffffff'], ['#f2d14a', '#c0602a']];
      for (const [x, y] of [[3, 3], [11, 6], [5, 11]]) {
        const [petal, mid] = colors[Math.floor(r() * colors.length)];
        px(c, ox + x - 1, y, petal); px(c, ox + x + 1, y, petal);
        px(c, ox + x, y - 1, petal); px(c, ox + x, y + 1, petal);
        px(c, ox + x, y, mid);
      }
      break;
    }
    case T.PATH:
      fill(c, ox, 0, S, S, '#c8a46a');
      speckle(c, ox, 0, ['#b38f58', '#d6b47c', '#a8844f'], 30, r);
      break;
    case T.WATER:
      fill(c, ox, 0, S, S, '#3d7fd6');
      speckle(c, ox, 0, ['#3572c4'], 20, r);
      fill(c, ox + 2, 3, 4, 1, '#7fb4f2');
      fill(c, ox + 9, 8, 5, 1, '#7fb4f2');
      fill(c, ox + 4, 12, 3, 1, '#7fb4f2');
      break;
    case T.TREE:
    case T.DARK_TREE:
      (i === T.TREE ? grass : darkGrass)(c, ox, r);
      for (let y = 11; y < 16; y++) for (let x = 2; x < 14; x++) {
        const dx = (x + 0.5 - 8) / 6, dy = (y + 0.5 - 13.5) / 2.5;
        if (dx * dx + dy * dy <= 1) px(c, ox + x, y, i === T.TREE ? '#5a9a44' : '#3a7a34');
      }
      break;
    case T.WALL: wall(c, ox); break;
    case T.ROOF:
      fill(c, ox, 0, S, S, '#b5493a');
      for (const y of [3, 7, 11, 15]) fill(c, ox, y, S, 1, '#8a3328');
      for (const y of [0, 4, 8, 12]) for (let x = (y / 4) % 2 ? 0 : 2; x < S; x += 4) px(c, ox + x, y, '#d0624f');
      break;
    case T.DOOR:
    case T.DOOR_LOCKED:
      wall(c, ox);
      fill(c, ox + 3, 1, 10, 15, '#4e311b');
      fill(c, ox + 4, 2, 8, 14, i === T.DOOR ? '#7a4a24' : '#5e3a1c');
      fill(c, ox + 8, 2, 1, 14, '#5e3a1c');
      px(c, ox + 10, 9, '#e8c040');
      break;
    case T.FENCE:
      grass(c, ox, r);
      fill(c, ox, 6, S, 2, '#d8bf8a');
      fill(c, ox, 10, S, 2, '#d8bf8a');
      fill(c, ox, 8, S, 1, '#8f6a3a');
      fill(c, ox, 12, S, 1, '#8f6a3a');
      for (const x of [2, 11]) { fill(c, ox + x, 4, 3, 11, '#c8a46a'); fill(c, ox + x + 2, 4, 1, 11, '#8f6a3a'); }
      break;
    case T.SOIL:
      fill(c, ox, 0, S, S, '#94683e');
      for (const y of [2, 6, 10, 14]) fill(c, ox + 1, y, 14, 1, '#6e4a2a');
      speckle(c, ox, 0, ['#a87a4c'], 10, r);
      break;
    case T.SOIL_WET:
      fill(c, ox, 0, S, S, '#4f3420');
      for (const y of [2, 6, 10, 14]) fill(c, ox + 1, y, 14, 1, '#38251a');
      speckle(c, ox, 0, ['#5c3d26'], 10, r);
      break;
    case T.ROCK:
    case T.DARK_ROCK:
      (i === T.ROCK ? grass : darkGrass)(c, ox, r);
      disc(c, ox, 0, 8, 9, 6.4, '#4a4a52');
      disc(c, ox, 0, 8, 8.6, 5.4, '#8a8a92');
      disc(c, ox, 0, 6.5, 7, 2.6, '#a8a8b2');
      px(c, ox + 10, 11, '#6a6a72'); px(c, ox + 11, 10, '#6a6a72');
      break;
    case T.FLOOR: floor(c, ox); break;
    case T.BED:
      floor(c, ox);
      fill(c, ox + 1, 0, 14, 16, '#6b4426');
      fill(c, ox + 2, 1, 12, 5, '#efe8da');
      fill(c, ox + 2, 6, 12, 9, '#4a7fc0');
      fill(c, ox + 2, 6, 12, 1, '#6a9fe0');
      fill(c, ox + 2, 10, 12, 1, '#3a6aa8');
      break;
    case T.COUNTER:
      fill(c, ox, 0, S, S, '#8a5a32');
      fill(c, ox, 0, S, 5, '#b07a48');
      fill(c, ox, 5, S, 1, '#5e3d24');
      fill(c, ox + 7, 6, 1, 10, '#6b4426');
      break;
    case T.BUSH:
    case T.DARK_BUSH:
      (i === T.BUSH ? grass : darkGrass)(c, ox, r);
      disc(c, ox, 0, 8, 9, 6.8, '#1f4d22');
      disc(c, ox, 0, 8, 8.8, 5.9, '#3a8a3a');
      disc(c, ox, 0, 6, 7, 2.2, '#52a552');
      px(c, ox + 10, 10, '#c03a4a'); px(c, ox + 5, 11, '#c03a4a'); px(c, ox + 9, 6, '#c03a4a');
      break;
    case T.BRIDGE:
      fill(c, ox, 0, S, S, '#3d7fd6');
      fill(c, ox, 1, S, 14, '#a8763f');
      for (const x of [0, 4, 8, 12]) fill(c, ox + x, 1, 1, 14, '#7d5530');
      fill(c, ox, 0, S, 2, '#6b4426');
      fill(c, ox, 14, S, 2, '#6b4426');
      break;
    case T.BIN: // the chest sprite is drawn on top
    case T.BLOCK:
      grass(c, ox, r);
      break;
    case T.BLOCK_FLOOR:
      floor(c, ox);
      break;
    case T.SIGN:
      grass(c, ox, r);
      fill(c, ox + 7, 9, 2, 7, '#6b4426');
      fill(c, ox + 2, 2, 12, 8, '#7a5232');
      fill(c, ox + 3, 3, 10, 6, '#c8a46a');
      fill(c, ox + 4, 4, 8, 1, '#7a5232');
      fill(c, ox + 4, 6, 6, 1, '#7a5232');
      break;
    case T.IN_WALL:
      fill(c, ox, 0, S, S, '#e2d2b0');
      for (const x of [1, 5, 9, 13]) fill(c, ox + x, 0, 1, S, '#d4c29c');
      fill(c, ox, 13, S, 3, '#8a5a32');
      break;
    case T.VOID: fill(c, ox, 0, S, S, '#1a1410'); break;
    case T.WINDOW:
      wall(c, ox);
      fill(c, ox + 3, 3, 10, 9, '#4e311b');
      fill(c, ox + 4, 4, 8, 7, '#9fd3f0');
      fill(c, ox + 7, 4, 2, 7, '#4e311b');
      fill(c, ox + 4, 7, 8, 1, '#4e311b');
      px(c, ox + 5, 5, '#ffffff');
      break;
    case T.DARK_GRASS: darkGrass(c, ox, r); break;
    case T.RUG:
      floor(c, ox);
      fill(c, ox, 0, S, S, '#d8b04a');
      fill(c, ox + 1, 1, 14, 14, '#a83a3a');
      fill(c, ox + 4, 4, 8, 8, '#c25050');
      break;
    case T.SHELF:
      fill(c, ox, 0, S, S, '#6b4426');
      fill(c, ox + 1, 1, 14, 14, '#4e311b');
      fill(c, ox + 1, 7, 14, 1, '#8a5a32');
      fill(c, ox + 1, 14, 14, 1, '#8a5a32');
      for (const [x, y, col] of [[2, 3, '#e8862a'], [6, 4, '#6fc8b0'], [10, 3, '#9a4ab0'], [3, 10, '#e8c040'], [8, 11, '#6ad06a'], [12, 10, '#d04030']] as const) {
        fill(c, ox + x, y, 3, 7 - (y % 7), col);
      }
      break;
    case T.TABLE:
      floor(c, ox);
      fill(c, ox + 1, 3, 14, 9, '#6b4426');
      fill(c, ox + 1, 3, 14, 7, '#a8763f');
      fill(c, ox + 2, 12, 2, 3, '#4e311b');
      fill(c, ox + 12, 12, 2, 3, '#4e311b');
      fill(c, ox + 6, 4, 4, 3, '#efe8da');
      break;
    case T.CRATER:
      fill(c, ox, 0, S, S, '#5a3c22');
      speckle(c, ox, 0, ['#4a301a', '#6e4a2a', '#3a2614'], 40, r);
      speckle(c, ox, 0, ['#e8e2b8'], 4, r);
      break;
    case T.HOLE:
      darkGrass(c, ox, r);
      disc(c, ox, 0, 8, 8.5, 6.5, '#2a1a0e');
      disc(c, ox, 0, 8, 9, 5.2, '#0a0604');
      px(c, ox + 6, 12, '#6ad06a'); px(c, ox + 10, 11, '#6ad06a');
      break;
    case T.JELLY_FLOOR:
      fill(c, ox, 0, S, S, '#2e5a3a');
      speckle(c, ox, 0, ['#356a42', '#28503a', '#3e7a4c'], 30, r);
      disc(c, ox, 0, 4 + r() * 8, 4 + r() * 8, 1.6, '#4a9a5a');
      break;
    case T.ROOT_WALL:
      fill(c, ox, 0, S, S, '#4a3220');
      speckle(c, ox, 0, ['#3a2616', '#5a3e28'], 30, r);
      for (const [x0, y0, len] of [[1, 3, 9], [6, 9, 8], [2, 13, 6]]) {
        for (let i = 0; i < len; i++) px(c, ox + x0 + i, y0 + Math.round(Math.sin(i / 1.5)), '#8a6a3a');
      }
      break;
    case T.JELLY_DOOR:
      fill(c, ox, 0, S, S, '#4a3220');
      fill(c, ox + 1, 0, 14, S, '#3a9a4a');
      fill(c, ox + 2, 1, 12, 14, '#6ad06a');
      fill(c, ox + 4, 3, 2, 6, '#b8f0b8');
      fill(c, ox + 1, 15, 14, 1, '#2a7a3a');
      break;
    case T.PEDESTAL:
      fill(c, ox, 0, S, S, '#2e5a3a');
      fill(c, ox + 3, 5, 10, 11, '#8a8a92');
      fill(c, ox + 2, 4, 12, 2, '#b0b0b8');
      fill(c, ox + 3, 14, 10, 2, '#5a5a62');
      break;
    case T.LADDER:
      fill(c, ox, 0, S, S, '#2e5a3a');
      fill(c, ox + 3, 0, 2, S, '#8a5a32');
      fill(c, ox + 11, 0, 2, S, '#8a5a32');
      for (const y of [2, 7, 12]) fill(c, ox + 5, y, 6, 2, '#a8763f');
      break;
  }
}

/** Disc helper for textures bigger than one tile. */
function bigDisc(c: Ctx, w: number, h: number, cx: number, cy: number, rx: number, ry: number, color: string, clip?: (x: number, y: number) => boolean) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && (!clip || clip(x, y))) px(c, x, y, color);
    }
}

function makeStoryTextures(scene: Phaser.Scene) {
  // Gerald: the moon, currently a giant turnip. Two frames: normal and blinking.
  const g = scene.textures.createCanvas('gerald', 64, 32)!;
  const gc = g.getContext();
  for (const [ox, blink] of [[0, false], [32, true]] as const) {
    gc.save();
    gc.translate(ox, 0);
    for (const [x, h, col] of [[11, 10, '#3a8a3a'], [15, 12, '#5ab857'], [19, 9, '#4aa04a'], [13, 7, '#6cc45c']] as const) fill(gc, x, 10 - h + 2, 3, h, col);
    bigDisc(gc, 32, 32, 16, 20, 13.5, 11.5, '#2b1d14');
    bigDisc(gc, 32, 32, 16, 20, 12.5, 10.5, '#f6f0e0');
    bigDisc(gc, 32, 32, 16, 20, 12.5, 10.5, '#9a4ab0', (_x, y) => y < 15);
    bigDisc(gc, 32, 32, 16, 20, 12.5, 10.5, '#b06ac8', (_x, y) => y < 12);
    bigDisc(gc, 32, 32, 12, 24, 3, 2, '#fffaf0');
    fill(gc, 15, 31, 2, 1, '#d8c8d8');
    if (blink) {
      fill(gc, 9, 19, 4, 1, '#2b1d14');
      fill(gc, 19, 19, 4, 1, '#2b1d14');
    } else {
      fill(gc, 10, 17, 3, 4, '#2b1d14');
      fill(gc, 19, 17, 3, 4, '#2b1d14');
      px(gc, 10, 17, '#ffffff');
      px(gc, 19, 17, '#ffffff');
    }
    fill(gc, 15, 23, 2, 2, '#2b1d14');
    fill(gc, 7, 21, 2, 1, '#f0a0b8');
    fill(gc, 23, 21, 2, 1, '#f0a0b8');
    gc.restore();
  }
  g.add('0', 0, 0, 0, 32, 32);
  g.add('1', 0, 32, 0, 32, 32);
  g.refresh();

  const glow = scene.textures.createCanvas('glow', 64, 64)!;
  const glc = glow.getContext();
  const grad = glc.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,210,0.9)');
  grad.addColorStop(0.5, 'rgba(255,240,180,0.3)');
  grad.addColorStop(1, 'rgba(255,240,180,0)');
  glc.fillStyle = grad;
  glc.fillRect(0, 0, 64, 64);
  glow.refresh();

  // The Turnipult: a suspiciously large spoon on a jelly spring.
  const tp = scene.textures.createCanvas('turnipult', 48, 32)!;
  const tc = tp.getContext();
  fill(tc, 0, 29, 48, 3, '#4e311b');
  fill(tc, 0, 29, 48, 1, '#8a5a32');
  // Jelly spring on the right.
  for (let i = 0; i < 5; i++) bigDisc(tc, 48, 32, 41, 27 - i * 2.4, 5, 1.8, i % 2 ? '#3a9a4a' : '#6ad06a');
  // Spoon handle from the spring into the bowl.
  for (let i = 0; i < 10; i++) { fill(tc, 31 + i, 22 - Math.floor(i / 3), 1, 2, '#a8763f'); px(tc, 31 + i, 24 - Math.floor(i / 3), '#6b4426'); }
  // The bowl, which Gerald sits in.
  bigDisc(tc, 48, 32, 20, 25, 14, 5, '#6b4426');
  bigDisc(tc, 48, 32, 20, 24.5, 12.5, 3.6, '#a8763f');
  bigDisc(tc, 48, 32, 18, 23.5, 6, 1.2, '#c8945a');
  tp.refresh();

  // The moon in the night sky, before and after (it has a carrot in it now).
  const moon = scene.textures.createCanvas('moon', 64, 32)!;
  const mc = moon.getContext();
  for (const ox of [0, 32]) {
    mc.save();
    mc.translate(ox, 0);
    bigDisc(mc, 32, 32, 16, 16, 12, 12, '#f4f0d8');
    bigDisc(mc, 32, 32, 12, 12, 3, 3, '#dcd6b4');
    bigDisc(mc, 32, 32, 20, 20, 4, 3, '#dcd6b4');
    bigDisc(mc, 32, 32, 21, 10, 2, 2, '#dcd6b4');
    if (ox) {
      for (let i = 0; i < 9; i++) fill(mc, 22 + i, 12 - i, 3, 3, i < 7 ? '#e8862a' : '#b8601a');
      fill(mc, 30, 1, 1, 4, '#4aa04a'); fill(mc, 31, 2, 1, 3, '#5ab857'); fill(mc, 29, 2, 1, 2, '#5ab857');
    }
    mc.restore();
  }
  moon.add('plain', 0, 0, 0, 32, 32);
  moon.add('carrot', 0, 32, 0, 32, 32);
  moon.refresh();

  // The player wearing the Slime Suit: same frame names as a character.
  const suit = scene.textures.createCanvas('suit', S * 8, S)!;
  const sc = suit.getContext();
  const names = ['down_0', 'down_1', 'down_2', 'up_0', 'up_1', 'up_2', 'side_0', 'side_1'];
  names.forEach((name, i) => {
    const squash = name.endsWith('_1') || name.endsWith('_2');
    const rows = (squash ? SLIME_SQUASH : SLIME).map(row => (name.startsWith('up') ? row.replace(/(?<=g)k(?=g)/g, 'g') : row));
    sprite(sc, i * S, 0, rows, { k: '#1d4a20', g: '#6ad06a', d: '#3a9a42', w: '#e8ffe8' });
    const top = squash ? 6 : 5;
    fill(sc, i * S + 6, top - 2, 4, 2, '#7a4a24');
    fill(sc, i * S + 5, top - 1, 6, 1, '#7a4a24');
    px(sc, i * S + 7, top - 3, '#7a4a24');
    suit.add(name, 0, i * S, 0, S, S);
  });
  suit.refresh();

  // The Slime Librarian: tiny glasses, no eyes.
  const lib = scene.textures.createCanvas('librarian', S, S)!;
  const lc = lib.getContext();
  sprite(lc, 0, 0, SLIME.map(r => r.replace(/(?<=g)k(?=g)/g, 'g')), { k: '#1d4a20', g: '#8ae0a0', d: '#4aaa62', w: '#ffffff' });
  for (const x0 of [3, 9]) {
    fill(lc, x0, 8, 4, 1, '#2b1d14'); fill(lc, x0, 11, 4, 1, '#2b1d14');
    fill(lc, x0, 8, 1, 4, '#2b1d14'); fill(lc, x0 + 3, 8, 1, 4, '#2b1d14');
    fill(lc, x0 + 1, 9, 2, 2, '#d8f0ff');
  }
  fill(lc, 7, 9, 2, 1, '#2b1d14');
  lib.refresh();

  const puddle = scene.textures.createCanvas('puddle', 16, 8)!;
  const pc = puddle.getContext();
  bigDisc(pc, 16, 8, 8, 4, 6, 3, 'rgba(120,200,140,0.55)');
  bigDisc(pc, 16, 8, 6, 3, 2, 1, 'rgba(220,255,230,0.7)');
  puddle.refresh();

  // The Moonstring, glowing on its pedestal.
  const str = scene.textures.createCanvas('moonstring', S, S)!;
  const stc = str.getContext();
  bigDisc(stc, S, S, 8, 8, 6, 4, '#fff4a0');
  bigDisc(stc, S, S, 8, 8, 4, 2.4, '#c8b040');
  bigDisc(stc, S, S, 8, 8, 2.5, 1.2, '#fffbe0');
  for (let i = 0; i < 6; i++) px(stc, 13 + (i % 2), 9 + i, '#fff4a0');
  str.refresh();
}

// ---------------------------------------------------------------- characters

const BODY_DOWN = [
  '................',
  '.....kkkkkk.....',
  '....khhhhhhk....',
  '...khhhhhhhhk...',
  '...khhhhhhhhk...',
  '...khsssssshk...',
  '...ksessssesk...',
  '...kssssssssk...',
  '....kcccccck....',
  '...kcccccccck...',
  '...ksccccccsk...',
  '....kppppppk....',
];
const BODY_UP = [
  '................',
  '.....kkkkkk.....',
  '....khhhhhhk....',
  '...khhhhhhhhk...',
  '...khhhhhhhhk...',
  '...khhhhhhhhk...',
  '...khhhhhhhhk...',
  '...kkhhhhhhkk...',
  '....kcccccck....',
  '...kcccccccck...',
  '...ksccccccsk...',
  '....kppppppk....',
];
const LEGS_STAND = ['....kppkkppk....', '....kppkkppk....', '....kbbkkbbk....', '................'];
const LEGS_STEP1 = ['....kppkkppk....', '....kbbkkppk....', '........kbbk....', '................'];
const LEGS_STEP2 = ['....kppkkppk....', '....kppkkbbk....', '....kbbk........', '................'];
const BODY_SIDE = [
  '................',
  '......kkkkk.....',
  '.....khhhhhk....',
  '....khhhhhhhk...',
  '....khhhhhhhk...',
  '....khhhssssk...',
  '....khhsssesk...',
  '....khssssssk...',
  '.....kccccck....',
  '....kcccccck....',
  '....kccsccck....',
  '....kppppppk....',
];
const SIDE_STAND = ['.....kpppk......', '.....kpppk......', '.....kbbbk......', '................'];
const SIDE_STEP = ['....kpk.kpk.....', '...kbk...kbk....', '................', '................'];

export const CHARACTERS: Record<string, Record<string, string>> = {
  player: { h: '#7a4a24', c: '#3f7fbf', p: '#4a3b2a' },
  orla: { h: '#d8d8d8', c: '#8a3fa0', p: '#5a3a6a' },
  pip: { h: '#e8b040', c: '#e05a3a', p: '#3a5a8a' },
  bram: { h: '#3a2a1a', c: '#3f8a4a', p: '#6a5a3a' },
};

function makeCharacter(scene: Phaser.Scene, key: string, colors: Record<string, string>) {
  const pal = { k: '#2b1d14', s: '#f2c19b', e: '#2b1d14', b: '#2b1d14', ...colors };
  const frames: [string, string[]][] = [
    ['down_0', [...BODY_DOWN, ...LEGS_STAND]],
    ['down_1', [...BODY_DOWN, ...LEGS_STEP1]],
    ['down_2', [...BODY_DOWN, ...LEGS_STEP2]],
    ['up_0', [...BODY_UP, ...LEGS_STAND]],
    ['up_1', [...BODY_UP, ...LEGS_STEP1]],
    ['up_2', [...BODY_UP, ...LEGS_STEP2]],
    ['side_0', [...BODY_SIDE, ...SIDE_STAND]],
    ['side_1', [...BODY_SIDE, ...SIDE_STEP]],
  ];
  const tex = scene.textures.createCanvas(key, S * frames.length, S)!;
  const c = tex.getContext();
  frames.forEach(([name, rows], i) => {
    sprite(c, i * S, 0, rows, pal);
    tex.add(name, 0, i * S, 0, S, S);
  });
  tex.refresh();
}

const SLIME = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '......kkkk......',
  '....kkggggkk....',
  '...kgggggwggk...',
  '..kgggggggwggk..',
  '..kggkggggkggk..',
  '..kggkggggkggk..',
  '..kggggggggggk..',
  '..kdggggggggdk..',
  '...kddddddddk...',
  '....kkkkkkkk....',
  '................',
];
const SLIME_SQUASH = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......kkk......',
  '.....kkgggkk....',
  '...kkggggggwkk..',
  '..kggkggggkgggk.',
  '.kgggkggggkggggk',
  '.kgggggggggggggk',
  '.kdgggggggggggdk',
  '..kddddddddddk..',
  '...kkkkkkkkkkk..',
  '................',
];

// ---------------------------------------------------------------- items

/** Items drawn in code. Crops from the Tiny Farm pack are copied from its sheet instead. */
const ITEM_DRAW: Partial<Record<ItemId, (c: Ctx, ox: number) => void>> = {
  hoe(c, ox) {
    for (let i = 0; i < 9; i++) { px(c, ox + 3 + i, 13 - i, '#8a5a32'); px(c, ox + 4 + i, 13 - i, '#5e3a1c'); }
    fill(c, ox + 9, 2, 5, 2, '#a8b0bc');
    fill(c, ox + 12, 2, 2, 5, '#a8b0bc');
    fill(c, ox + 12, 6, 2, 1, '#5a6068');
    px(c, ox + 9, 2, '#e0e6ee');
  },
  can(c, ox) {
    fill(c, ox + 2, 6, 9, 8, '#3a5a7a');
    fill(c, ox + 3, 6, 7, 7, '#5a86b0');
    fill(c, ox + 3, 6, 7, 1, '#8ab6e0');
    for (let i = 0; i < 4; i++) { px(c, ox + 10 + i, 9 - i, '#5a86b0'); px(c, ox + 10 + i, 10 - i, '#3a5a7a'); }
    fill(c, ox + 13, 4, 2, 2, '#3a5a7a');
    fill(c, ox + 4, 3, 5, 1, '#3a5a7a');
    px(c, ox + 3, 4, '#3a5a7a'); px(c, ox + 9, 4, '#3a5a7a');
    px(c, ox + 3, 5, '#3a5a7a'); px(c, ox + 9, 5, '#3a5a7a');
  },
  sword(c, ox) {
    for (let i = 0; i < 9; i++) { px(c, ox + 5 + i, 10 - i, '#e0e6ee'); px(c, ox + 6 + i, 10 - i, '#a8b0bc'); }
    px(c, ox + 14, 1, '#e0e6ee');
    for (const [x, y] of [[2, 9], [3, 10], [4, 11], [6, 13], [7, 14]]) px(c, ox + x, y, '#d0a040');
    px(c, ox + 5, 12, '#d0a040');
    for (const [x, y] of [[4, 13], [3, 14]]) px(c, ox + x, y, '#6b4426');
    px(c, ox + 2, 15, '#d0a040');
  },
  seed_moonmelon: (c, ox) => seedPacket(c, ox, '#6fc8b0'),
  moonmelon(c, ox) {
    disc(c, ox, 0, 8, 9, 6.6, '#2f6a5a');
    disc(c, ox, 0, 8, 9, 5.8, '#8fdcc8');
    for (const x of [5, 8, 11]) disc(c, ox, 0, 8, 9, 5.8, '#5aa890', (xx) => xx === x);
    px(c, ox + 6, 5, '#ffffff'); px(c, ox + 6, 6, '#e8fff8');
    fill(c, ox + 8, 1, 1, 2, '#6b4426');
  },
  gel(c, ox) {
    disc(c, ox, 0, 8, 10, 5, '#2f8a3a');
    disc(c, ox, 0, 8, 10, 4.2, '#6ad06a');
    fill(c, ox + 7, 4, 2, 2, '#6ad06a'); px(c, ox + 8, 3, '#6ad06a');
    px(c, ox + 6, 8, '#d8fbd8'); px(c, ox + 6, 9, '#a8eaa8');
  },
  berry(c, ox) {
    for (const [x, y] of [[5.5, 9], [10.5, 9], [8, 12.5]]) {
      disc(c, ox, 0, x, y, 2.8, '#3a1a6a');
      disc(c, ox, 0, x, y, 2.1, '#7a4ac0');
      px(c, ox + Math.floor(x) - 1, Math.floor(y) - 1, '#c8a8f0');
    }
    fill(c, ox + 7, 3, 3, 2, '#4aa04a'); px(c, ox + 8, 5, '#4aa04a');
  },
  mushroom(c, ox) {
    fill(c, ox + 6, 8, 4, 7, '#efe2c8');
    fill(c, ox + 6, 14, 4, 1, '#c8b898');
    disc(c, ox, 0, 8, 8, 6.2, '#8a2a20', (_x, y) => y <= 8);
    disc(c, ox, 0, 8, 8, 5.4, '#d04030', (_x, y) => y <= 7);
    px(c, ox + 5, 5, '#ffffff'); px(c, ox + 9, 4, '#ffffff'); px(c, ox + 11, 6, '#ffffff');
  },
  suit(c, ox) {
    disc(c, ox, 0, 8, 10, 6, '#1d4a20');
    disc(c, ox, 0, 8, 10, 5.2, '#6ad06a');
    fill(c, ox + 6, 3, 4, 2, '#7a4a24');
    fill(c, ox + 5, 4, 6, 1, '#7a4a24');
    fill(c, ox + 5, 9, 1, 2, '#1d4a20'); fill(c, ox + 10, 9, 1, 2, '#1d4a20');
    px(c, ox + 6, 7, '#e8ffe8');
  },
  bread(c, ox) {
    disc(c, ox, 0, 8, 11, 6.6, '#8a5220', (_x, y) => y >= 5 && y <= 14);
    disc(c, ox, 0, 8, 11, 5.8, '#d89048', (_x, y) => y >= 6 && y <= 13);
    disc(c, ox, 0, 8, 10, 4, '#e8b060', (_x, y) => y >= 6 && y <= 9);
    for (const x of [5, 8, 11]) fill(c, ox + x, 7, 1, 2, '#a86a30');
  },
  milk(c, ox) {
    fill(c, ox + 6, 1, 4, 2, '#c84a3a');
    fill(c, ox + 6, 3, 4, 2, '#b8c4cc');
    fill(c, ox + 4, 5, 8, 10, '#8a98a4');
    fill(c, ox + 5, 5, 6, 9, '#f4f6f8');
    fill(c, ox + 5, 9, 6, 3, '#7fb4f2');
    px(c, ox + 6, 6, '#ffffff'); px(c, ox + 6, 7, '#ffffff');
  },
  sprinkler(c, ox) {
    fill(c, ox + 3, 11, 10, 4, '#5a6068');
    fill(c, ox + 4, 11, 8, 3, '#a8b0bc');
    fill(c, ox + 7, 5, 2, 6, '#8a98a4');
    fill(c, ox + 5, 4, 6, 2, '#5a86b0');
    px(c, ox + 6, 4, '#8ab6e0');
    for (const [x, y] of [[2, 3], [4, 1], [8, 1], [11, 1], [13, 3]]) px(c, ox + x, y, '#7fb4f2');
  },
};

function seedPacket(c: Ctx, ox: number, color: string) {
  fill(c, ox + 3, 1, 10, 14, '#8a7a5a');
  fill(c, ox + 4, 2, 8, 12, '#efe2c0');
  fill(c, ox + 4, 2, 8, 3, color);
  disc(c, ox, 0, 8, 9.5, 2.6, color);
  px(c, ox + 7, 8, '#ffffff');
  fill(c, ox + 5, 13, 6, 1, '#c8b898');
}

/** The egg from the Tiny Farm chick sheet (row 2). The golden one is recoloured. */
function drawEgg(scene: Phaser.Scene, c: Ctx, ox: number, golden: boolean) {
  const src = scene.textures.get('chick').getSourceImage() as HTMLImageElement;
  if (!golden) { c.drawImage(src, 0, 2 * S, S, S, ox, 0, S, S); return; }
  // Recolour on a scratch canvas so the gold doesn't spill onto neighbouring icons.
  const tmp = document.createElement('canvas');
  tmp.width = S; tmp.height = S;
  const t = tmp.getContext('2d')!;
  t.drawImage(src, 0, 2 * S, S, S, 0, 0, S, S);
  t.globalCompositeOperation = 'multiply';
  t.fillStyle = '#ffc830';
  t.fillRect(0, 0, S, S);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(src, 0, 2 * S, S, S, 0, 0, S, S);
  c.drawImage(tmp, ox, 0);
  px(c, ox + 6, 5, '#fffbe0');
}

// ---------------------------------------------------------------- crops

function drawCrop(c: Ctx, ox: number, id: CropId, stage: number, items: HTMLCanvasElement) {
  // Only Moonmelon is drawn in code now; the other crops come from the Tiny Farm sheet.
  const leaf = '#4aa04a', leafHi = '#6cc45c', stem = '#3a8a3a';
  if (stage === 0) {
    fill(c, ox + 4, 10, 8, 3, '#5e3d24');
    for (const [x, y] of [[5, 10], [8, 11], [10, 10]]) px(c, ox + x, y, '#e8d8a0');
    return;
  }
  if (stage === 1) {
    fill(c, ox + 8, 9, 1, 4, stem);
    for (const [x, y] of [[6, 8], [7, 9], [9, 8], [10, 7]]) px(c, ox + x, y, leafHi);
    return;
  }
  if (stage === 2) {
    fill(c, ox + 8, 6, 1, 7, stem);
    disc(c, ox, 0, 5.5, 9, 2.4, leaf);
    disc(c, ox, 0, 10.5, 8, 2.4, leaf);
    disc(c, ox, 0, 8, 5, 2.2, leafHi);
    if (id === 'moonmelon') fill(c, ox + 3, 12, 10, 1, stem);
    return;
  }
  // Ready: draw the produce, plus a little sparkle.
  if (id === 'moonmelon') {
    fill(c, ox + 1, 12, 14, 1, stem);
    disc(c, ox, 0, 3.5, 6, 2.4, leaf);
  }
  const idx = ITEM_ORDER.indexOf(CROPS[id].produce);
  c.drawImage(items, idx * S, 0, S, S, ox + 1, 2, 14, 14);
  px(c, ox + 13, 2, '#fff8c0'); px(c, ox + 12, 1, '#fff8c0'); px(c, ox + 14, 1, '#fff8c0'); px(c, ox + 13, 0, '#fff8c0');
}

// ---------------------------------------------------------------- UI

function heart(c: Ctx, ox: number, color: string, shine: boolean) {
  const shape = (cc: string, grow: number) => {
    disc(c, ox, 0, 5, 6, 3.6 + grow, cc);
    disc(c, ox, 0, 11, 6, 3.6 + grow, cc);
    for (let y = 6; y <= 14; y++) {
      const half = Math.max(0, 7.4 + grow - (y - 6));
      fill(c, ox + Math.round(8 - half), y, Math.round(half * 2), 1, cc);
    }
  };
  shape('#2b1d14', 1);
  shape(color, 0);
  if (shine) { px(c, ox + 4, 4, '#ffffff'); px(c, ox + 3, 5, '#ffd0d0'); }
}

// ---------------------------------------------------------------- entry point

export function generateTextures(scene: Phaser.Scene): void {
  const r = mulberry32(7);

  // Draw the tiles side by side on a scratch canvas, then copy each into an 18x18 cell with a 1-pixel border
  // that repeats its own edge pixels. Without that border, GPUs can sample a sliver of the neighbouring tile
  // at tile edges, which shows up as thin coloured lines across the map.
  const raw = document.createElement('canvas');
  raw.width = S * TILE_COUNT;
  raw.height = S;
  const rc = raw.getContext('2d')!;
  for (let i = 0; i < TILE_COUNT; i++) drawTile(rc, i, r);
  const tiles = scene.textures.createCanvas('tiles', TILE_CELL * TILE_COUNT, TILE_CELL)!;
  const tc = tiles.getContext();
  for (let i = 0; i < TILE_COUNT; i++) {
    const sx = i * S, ox = i * TILE_CELL;
    const copy = (x: number, y: number, w: number, h: number, dx: number, dy: number) => tc.drawImage(raw, sx + x, y, w, h, ox + dx, dy, w, h);
    copy(0, 0, S, S, 1, 1);
    copy(0, 0, 1, S, 0, 1); copy(S - 1, 0, 1, S, S + 1, 1);       // left and right edges
    copy(0, 0, S, 1, 1, 0); copy(0, S - 1, S, 1, 1, S + 1);       // top and bottom edges
    copy(0, 0, 1, 1, 0, 0); copy(S - 1, 0, 1, 1, S + 1, 0);       // corners
    copy(0, S - 1, 1, 1, 0, S + 1); copy(S - 1, S - 1, 1, 1, S + 1, S + 1);
    tiles.add(`t${i}`, 0, ox + 1, 1, S, S);
  }
  tiles.refresh();

  for (const [key, colors] of Object.entries(CHARACTERS)) makeCharacter(scene, key, colors);

  const slime = scene.textures.createCanvas('slime', S * 2, S)!;
  const sc = slime.getContext();
  const spal = { k: '#1d4a20', g: '#6ad06a', d: '#3a9a42', w: '#e8ffe8' };
  sprite(sc, 0, 0, SLIME, spal);
  sprite(sc, S, 0, SLIME_SQUASH, spal);
  slime.add('0', 0, 0, 0, S, S);
  slime.add('1', 0, S, 0, S, S);
  slime.refresh();

  // Lord Gloopington III and his pieces: a bright purple slime that stays visible at night.
  const gloop = scene.textures.createCanvas('gloop', S * 2, S)!;
  const glc = gloop.getContext();
  const gpal = { k: '#3a1a5a', g: '#c88af8', d: '#9a5ad8', w: '#ffe8ff' };
  sprite(glc, 0, 0, SLIME, gpal);
  sprite(glc, S, 0, SLIME_SQUASH, gpal);
  gloop.add('0', 0, 0, 0, S, S);
  gloop.add('1', 0, S, 0, S, S);
  gloop.refresh();

  // Crop sheet from the Tiny Farm pack: per row, growth frames in columns 0..n, seed bag in 7, produce in 8.
  const sheet = scene.textures.get('tf_crops').getSourceImage() as HTMLImageElement;
  const fromSheet = (c: Ctx, ox: number, col: number, row: number) => c.drawImage(sheet, col * S, row * S, S, S, ox, 0, S, S);

  // Rain: thin slanted streaks on a transparent tile, scrolled across the screen by the UI.
  const rain = scene.textures.createCanvas('rain', 128, 128)!;
  const rainCtx = rain.getContext();
  const rr = mulberry32(4242);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rr() * 128), y = Math.floor(rr() * 128), len = 6 + Math.floor(rr() * 6);
    for (let j = 0; j < len; j++) {
      rainCtx.fillStyle = `rgba(180, 210, 255, ${0.25 + 0.4 * (j / len)})`;
      rainCtx.fillRect((x - Math.floor(j / 3) + 128) % 128, (y + j) % 128, 1, 1);
    }
  }
  rain.refresh();

  const items = scene.textures.createCanvas('items', S * ITEM_ORDER.length, S)!;
  const ic = items.getContext();
  ITEM_ORDER.forEach((id, i) => {
    const crop = Object.values(CROPS).find(c => c.sheetRow !== undefined && (c.produce === id || c.seed === id));
    if (crop) fromSheet(ic, i * S, crop.seed === id ? 7 : 8, crop.sheetRow!);
    else if (id === 'egg' || id === 'golden_egg') drawEgg(scene, ic, i * S, id === 'golden_egg');
    else ITEM_DRAW[id]?.(ic, i * S);
    items.add(id, 0, i * S, 0, S, S);
  });
  items.refresh();

  const cropIds = Object.keys(CROPS) as CropId[];
  const frameCount = cropIds.reduce((n, id) => n + CROPS[id].frames, 0);
  const crops = scene.textures.createCanvas('crops', S * frameCount, S)!;
  const cc = crops.getContext();
  let slot = 0;
  for (const id of cropIds) {
    const def = CROPS[id];
    for (let f = 0; f < def.frames; f++, slot++) {
      const ox = slot * S;
      if (def.sheetRow !== undefined) fromSheet(cc, ox, f, def.sheetRow);
      else drawCrop(cc, ox, id, f, items.getSourceImage() as HTMLCanvasElement);
      crops.add(`${id}_${f}`, 0, ox, 0, S, S);
    }
  }
  crops.refresh();

  const uiTex = scene.textures.createCanvas('ui', S * 3, S)!;
  const uc = uiTex.getContext();
  heart(uc, 0, '#e03a4a', true);
  heart(uc, S, '#4a3434', false);
  disc(uc, S * 2, 0, 8, 8, 6.4, '#8a6a10');
  disc(uc, S * 2, 0, 8, 8, 5.4, '#e8c040');
  fill(uc, S * 2 + 7, 5, 2, 6, '#b8901a');
  px(uc, S * 2 + 5, 5, '#fff4b0');
  uiTex.add('heart', 0, 0, 0, S, S);
  uiTex.add('heart_empty', 0, S, 0, S, S);
  uiTex.add('coin', 0, S * 2, 0, S, S);
  uiTex.refresh();

  // Sword slash arc, drawn facing right.
  const slash = scene.textures.createCanvas('slash', 24, 24)!;
  const lc = slash.getContext();
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      const dx = x + 0.5 - 4, dy = y + 0.5 - 12;
      const d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      if (Math.abs(a) < 1.1 && d > 11 && d < 17) {
        lc.fillStyle = d > 15 ? 'rgba(255,255,255,0.95)' : 'rgba(220,240,255,0.55)';
        lc.fillRect(x, y, 1, 1);
      }
    }
  slash.refresh();

  makeStoryTextures(scene);

  const spark = scene.textures.createCanvas('spark', 2, 2)!;
  fill(spark.getContext(), 0, 0, 2, 2, '#ffffff');
  spark.refresh();

  const shadow = scene.textures.createCanvas('shadow', 12, 4)!;
  const shc = shadow.getContext();
  shc.fillStyle = 'rgba(0,0,0,0.28)';
  shc.fillRect(2, 0, 8, 4);
  shc.fillRect(0, 1, 12, 2);
  shadow.refresh();
}

export function createAnimations(scene: Phaser.Scene): void {
  for (const key of [...Object.keys(CHARACTERS), 'suit']) {
    for (const dir of ['down', 'up']) {
      scene.anims.create({
        key: `${key}_${dir}`,
        frames: [1, 0, 2, 0].map(i => ({ key, frame: `${dir}_${i}` })),
        frameRate: 8,
        repeat: -1,
      });
    }
    scene.anims.create({
      key: `${key}_side`,
      frames: [1, 0].map(i => ({ key, frame: `side_${i}` })),
      frameRate: 7,
      repeat: -1,
    });
  }
  scene.anims.create({
    key: 'gerald_idle',
    frames: [{ key: 'gerald', frame: '0', duration: 2600 }, { key: 'gerald', frame: '1', duration: 140 }],
    repeat: -1,
  });
  scene.anims.create({
    key: 'gloop_idle',
    frames: [{ key: 'gloop', frame: '0' }, { key: 'gloop', frame: '1' }],
    frameRate: 3,
    repeat: -1,
  });
  scene.anims.create({
    key: 'slime_idle',
    frames: [{ key: 'slime', frame: '0' }, { key: 'slime', frame: '1' }],
    frameRate: 3,
    repeat: -1,
  });
}
