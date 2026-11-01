import { T, SOLID } from './tiles';
import { mulberry32 } from './rng';
import { state } from './state';

const flag = (f: string) => !!state.quest.flags[f];

export type MapId = 'farm' | 'house' | 'town' | 'shop' | 'forest' | 'burrow';
export type Facing = 'down' | 'up' | 'left' | 'right';

export interface Point { x: number; y: number }

export interface Warp {
  x: number; y: number; w: number; h: number;
  to: MapId; tx: number; ty: number; facing: Facing;
  /** Quest flag that must be set for this warp to work. */
  requires?: string;
}

export interface NpcDef {
  id: string;
  name: string;
  sprite: string;
  x: number; y: number;
  facing: Facing;
  /** Said the first time you talk to them. */
  intro: string[];
  /** Rotating conversations. {slimes} and {day} are filled in. */
  chat: string[][];
  /** Drawn as a slime with this tint instead of a person. */
  slime?: number;
  /** Only present while this returns true. */
  show?: () => boolean;
}

/** A sprite placed in the world, drawn with its bottom-centre at (x, y) unless origin says otherwise. */
export interface Prop {
  tex: string;
  frame?: string;
  x: number;
  y: number;
  origin?: [number, number];
  /** Defaults to y, so things sort by their base. */
  depth?: number;
}

export type CritterKind = 'chicken_red' | 'chicken_blonde' | 'chick' | 'cow' | 'cow_male';
export interface Critter { kind: CritterKind; x: number; y: number }

export type InteractKind = 'bed' | 'bin' | 'shop' | 'sign' | 'locked';

export interface Interactable extends Point {
  kind: InteractKind;
  lines?: string[];
}

export interface MapDef {
  id: MapId;
  name: string;
  w: number;
  h: number;
  tiles: number[][];
  indoor: boolean;
  farmable: boolean;
  spawn: Point;
  warps: Warp[];
  npcs: NpcDef[];
  interact: Interactable[];
  slimes: number;
  forage: Point[];
  /** Walkable tiles reachable from the spawn point. */
  open: Point[];
  props: Prop[];
  critters: Critter[];
}

/** Where you wake up each morning. */
export const BED_SPAWN: Point = { x: 12, y: 6 };

const solid = new Set(SOLID);

class Builder {
  t: number[][];
  constructor(public w: number, public h: number, fill: number) {
    this.t = Array.from({ length: h }, () => Array<number>(w).fill(fill));
  }
  in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x: number, y: number) { return this.in(x, y) ? this.t[y][x] : -1; }
  set(x: number, y: number, v: number) { if (this.in(x, y)) this.t[y][x] = v; }
  rect(x: number, y: number, w: number, h: number, v: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v);
  }
  border(v: number, thick: number) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (x < thick || y < thick || x >= this.w - thick || y >= this.h - thick) this.set(x, y, v);
  }
  scatter(v: number, n: number, rnd: () => number, ok: (x: number, y: number) => boolean) {
    for (let tries = 0; n > 0 && tries < 20000; tries++) {
      const x = Math.floor(rnd() * this.w), y = Math.floor(rnd() * this.h);
      if (ok(x, y)) { this.set(x, y, v); n--; }
    }
  }
  /** A small house: 2 rows of roof over 2 rows of wall with a door in the bottom row. */
  building(x: number, y: number, w: number, doorX: number, windows: number[], door: number = T.DOOR) {
    this.rect(x, y, w, 2, T.ROOF);
    this.rect(x, y + 2, w, 2, T.WALL);
    for (const wx of windows) this.set(x + wx, y + 2, T.WINDOW);
    this.set(x + doorX, y + 3, door);
  }
  /** An interior room in a 20x14 map with the door at (9,10). */
  room() {
    this.rect(5, 2, 10, 2, T.IN_WALL);
    this.rect(5, 4, 1, 7, T.IN_WALL);
    this.rect(14, 4, 1, 7, T.IN_WALL);
    this.rect(5, 10, 10, 1, T.IN_WALL);
    this.rect(6, 4, 8, 6, T.FLOOR);
    this.set(9, 10, T.DOOR);
  }
  near(x: number, y: number, r: number, tiles: number[]) {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) if (tiles.includes(this.get(x + i, y + j))) return true;
    return false;
  }
  reachable(from: Point): Point[] {
    const seen = new Set<string>();
    const out: Point[] = [];
    const queue: Point[] = [from];
    seen.add(`${from.x},${from.y}`);
    while (queue.length) {
      const p = queue.shift()!;
      out.push(p);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = p.x + dx, y = p.y + dy, k = `${x},${y}`;
        if (!this.in(x, y) || seen.has(k) || solid.has(this.t[y][x])) continue;
        seen.add(k);
        queue.push({ x, y });
      }
    }
    return out;
  }
}

