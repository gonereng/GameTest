import Phaser from 'phaser';
import type { CritterKind } from './maps';

type Body = Phaser.Physics.Arcade.Body;

const SPEED: Record<CritterKind, number> = { chicken_red: 22, chicken_blonde: 22, chick: 16, cow: 10, cow_male: 10 };
const isCow = (k: CritterKind) => k === 'cow' || k === 'cow_male';
export const CRITTER_LINES: Record<CritterKind, string[][]> = {
  chicken_red: [['Bawk.'], ['Bawk!', '(It looks proud of itself. Check the grass nearby for eggs.)'], ['Bawk bawk.', '(It looks at you like it knows something about the moon.)'], ['(The chicken pecks at absolutely nothing.)']],
  chicken_blonde: [['Cluck?'], ['Cluck!', '(Chickens lay eggs in the morning. This one wants you to know that.)'], ['Cluck cluck.', '(It seems unimpressed by your farming.)'], ['(It fluffs up its feathers.)']],
  chick: [['Peep!'], ['Peep peep peep!'], ['(It falls over. It gets back up. Peep.)']],
  cow: [['Moo.'], ['Mooooo.', '(Her name is Clementine. She told you, sort of.)'], ['(She chews thoughtfully.)']],
  cow_male: [['MOO.'], ['(He stares at the horizon like a cow with a past.)'], ['Moo. (It sounds like a warning about slimes.)']],
};

/** How far from home each animal wanders, in tiles (walking distance). */
const RANGE: Record<CritterKind, number> = { chicken_red: 3, chicken_blonde: 3, chick: 2, cow: 3, cow_male: 3 };
/** Each animal picks a new spot every SLOT_MS, walks there (at most WALK_MS), then rests until the next one. */
const SLOT_MS = 6000;
const WALK_MS = 4200;

type Tile = { x: number; y: number };

/** A tiny integer hash, so every device picks the same "random" spot for the same animal at the same time. */
function hash(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) { h ^= p | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; }
  return h >>> 0;
}
const mapSeed = (id: string) => [...id].reduce((n, ch) => Math.imul(n, 31) + ch.charCodeAt(0), 7);

/**
 * Farm animals. Where an animal is depends only on the real clock (and which animal it is), not on anything that
 * happens on this device. So everyone looking at the same farm, a visitor and its owner, sees each animal in the
 * same place doing the same thing, without sending positions over the network. They don't block the player.
 */
export class Critter extends Phaser.Physics.Arcade.Sprite {
  talks = 0;
  /** Which of the map's critters this is; used to remember today's milk and to pick its path. */
  readonly slot: number;
  private readonly seed: number;
  /** Tiles this animal may stand on: walkable, near home, and connected to it. */
  private readonly region: Tile[];
  private readonly regionKeys: Set<string>;
  private path: { k: number; tiles: Tile[] } | null = null;

  constructor(scene: Phaser.Scene, readonly kind: CritterKind, private readonly home: Tile, slot: number, mapId: string,
    walkable: (x: number, y: number) => boolean, private readonly tile = 16) {
    super(scene, (home.x + 0.5) * tile, (home.y + 0.5) * tile, kind, 0);
    this.slot = slot;
    this.seed = hash(mapSeed(mapId), slot);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const b = this.body as Body;
    if (isCow(kind)) b.setSize(18, 8).setOffset(7, 23);
    else b.setSize(8, 5).setOffset(4, 11);
    b.moves = false;
    // Everywhere it can reach from home within its range, walking around obstacles.
    const range = RANGE[kind];
    const seen = new Map<string, number>([[`${home.x},${home.y}`, 0]]);
    const queue: Tile[] = [home];
    this.region = [];
    while (queue.length) {
      const t = queue.shift()!;
      this.region.push(t);
      const d = seen.get(`${t.x},${t.y}`)!;
      if (d >= range) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: t.x + dx, y: t.y + dy }, key = `${n.x},${n.y}`;
        if (seen.has(key) || !walkable(n.x, n.y)) continue;
        seen.set(key, d + 1);
        queue.push(n);
      }
    }
    this.regionKeys = new Set(this.region.map(t => `${t.x},${t.y}`));
  }

  /** Where the animal heads in slot k: a spot in its region, the same on every device. */
  private spot(k: number): Tile {
    const h = hash(this.seed, k);
    // Two slots in five it stays put, so it spends a fair amount of time just standing around.
    if (h % 5 < 2) return k > 0 && (h >>> 3) % 3 ? this.spot(k - 1) : this.home;
    return this.region[(h >>> 8) % this.region.length];
  }

  /** Shortest walk between two tiles inside the region (the same answer on every device). */
  private route(from: Tile, to: Tile): Tile[] {
    const prev = new Map<string, string | null>([[`${from.x},${from.y}`, null]]);
    const queue: Tile[] = [from];
    while (queue.length) {
      const t = queue.shift()!;
      if (t.x === to.x && t.y === to.y) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${t.x + dx},${t.y + dy}`;
        if (prev.has(key) || !this.regionKeys.has(key)) continue;
        prev.set(key, `${t.x},${t.y}`);
        queue.push({ x: t.x + dx, y: t.y + dy });
      }
    }
    const out: Tile[] = [];
    for (let key: string | null | undefined = `${to.x},${to.y}`; key; key = prev.get(key)) {
      const [x, y] = key.split(',').map(Number);
      out.unshift({ x, y });
    }
    return out.length ? out : [from];
  }

  /** Puts the animal where the clock says it is. `wallMs` is real time (Date.now()), shared by every device. */
  think(wallMs: number): void {
    const k = Math.floor(wallMs / SLOT_MS);
    if (this.path?.k !== k) {
      // Slot k-1's spot leads to slot k's spot. (The depth of spot() is bounded by its own coin flips.)
      this.path = { k, tiles: this.route(this.spot(k - 1), this.spot(k)) };
    }
    const tiles = this.path.tiles;
    const steps = tiles.length - 1;
    const speed = SPEED[this.kind] / this.tile; // tiles per second
    const walkMs = Math.min(WALK_MS, (steps / speed) * 1000);
    const into = wallMs - k * SLOT_MS;
    const moving = steps > 0 && into < walkMs;
    const pos = moving ? (into / walkMs) * steps : steps;
    const i = Math.min(steps, Math.floor(pos)), f = pos - i;
    const a = tiles[i], b = tiles[Math.min(steps, i + 1)];
    const x = (a.x + (b.x - a.x) * f + 0.5) * this.tile, y = (a.y + (b.y - a.y) * f + 0.5) * this.tile;
    this.setPosition(x, y);
    (this.body as Body).updateFromGameObject();
    this.setDepth((this.body as Body).bottom);
    this.animate(moving, b.x - a.x, b.y - a.y);
  }

  private animate(moving: boolean, dx: number, dy: number): void {
    if (isCow(this.kind)) {
      if (moving) {
        const dir = dx !== 0 ? 'side' : dy > 0 ? 'down' : 'up';
        this.play(`${this.kind}_${dir}`, true);
        this.anims.resume();
        if (dx !== 0) this.setFlipX(dx > 0);
      } else if (this.anims.isPlaying) {
        this.anims.pause();
      } else if (!this.anims.currentAnim) {
        this.play(`${this.kind}_side`, true);
        this.anims.pause();
      }
      return;
    }
    this.play(moving ? `${this.kind}_walk` : `${this.kind}_idle`, true);
    if (moving && dx !== 0) this.setFlipX(dx > 0);
  }
}