type MapInput = Omit<MapDef, 'tiles' | 'w' | 'h' | 'open' | 'props' | 'critters'> & { props?: Prop[]; critters?: Critter[] };

function finish(b: Builder, def: MapInput): MapDef {
  return { props: [], critters: [], ...def, tiles: b.t, w: b.w, h: b.h, open: b.reachable(def.spawn) };
}

/**
 * A house from the Tiny Farm pack. Its 5x5-tile footprint becomes solid, except the door.
 * 'home' has a front door in column 3; 'shop' has a wide barn door centred on column 2.
 */
function house(b: Builder, props: Prop[], kind: 'home' | 'shop', x0: number, yBottom: number, door: 'open' | 'locked') {
  b.rect(x0, yBottom - 4, 5, 5, T.BLOCK);
  const doorX = x0 + (kind === 'home' ? 3 : 2);
  b.set(doorX, yBottom, door === 'open' ? T.GRASS : T.BLOCK);
  props.push({ tex: 'tf_house', frame: kind, x: x0 * TILE_PX, y: (yBottom + 1) * TILE_PX, origin: [0, 1] });
  return { x: doorX, y: yBottom };
}

const TILE_PX = 16;
/** A prop standing on tile (x, y): bottom-centre of the tile. */
const on = (tex: string, frame: string, x: number, y: number, dx = 0, dy = 0): Prop =>
  ({ tex, frame, x: x * TILE_PX + 8 + dx, y: (y + 1) * TILE_PX + dy });

function buildFarm(): MapDef {
  const rnd = mulberry32(11);
  const b = new Builder(40, 30, T.GRASS);
  b.border(T.TREE, 2);
  const props: Prop[] = [];
  house(b, props, 'home', 3, 5, 'open'); // farmhouse, door at (6,5)
  b.rect(6, 6, 1, 9, T.PATH);
  b.rect(6, 14, 34, 2, T.PATH); // road east to town
  b.rect(19, 16, 2, 14, T.PATH); // road south to the woods
  b.set(8, 6, T.BIN);
  props.push(on('tf_chest', 'closed', 8, 6, 0, -2));
  b.set(35, 13, T.SIGN);
  b.rect(29, 4, 5, 3, T.WATER);
  b.rect(30, 7, 3, 1, T.WATER);
  const field = (x: number, y: number) => x >= 8 && x <= 37 && y >= 16 && y <= 27;
  const free = (x: number, y: number) =>
    b.get(x, y) === T.GRASS && !field(x, y) && !(x <= 11 && y <= 8) &&
    !b.near(x, y, 1, [T.PATH, T.WATER, T.BIN, T.SIGN, T.ROCK, T.BUSH, T.BLOCK]);
  b.scatter(T.ROCK, 6, rnd, free);
  b.scatter(T.BUSH, 8, rnd, free);
  b.scatter(T.FLOWER, 45, rnd, (x, y) => b.get(x, y) === T.GRASS);
  return finish(b, {
    id: 'farm', name: 'Thistle Farm', indoor: false, farmable: true,
    props,
    critters: [
      { kind: 'chicken_red', x: 11, y: 8 }, { kind: 'chicken_blonde', x: 13, y: 9 },
      { kind: 'chick', x: 12, y: 10 }, { kind: 'cow', x: 32, y: 10 },
    ],
    spawn: { x: 6, y: 7 },
    warps: [
      { x: 6, y: 5, w: 1, h: 1, to: 'house', tx: 9, ty: 9, facing: 'up' },
      { x: 39, y: 14, w: 1, h: 2, to: 'town', tx: 2, ty: 14, facing: 'right' },
      { x: 19, y: 29, w: 2, h: 1, to: 'forest', tx: 19, ty: 2, facing: 'down' },
    ],
    npcs: [],
    interact: [
      { x: 8, y: 6, kind: 'bin' },
      { x: 35, y: 13, kind: 'sign', lines: ['East: Hollowbrook Town.', 'South: Mossy Woods. Mind the slimes.'] },
    ],
    slimes: 0,
    forage: [],
  });
}

function buildHouse(): MapDef {
  const b = new Builder(20, 14, T.VOID);
  b.room();
  const F = 'tf_interior';
  for (const [x, y] of [[12, 4], [12, 5], [7, 4], [8, 4], [13, 4], [7, 7], [8, 7], [13, 9], [6, 9]]) b.set(x, y, T.BLOCK_FLOOR);
  const props: Prop[] = [
    { tex: F, frame: 'rug', x: 10.5 * TILE_PX, y: 10 * TILE_PX - 2, depth: 1 },
    { tex: F, frame: 'window', x: 10 * TILE_PX + 8, y: 3 * TILE_PX + 14, depth: 1 },
    { tex: F, frame: 'picture', x: 11 * TILE_PX + 12, y: 3 * TILE_PX + 12, depth: 1 },
    { tex: F, frame: 'clock', x: 5.5 * TILE_PX + 8, y: 3 * TILE_PX + 12, depth: 1 },
    { tex: F, frame: 'fireplace', x: 8 * TILE_PX, y: 5 * TILE_PX },
    on(F, 'bed', 12, 5),
    on(F, 'drawer', 13, 4),
    { tex: F, frame: 'table', x: 8 * TILE_PX, y: 8 * TILE_PX + 2 },
    on(F, 'plant_tree', 13, 9),
    on(F, 'plant_red', 6, 9),
  ];
  return finish(b, {
    id: 'house', name: 'Your House', indoor: true, farmable: false,
    props,
    spawn: { x: 9, y: 9 },
    warps: [{ x: 9, y: 10, w: 1, h: 1, to: 'farm', tx: 6, ty: 6, facing: 'down' }],
    npcs: [],
    interact: [{ x: 12, y: 4, kind: 'bed' }, { x: 12, y: 5, kind: 'bed' }],
    slimes: 0,
    forage: [],
  });
}

function buildTown(): MapDef {
  const rnd = mulberry32(23);
  const b = new Builder(40, 30, T.GRASS);
  b.border(T.TREE, 2);
  b.rect(0, 14, 34, 2, T.PATH);
  b.rect(14, 9, 12, 10, T.PATH); // plaza
  b.rect(19, 12, 2, 2, T.WATER); // fountain
  const props: Prop[] = [];
  house(b, props, 'shop', 18, 6, 'open'); // Bram's shop, door at (20,6)
  b.rect(20, 7, 1, 2, T.PATH);
  house(b, props, 'home', 3, 9, 'locked'); // door (6,9)
  b.rect(6, 10, 1, 4, T.PATH);
  house(b, props, 'home', 29, 9, 'locked'); // door (32,9)
  b.rect(32, 10, 1, 4, T.PATH);
  b.rect(4, 19, 7, 1, T.FENCE);
  b.rect(4, 23, 7, 1, T.FENCE);
  b.rect(4, 20, 1, 3, T.FENCE);
  b.rect(10, 20, 1, 3, T.FENCE);
  b.rect(5, 20, 5, 3, T.FLOWER); // little garden
  b.set(22, 7, T.SIGN);
  b.set(3, 13, T.SIGN);
  const free = (x: number, y: number) =>
    b.get(x, y) === T.GRASS && !b.near(x, y, 1, [T.PATH, T.WALL, T.WINDOW, T.FENCE, T.SIGN, T.TREE, T.DOOR_LOCKED, T.BLOCK]);
  b.scatter(T.TREE, 10, rnd, free);
  b.scatter(T.BUSH, 6, rnd, free);
  b.scatter(T.FLOWER, 50, rnd, (x, y) => b.get(x, y) === T.GRASS);
  return finish(b, {
    id: 'town', name: 'Hollowbrook', indoor: false, farmable: false,
    props,
    critters: [
      // A few chickens scratching around the garden, and two cows grazing on the east lawn.
      { kind: 'chicken_red', x: 12, y: 21 }, { kind: 'chicken_blonde', x: 13, y: 24 },
      { kind: 'chicken_red', x: 8, y: 25 }, { kind: 'chick', x: 12, y: 23 }, { kind: 'chick', x: 14, y: 22 },
      { kind: 'cow', x: 31, y: 21 }, { kind: 'cow_male', x: 34, y: 24 },
    ],
    spawn: { x: 2, y: 14 },
    warps: [
      { x: 0, y: 14, w: 1, h: 2, to: 'farm', tx: 37, ty: 14, facing: 'left' },
      { x: 20, y: 6, w: 1, h: 1, to: 'shop', tx: 9, ty: 9, facing: 'up' },
    ],
    npcs: [
      {
        id: 'orla', name: 'Mayor Orla', sprite: 'orla', x: 17, y: 16, facing: 'down',
        show: () => !flag('unmasked') || (flag('launched') && flag('pardoned')),
        intro: [
          'Oh! You must be the new keeper of Thistle Farm.',
          "I'm Orla, mayor of Hollowbrook. Welcome to the valley!",
          'Fair warning: slimes keep creeping out of Mossy Woods, just south of your farm.',
          'If you thin them out, the whole town will thank you.',
        ],
        chat: [
          ['Slimes defeated so far: {slimes}. Keep it up!'],
          ["Bram's shop sells seeds. Till the soil, plant, and water every single day."],
          ["Crops only grow on nights after they've been watered. Even moonmelons!"],
          ['Anything you grow, toss it in the shipping bin by your house. Gold, just like that.'],
        ],
      },
      {
        id: 'pip', name: 'Pip', sprite: 'pip', x: 8, y: 24, facing: 'up',
        intro: [
          'Hi! Are you a farmer? Do you have any slime gel?',
          'Slimes go SQUISH if you bonk them with a sword. Squish!',
        ],
        chat: [
          ['I found a mushroom in the woods once. It was THIS big.'],
          ["Mom says don't go into the woods after dark. I go anyway. Don't tell."],
          ['Do you think slimes have feelings? ...Nah.'],
          ['Day {day} already? Time goes fast when you are a kid.'],
        ],
      },
      ...([['ollie', 'Ollie', 16, 0xf0a0c0], ['rudy', 'Rudy', 17, 0xa0c8f0], ['lars', 'Lars', 18, 0xf0d890]] as const).map(
        ([id, name, x, tint]): NpcDef => ({
          id, name, sprite: 'slime', x, y: 16, facing: 'down', slime: tint, intro: [], chat: [],
          show: () => flag('pardoned') && !flag('launched'),
        }),
      ),
    ],
    interact: [
      { x: 22, y: 7, kind: 'sign', lines: ["Bram's Seeds & Supplies", 'Open every day, rain or slime.'] },
      { x: 3, y: 13, kind: 'sign', lines: ['Welcome to Hollowbrook!', 'Population: 23 and a few slimes.'] },
      { x: 6, y: 9, kind: 'locked' },
      { x: 32, y: 9, kind: 'locked' },
    ],
    slimes: 0,
    forage: [],
  });
}

function buildShop(): MapDef {
  const b = new Builder(20, 14, T.VOID);
  b.room();
  b.rect(6, 4, 8, 1, T.SHELF);
  b.rect(6, 6, 8, 1, T.COUNTER);
  const counter = Array.from({ length: 8 }, (_, i) => ({ x: 6 + i, y: 6, kind: 'shop' as const }));
  return finish(b, {
    id: 'shop', name: "Bram's Seeds & Supplies", indoor: true, farmable: false,
    spawn: { x: 9, y: 9 },
    warps: [{ x: 9, y: 10, w: 1, h: 1, to: 'town', tx: 20, ty: 7, facing: 'down' }],
    npcs: [
      {
        id: 'bram', name: 'Bram', sprite: 'bram', x: 9, y: 5, facing: 'down',
        intro: ['Welcome!'], chat: [['Welcome!']],
      },
    ],
    interact: counter,
    slimes: 0,
    forage: [],
  });
}

function buildForest(): MapDef {
  const rnd = mulberry32(47);
  const b = new Builder(40, 30, T.DARK_GRASS);
  b.border(T.TREE, 2);
  b.rect(19, 0, 2, 2, T.DARK_GRASS);
  b.rect(27, 2, 2, 26, T.WATER); // stream
  b.rect(27, 14, 2, 2, T.BRIDGE);
  b.rect(8, 20, 5, 4, T.WATER);
  const corridor = (x: number, y: number) => (x >= 17 && x <= 22 && y <= 16) || (y >= 13 && y <= 16);
  const free = (x: number, y: number) => b.get(x, y) === T.DARK_GRASS && !corridor(x, y);
  b.scatter(T.TREE, 70, rnd, free);
  b.scatter(T.BUSH, 25, rnd, free);
  b.scatter(T.ROCK, 8, rnd, free);
  b.set(22, 3, T.SIGN);
  // A suspicious circle of bushes past the bridge. The centre becomes a hole later.
  b.rect(30, 16, 7, 9, T.DARK_GRASS);
  for (let y = 19; y <= 21; y++) for (let x = 32; x <= 34; x++) b.set(x, y, T.BUSH);
  const spawn = { x: 19, y: 2 };
  const open = b.reachable(spawn);
  const forage: Point[] = [];
  const spots = open.filter(p => !corridor(p.x, p.y) && b.near(p.x, p.y, 1, [T.TREE, T.BUSH]));
  for (let i = 0; i < 9 && spots.length; i++) {
    forage.push(spots.splice(Math.floor(rnd() * spots.length), 1)[0]);
  }
  // Use the dark-floor versions of trees, bushes and rocks in the woods.
  const dark: Record<number, number> = { [T.TREE]: T.DARK_TREE, [T.BUSH]: T.DARK_BUSH, [T.ROCK]: T.DARK_ROCK };
  b.t = b.t.map(row => row.map(t => dark[t] ?? t));
  return finish(b, {
    id: 'forest', name: 'Mossy Woods', indoor: false, farmable: false,
    spawn,
    warps: [
      { x: 19, y: 0, w: 2, h: 1, to: 'farm', tx: 19, ty: 27, facing: 'up' },
      { x: 33, y: 20, w: 1, h: 1, to: 'burrow', tx: 9, ty: 11, facing: 'up', requires: 'bush' },
    ],
    npcs: [],
    interact: [{ x: 22, y: 3, kind: 'sign', lines: ['Mossy Woods.', 'Berries and mushrooms grow back every morning. So do the slimes.'] }],
    slimes: 7,
    forage,
  });
}

/** Positions used by the story code. */
export const BURROW = { door: { x: 9, y: 7 }, librarian: { x: 9, y: 4 }, librarianMoved: { x: 10, y: 3 }, pedestal: { x: 9, y: 2 } };

function buildBurrow(): MapDef {
  const b = new Builder(20, 14, T.VOID);
  b.rect(3, 1, 14, 12, T.ROOT_WALL);
  b.rect(4, 2, 12, 10, T.JELLY_FLOOR);
  b.rect(4, 7, 12, 1, T.ROOT_WALL); // divider
  b.set(9, 7, T.JELLY_DOOR);
  b.rect(4, 2, 12, 1, T.SHELF); // archive shelves
  b.set(9, 2, T.PEDESTAL);
  b.rect(4, 4, 5, 1, T.SHELF);
  b.rect(10, 4, 6, 1, T.SHELF);
  b.set(9, 12, T.LADDER);
  const slime = (id: string, x: number, y: number, tint: number): NpcDef => ({
    id, name: 'Slime', sprite: 'slime', x, y, facing: 'down', slime: tint, intro: [], chat: [],
  });
  return finish(b, {
    id: 'burrow', name: 'The Slime Burrow', indoor: true, farmable: false,
    spawn: { x: 9, y: 11 },
    warps: [{ x: 9, y: 12, w: 1, h: 1, to: 'forest', tx: 33, ty: 22, facing: 'down' }],
    npcs: [
      slime('burrow_union', 5, 9, 0xffffff),
      slime('burrow_hum', 14, 9, 0xd0f0ff),
      slime('burrow_gossip', 6, 11, 0xffe0f0),
      slime('burrow_shush', 7, 11, 0xe0ffd0),
      slime('burrow_hair', 13, 11, 0xfff0c0),
      {
        id: 'librarian', name: 'Slime Librarian', sprite: 'librarian', x: BURROW.librarian.x, y: BURROW.librarian.y,
        facing: 'down', intro: [], chat: [],
      },
    ],
    interact: [],
    slimes: 0,
    forage: [],
  });
}

const builders: Record<MapId, () => MapDef> = {
  farm: buildFarm, house: buildHouse, town: buildTown, shop: buildShop, forest: buildForest, burrow: buildBurrow,
};
const cache = new Map<MapId, MapDef>();

export function getMap(id: MapId): MapDef {
  let m = cache.get(id);
  if (!m) { m = builders[id](); cache.set(id, m); }
  return m;
}
