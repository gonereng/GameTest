import Phaser from 'phaser';
import { TILE, ZOOM } from '../config';
import { BED_SPAWN, getMap, type Facing, type Interactable, type MapDef, type MapId, type NpcDef, type Point, type Warp } from '../maps';
import { T, SOLID, TREE_TILES } from '../tiles';
import { CROPS, ITEMS, type ItemId } from '../items';
import {
  DAY_END, HOTBAR_SIZE, addItem, advanceDay, cropFrame, formatTime, isMature, removeAt, runtime, save, soilKey, state,
} from '../state';
import { modal, ui } from '../bus';
import { Slime } from '../slime';
import { mulberry32 } from '../rng';
import { Boss } from '../boss';
import { Story, flag, goalText, wearingSuit } from '../quest';
import { consumeTouch, touch } from '../touch';
import { Critter, CRITTER_LINES } from '../critters';
import { CHARACTERS } from '../textures';

type Body = Phaser.Physics.Arcade.Body;

const DIR: Record<Facing, Point> = {
  down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
const SLASH_ANGLE: Record<Facing, number> = { right: 0, down: 90, left: 180, up: -90 };
/** How far the sword reaches from the middle of the player's body, in world pixels (1.75 tiles). */
const SWORD_REACH = 28;
/** Time to walk one tile, in ms (80 pixels per second). */
const STEP_MS = 200;
/** A quick tap shorter than this just turns the player to face that way. */
const TURN_MS = 90;
/** Real milliseconds per in-game minute. A full day (6 AM to 2 AM) is about 14 minutes. */
const MS_PER_MINUTE = 700;

const CONTROLS = [
  'Move: WASD or arrow keys.',
  'Space (or J): use the selected item. Facing a crop, sign or person, it interacts instead.',
  'E (or K): talk, read, harvest, open things.',
  '1-0, Q or the mouse wheel: pick an item from the hotbar.',
  'Esc: menu. Sleep in your bed to end the day and save.',
];

interface WorldArgs {
  map?: MapId;
  spawn?: Point;
  facing?: Facing;
  intro?: boolean;
  newDay?: boolean;
  wake?: string;
}

export interface Npc {
  def: NpcDef;
  sprite: Phaser.Physics.Arcade.Sprite;
  talks: number;
}

interface Pickup {
  img: Phaser.GameObjects.Image;
  id: ItemId;
  forageKey?: string;
}

type KeyName = 'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'space' | 'j' | 'e' | 'k' | 'q' | 'esc';

export class WorldScene extends Phaser.Scene {
  private args: WorldArgs = {};
  def!: MapDef;
  layer!: Phaser.Tilemaps.TilemapLayer;
  player!: Phaser.Physics.Arcade.Sprite;
  npcs: Npc[] = [];
  lockedUntil = 0;
  private story!: Story;
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private facing: Facing = 'down';
  private slimes: Slime[] = [];
  private critters: Critter[] = [];
  private currentSkin: 'farmer' | 'suit' = 'farmer';
  private pickups: Pickup[] = [];
  private cropSprites = new Map<string, Phaser.GameObjects.Image>();
  private invulnUntil = 0;
  /** The tile the player stands on, or is walking away from. */
  private grid: Point = { x: 0, y: 0 };
  /** The step in progress, if any: from grid to (tx, ty), with t going 0 -> 1. */
  private step?: { tx: number; ty: number; t: number; ms: number };
  /** Direction keys currently held, oldest first; the newest one wins. */
  private heldOrder: Facing[] = [];
  private turnUntil = 0;
  /** Use/Talk pressed mid-step, done as soon as the step finishes. */
  private pendingAction: 'use' | 'talk' | null = null;
  private swingReadyAt = 0;
  private transitioning = false;
  private tickAcc = 0;

  constructor() { super('World'); }

  init(args: WorldArgs): void {
    this.args = args ?? {};
    this.facing = this.args.facing ?? 'down';
    this.npcs = [];
    this.slimes = [];
    this.critters = [];
    this.pickups = [];
    this.cropSprites = new Map();
    this.lockedUntil = 0;
    this.invulnUntil = 0;
    this.step = undefined;
    this.heldOrder = [];
    this.turnUntil = 0;
    this.pendingAction = null;
    this.swingReadyAt = 0;
    this.transitioning = false;
    this.tickAcc = 0;
  }

  create(): void {
    const def = (this.def = getMap(this.args.map ?? 'house'));
    runtime.map = def.id;
    runtime.indoor = def.indoor;

    const tilemap = this.make.tilemap({ data: def.tiles.map(r => r.slice()), tileWidth: TILE, tileHeight: TILE });
    // margin 1, spacing 2: matches the extruded 18x18 cells built in textures.ts.
    const tileset = tilemap.addTilesetImage('tiles', 'tiles', TILE, TILE, 1, 2)!;
    this.layer = tilemap.createLayer(0, tileset, 0, 0)!;
    this.layer.setCollision(SOLID);

    const W = def.w * TILE, H = def.h * TILE;
    this.physics.world.setBounds(0, 0, W, H);

    // Player
    const spawn = this.args.spawn ?? def.spawn;
    this.currentSkin = this.skin();
    this.grid = { x: spawn.x, y: spawn.y };
    this.player = this.physics.add.sprite(0, 0,
      this.currentSkin === 'suit' ? 'suit' : 'farmer_idle', this.currentSkin === 'suit' ? 'down_0' : 0);
    // The player moves tile by tile (see stepPlayer). The physics body just follows the sprite, so slimes
    // and pickups can still detect it.
    this.pbody().moves = false;
    this.applySkinBody();
    this.setIdleFrame();

    this.placeScenery();
    if (def.farmable) this.buildFarm();
    this.spawnNpcs();
    this.spawnSlimes(spawn);
    this.spawnForage();
    this.spawnEggs();
    this.story = new Story(this);
    this.story.create();

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    this.fitCameraBounds();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCameraBounds, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCameraBounds, this));
    cam.startFollow(this.player, true);
    cam.setBackgroundColor('#1a1410');
    cam.fadeIn(250, 0, 0, 0);

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
      space: 'SPACE', j: 'J', e: 'E', k: 'K', q: 'Q', esc: 'ESC',
    }) as Record<KeyName, Phaser.Input.Keyboard.Key>;
    kb.on('keydown', (e: KeyboardEvent) => {
      if (modal.open) return;
      const n = '1234567890'.indexOf(e.key);
      if (n >= 0) state.selected = n;
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!modal.open) this.cycleItem(dy > 0 ? 1 : -1);
    });

    ui.location(def.name);
    if (this.args.intro) this.time.delayedCall(500, () => this.intro());
    else if (this.args.wake) this.time.delayedCall(500, () => ui.dialogue({ lines: [this.args.wake!] }));
    if (this.args.newDay) {
      this.time.delayedCall(300, () => ui.toast(`Day ${state.day} - Good morning!`));
      this.story.onNewDay();
    }
  }

  // ------------------------------------------------------------------ setup

  private pbody(): Body { return this.player.body as Body; }

  private buildFarm(): void {
    for (const [key, soil] of Object.entries(state.soil)) {
      const [x, y] = key.split(',').map(Number);
      this.layer.putTileAt(soil.watered ? T.SOIL_WET : T.SOIL, x, y);
      this.refreshCrop(x, y);
    }
  }

  private spawnNpcs(): void {
    for (const def of this.def.npcs) {
      if (def.show && !def.show()) continue;
      const person = def.sprite in CHARACTERS;
      const s = this.physics.add.sprite((def.x + 0.5) * TILE, (def.y + 0.5) * TILE - 4, def.sprite, person ? 'down_0' : undefined);
      (s.body as Body).setSize(10, 6).setOffset(3, 10);
      if (def.slime !== undefined) s.setTint(def.slime).play('slime_idle').anims.setProgress(Math.random());
      s.setImmovable(true);
      s.setPushable(false);
      s.setDepth(s.y + 8);
      const npc = { def, sprite: s, talks: 0 };
      this.faceNpc(npc, def.facing);
      this.physics.add.collider(this.player, s);
      this.npcs.push(npc);
    }
    if (this.npcs.length) {
      this.time.addEvent({
        delay: 2600, loop: true, callback: () => {
          for (const n of this.npcs) {
            if (n.def.id !== 'bram' && n.def.sprite in CHARACTERS && Math.random() < 0.35) {
              this.faceNpc(n, Phaser.Utils.Array.GetRandom(['down', 'left', 'right', 'up'] as Facing[]));
            }
          }
        },
      });
    }
  }

  private faceNpc(n: Npc, f: Facing): void {
    if (!(n.def.sprite in CHARACTERS)) return;
    const dir = f === 'left' || f === 'right' ? 'side' : f;
    n.sprite.setFrame(`${dir}_0`);
    n.sprite.setFlipX(f === 'left');
  }

  private spawnSlimes(spawn: Point): void {
    this.physics.add.collider(this.slimes, this.layer);
    this.physics.add.collider(this.slimes, this.slimes);
    this.physics.add.overlap(this.player, this.slimes, (_p, s) => this.hurtPlayer(s as Slime));
    if (!this.def.slimes) return;
    const spots = this.def.open.filter(p => Math.abs(p.x - spawn.x) + Math.abs(p.y - spawn.y) > 9);
    for (let i = 0; i < this.def.slimes && spots.length; i++) {
      const p = spots.splice(Phaser.Math.Between(0, spots.length - 1), 1)[0];
      this.addSlime((p.x + 0.5) * TILE, (p.y + 0.5) * TILE - 4);
    }
  }

  addSlime(x: number, y: number, kind: 'slime' | 'gloop' = 'slime'): Slime {
    const s = new Slime(this, x, y, kind);
    this.slimes.push(s);
    return s;
  }

  removeSlime(s: Slime): void {
    const i = this.slimes.indexOf(s);
    if (i >= 0) this.slimes.splice(i, 1);
    s.destroy();
  }

  private spawnForage(): void {
    for (const p of this.def.forage) {
      const key = soilKey(p.x, p.y);
      if (state.forage[key]) continue;
      // Which item grows here changes from day to day.
      const id: ItemId = (p.x * 7 + p.y * 13 + state.day) % 3 === 0 ? 'mushroom' : 'berry';
      this.addPickup((p.x + 0.5) * TILE, (p.y + 0.5) * TILE, id, key);
    }
  }

  /**
   * Each grown chicken lays an egg most mornings, somewhere in the grass near where it lives.
   * Picked eggs are remembered until the next day, like forage.
   */
  private spawnEggs(): void {
    const solid = new Set(SOLID);
    const mapSeed = [...this.def.id].reduce((n, ch) => n * 31 + ch.charCodeAt(0), 7);
    this.def.critters.forEach((c, i) => {
      if (c.kind !== 'chicken_red' && c.kind !== 'chicken_blonde') return;
      const key = `egg:${this.def.id}:${i}`;
      if (state.forage[key]) return;
      const rnd = mulberry32(state.day * 7919 + i * 104729 + mapSeed);
      if (rnd() > 0.85) return; // a day off
      const golden = rnd() < 0.06;
      for (let tries = 0; tries < 12; tries++) {
        const x = c.x + Math.floor(rnd() * 5) - 2, y = c.y + Math.floor(rnd() * 5) - 2;
        const tile = this.def.tiles[y]?.[x];
        if (tile === undefined || solid.has(tile) || this.def.farmable && state.soil[soilKey(x, y)]) continue;
        this.addPickup((x + 0.3 + rnd() * 0.4) * TILE, (y + 0.5) * TILE, golden ? 'golden_egg' : 'egg', key, false);
        return;
      }
    });
  }

  private addPickup(x: number, y: number, id: ItemId, forageKey?: string, bob = true): void {
    const img = this.add.image(x, y, 'items', id).setDepth(y + 4);
    if (id === 'golden_egg') this.tweens.add({ targets: img, alpha: 0.7, yoyo: true, repeat: -1, duration: 500 });
    if (bob) this.tweens.add({ targets: img, y: y - 2, yoyo: true, repeat: -1, duration: 700 + Math.random() * 300, ease: 'Sine.inOut' });
    this.pickups.push({ img, id, forageKey });
  }

  private intro(): void {
    ui.dialogue({
      lines: [
        'Welcome to Thistle Farm, in the quiet valley of Hollowbrook.',
        'The last farmer packed up years ago, when slimes started creeping out of Mossy Woods.',
        "Now the land is yours. Grow crops, earn some gold, and teach those slimes some manners.",
        ...CONTROLS,
        'Tip: till grass with the Hoe, plant Strawberry Seeds, and water them. Ship crops in the bin outside.',
      ],
    });
  }

  // ------------------------------------------------------------------ loop

  update(_time: number, delta: number): void {
    const k = this.keys;
    // Always read "just pressed" so presses made while a dialogue is open are discarded.
    const pressUse = Phaser.Input.Keyboard.JustDown(k.space) || Phaser.Input.Keyboard.JustDown(k.j) || consumeTouch('use');
    const pressTalk = Phaser.Input.Keyboard.JustDown(k.e) || Phaser.Input.Keyboard.JustDown(k.k) || consumeTouch('talk');
    const pressNext = Phaser.Input.Keyboard.JustDown(k.q);
    const pressMenu = Phaser.Input.Keyboard.JustDown(k.esc) || consumeTouch('menu');

    if (this.transitioning) return;

    const now = this.time.now;
    const paused = modal.open;
    if (!paused) {
      this.tickClock(delta);
      if (this.transitioning) return;
    }

    const dir = this.heldDirection();
    if (!paused) this.stepPlayer(delta, now, now >= this.lockedUntil ? dir : null);
    if (this.transitioning) return;

    const skin = this.skin();
    if (this.currentSkin !== skin) {
      this.currentSkin = skin;
      this.player.anims.stop();
      this.player.setTexture(skin === 'suit' ? 'suit' : 'farmer_idle', skin === 'suit' ? 'down_0' : 0);
      this.applySkinBody();
    }
    if (this.step) {
      this.player.anims.play(`${skin}_${this.facing === 'left' || this.facing === 'right' ? 'side' : this.facing}`, true);
      this.player.setFlipX(this.flipPlayer());
    } else {
      this.setIdleFrame();
    }
    this.placePlayer();

    const inputOk = !paused && now >= this.lockedUntil && performance.now() - modal.closedAt > 150;
    if (inputOk) {
      if (pressMenu) this.openMenu();
      else if ((pressTalk || pressUse) && this.step) this.pendingAction = pressTalk ? 'talk' : 'use';
      else if (pressTalk) this.interact();
      else if (pressUse) this.useSelected();
      else if (pressNext) this.cycleItem(1);
    }

    const disguised = wearingSuit();
    for (const s of this.slimes) s.think(now, this.player, paused, disguised);
    for (const c of this.critters) c.think(now, paused);
    this.story.update(now, paused);
    this.checkPickups();

    this.player.setDepth(this.player.y + (this.currentSkin === 'suit' ? 5 : 10));
    this.player.setAlpha(now < this.invulnUntil && Math.floor(now / 90) % 2 ? 0.35 : 1);
  }

  // ------------------------------------------------------------------ grid movement

  /** Which direction the player wants to go: the most recently pressed key that's still held, or the joystick. */
  private heldDirection(): Facing | null {
    const k = this.keys;
    const held: Facing[] = [];
    if (k.left.isDown || k.a.isDown) held.push('left');
    if (k.right.isDown || k.d.isDown) held.push('right');
    if (k.up.isDown || k.w.isDown) held.push('up');
    if (k.down.isDown || k.s.isDown) held.push('down');
    // Joystick: whichever axis is pushed further.
    if (Math.hypot(touch.dx, touch.dy) > 0.3) {
      held.push(Math.abs(touch.dx) > Math.abs(touch.dy) ? (touch.dx < 0 ? 'left' : 'right') : touch.dy < 0 ? 'up' : 'down');
    }
    this.heldOrder = this.heldOrder.filter(d => held.includes(d));
    for (const d of held) if (!this.heldOrder.includes(d)) this.heldOrder.push(d);
    return this.heldOrder[this.heldOrder.length - 1] ?? null;
  }

  /** Can the player walk onto this tile? Walls, water, trees and people block it. */
  private canEnter(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.def.w || y >= this.def.h) return false;
    const tile = this.layer.getTileAt(x, y);
    if (!tile || tile.collides) return false;
    return !this.npcs.some(n => Math.floor(n.sprite.x / TILE) === x && Math.floor((n.sprite.y + 4) / TILE) === y);
  }

  private stepPlayer(delta: number, now: number, dir: Facing | null): void {
    if (this.step) {
      this.step.t += delta / this.step.ms;
      if (this.step.t < 1) return;
      const leftover = (this.step.t - 1) * this.step.ms;
      this.grid = { x: this.step.tx, y: this.step.ty };
      this.step = undefined;
      if (this.arrive()) return;
      // Keep walking without a pause if a direction is still held (turning corners included).
      if (dir) {
        this.facing = dir;
        this.tryStep(dir, leftover);
      }
      return;
    }
    if (!dir) return;
    if (dir !== this.facing) {
      // Tap to turn on the spot; keep holding to walk that way.
      this.facing = dir;
      this.turnUntil = now + TURN_MS;
      return;
    }
    if (now >= this.turnUntil) this.tryStep(dir, 0);
  }

  private tryStep(dir: Facing, elapsed: number, ms = STEP_MS): boolean {
    const tx = this.grid.x + DIR[dir].x, ty = this.grid.y + DIR[dir].y;
    if (!this.canEnter(tx, ty)) return false;
    this.step = { tx, ty, t: elapsed / ms, ms };
    return true;
  }

  /** Arrived on a new tile: doors and exits, then anything pressed during the step. Returns true if leaving the map. */
  private arrive(): boolean {
    const { x, y } = this.grid;
    const w = this.def.warps.find(w => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h && (!w.requires || flag(w.requires)));
    if (w) {
      this.placePlayer();
      this.travel(w);
      return true;
    }
    const action = this.pendingAction;
    this.pendingAction = null;
    if (action === 'talk') this.interact();
    else if (action === 'use') this.useSelected();
    return false;
  }

  /** Puts the sprite where the grid position (and any step in progress) says, with the feet on the tile. */
  private placePlayer(): void {
    let gx = this.grid.x, gy = this.grid.y;
    if (this.step) {
      const t = Math.min(1, this.step.t);
      gx += (this.step.tx - gx) * t;
      gy += (this.step.ty - gy) * t;
    }
    this.player.setPosition((gx + 0.5) * TILE, (gy + 0.5) * TILE - (this.currentSkin === 'suit' ? 5 : 7));
    this.pbody().updateFromGameObject();
  }

  /** Moves the player to a tile instantly (used by tests and debugging). */
  teleport(x: number, y: number): void {
    this.grid = { x, y };
    this.step = undefined;
    this.placePlayer();
  }

  private tickClock(delta: number): void {
    this.tickAcc += delta;
    while (this.tickAcc >= MS_PER_MINUTE) {
      this.tickAcc -= MS_PER_MINUTE;
      state.minutes++;
      this.story.onMinute();
      if (this.transitioning) return;
      if (state.minutes === 24 * 60) ui.toast("It's midnight. You should head to bed soon.");
      if (state.minutes >= DAY_END) {
        this.endDay(true, "It's 2 AM... you collapse from exhaustion. Somehow you wake up in bed, still tired.");
        return;
      }
    }
  }

  /**
   * Keeps the camera inside the map. If the screen is wider or taller than the map (small rooms on wide
   * phones), the bounds grow evenly on both sides so the room stays centred instead of hugging one edge.
   */
  private fitCameraBounds(): void {
    const cam = this.cameras.main;
    const mapW = this.def.w * TILE, mapH = this.def.h * TILE;
    const viewW = cam.width / cam.zoom, viewH = cam.height / cam.zoom;
    const bw = Math.max(mapW, viewW), bh = Math.max(mapH, viewH);
    cam.setBounds((mapW - bw) / 2, (mapH - bh) / 2, bw, bh);
  }

  private skin(): 'farmer' | 'suit' {
    return wearingSuit() ? 'suit' : 'farmer';
  }

  /** The farmer is a 32x32 frame and the slime suit 16x16, so the feet sit in different places. */
  private applySkinBody(): void {
    const b = this.pbody();
    if (this.currentSkin === 'suit') b.setSize(10, 6).setOffset(3, 10);
    else b.setSize(10, 6).setOffset(11, 20);
    this.placePlayer();
  }

  /** The pack's sideways frames face left; the slime suit's face right. */
  private flipPlayer(): boolean {
    return this.skin() === 'farmer' ? this.facing === 'right' : this.facing === 'left';
  }

  private setIdleFrame(): void {
    const dir = this.facing === 'left' || this.facing === 'right' ? 'side' : this.facing;
    this.player.setFlipX(this.flipPlayer());
    if (this.skin() === 'farmer') {
      this.player.anims.play(`farmer_idle_${dir}`, true);
      return;
    }
    this.player.anims.stop();
    this.player.setFrame(`${dir}_0`);
  }

  /** Pack sprites: houses, furniture, the shipping chest, trees and farm animals. */
  private placeScenery(): void {
    for (const p of this.def.props) {
      const [ox, oy] = p.origin ?? [0.5, 1];
      this.add.image(p.x, p.y, p.tex, p.frame).setOrigin(ox, oy).setDepth(p.depth ?? p.y);
    }
    // Every tree tile gets a maple sprite. Its base sits on the tile, and its canopy hangs over the tile above,
    // so you can walk behind trees.
    for (let y = 0; y < this.def.h; y++)
      for (let x = 0; x < this.def.w; x++) {
        if (!TREE_TILES.includes(this.def.tiles[y][x])) continue;
        const big = ((x * 73856093) ^ (y * 19349663)) % 10 < 3;
        const base = (y + 1) * TILE - 1;
        this.add.image((x + 0.5) * TILE, base + 1, 'tf_maple', big ? 'big' : 'medium').setOrigin(0.5, 1).setDepth(base);
      }
    for (const c of this.def.critters) {
      const critter = new Critter(this, (c.x + 0.5) * TILE, (c.y + 0.5) * TILE, c.kind);
      this.physics.add.collider(critter, this.layer);
      this.critters.push(critter);
    }
  }

  private cycleItem(step: number): void {
    state.selected = (state.selected + step + HOTBAR_SIZE) % HOTBAR_SIZE;
  }

  private travel(w: Warp): void {
    this.transitioning = true;
    this.pbody().setVelocity(0, 0);
    this.player.anims.stop();
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ map: w.to, spawn: { x: w.tx, y: w.ty }, facing: w.facing });
    });
  }

  /**
   * Fast-forwards the clock without ending the day. Every skipped minute still runs the story's clock
   * (moonlight growth, the 10 PM events), so nothing is missed. Naps also restore some energy.
   */
  private skipTime(minutes: number, nap: boolean): void {
    // Can't skip into the 2 AM collapse; go to bed instead.
    const latest = DAY_END - 10;
    const step = Math.min(minutes, latest - state.minutes);
    if (step < 10) {
      ui.dialogue({ lines: ["It's too late for that. Better get some proper sleep."] });
      return;
    }
    this.transitioning = true;
    this.pbody().setVelocity(0, 0);
    const cam = this.cameras.main;
    cam.fadeOut(350, 0, 0, 0);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      for (let i = 0; i < step; i++) {
        state.minutes++;
        this.story.onMinute();
      }
      this.tickAcc = 0;
      if (nap) state.energy = Math.min(state.maxEnergy, state.energy + Math.round(step / 6));
      this.transitioning = false;
      cam.fadeIn(350, 0, 0, 0);
      const span = step % 60 === 0 ? `${step / 60} hour${step === 60 ? '' : 's'}` : `${step} minutes`;
      ui.toast(`${nap ? 'You napped' : 'You waited'} for ${span}. It's ${formatTime(state.minutes)}.`);
    });
  }

  /** Ends the day: everything grows, the game saves, and you wake up at home. */
  private endDay(passedOut: boolean, wake?: string): void {
    this.transitioning = true;
    this.pbody().setVelocity(0, 0);
    this.cameras.main.fadeOut(passedOut ? 900 : 600, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      advanceDay(passedOut);
      save();
      this.scene.restart({ map: 'house', spawn: BED_SPAWN, facing: 'down', wake, newDay: true });
    });
  }

  // ------------------------------------------------------------------ interaction

  /** The tile in front of the player, and a point inside it a little towards the player. */
  private facingTarget() {
    const d = DIR[this.facing];
    const tx = this.grid.x + d.x, ty = this.grid.y + d.y;
    const cx = (this.grid.x + 0.5) * TILE, cy = (this.grid.y + 0.5) * TILE;
    return { px: cx + d.x * 12, py: cy + d.y * 12, tx, ty };
  }

  /** Talks, reads, harvests or picks up whatever is in front of the player. Returns true if something happened. */
  private interact(fromUse = false): boolean {
    const t = this.facingTarget();
    for (const n of this.npcs) {
      if (Phaser.Math.Distance.Between(t.px, t.py, n.sprite.x, n.sprite.y + 4) < 13) {
        this.talk(n);
        return true;
      }
    }
    const critter = this.critters.find(c => Phaser.Math.Distance.Between(t.px, t.py, c.x, (c.body as Body).center.y) < 14);
    if (critter) {
      const lines = CRITTER_LINES[critter.kind];
      ui.dialogue({ lines: lines[critter.talks++ % lines.length] });
      return true;
    }
    if (this.story.interactAt(t.tx, t.ty, fromUse)) return true;
    const it = this.def.interact.find(i => i.x === t.tx && i.y === t.ty);
    if (it) { this.useInteractable(it); return true; }
    const soil = this.def.farmable ? state.soil[soilKey(t.tx, t.ty)] : undefined;
    if (soil?.crop && isMature(soil)) { this.harvest(t.tx, t.ty); return true; }
    const p = this.pickups.find(p => Phaser.Math.Distance.Between(t.px, t.py, p.img.x, p.img.y) < 10);
    if (p) { this.collect(p); return true; }
    return false;
  }

  private talk(n: Npc): void {
    const dx = this.player.x - n.sprite.x, dy = this.player.y - n.sprite.y;
    this.faceNpc(n, Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down');
    if (this.story.talk(n.def, n.sprite)) return;
    if (!n.def.chat.length) return;
    let lines: string[];
    if (!state.met.includes(n.def.id)) {
      state.met.push(n.def.id);
      lines = n.def.intro;
    } else {
      lines = n.def.chat[(state.day + n.talks) % n.def.chat.length];
      n.talks++;
    }
    lines = lines.map(l => l.replace('{slimes}', String(state.slimes)).replace('{day}', String(state.day)));
    ui.dialogue({ speaker: n.def.name, lines });
  }

  private useInteractable(it: Interactable): void {
    switch (it.kind) {
      case 'bed':
        ui.dialogue({
          lines: [`Your bed. It's ${formatTime(state.minutes)}.`],
          choices: [
            { label: 'Sleep until morning (ends the day and saves)', action: () => this.endDay(false) },
            { label: 'Nap for 1 hour (+10 energy)', action: () => this.skipTime(60, true) },
            { label: 'Nap for 3 hours (+30 energy)', action: () => this.skipTime(180, true) },
            { label: 'Not yet' },
          ],
        });
        break;
      case 'bin':
        this.ship();
        break;
      case 'shop':
        ui.dialogue({
          speaker: 'Bram',
          lines: this.story.shopGreeting()
            ?? [state.met.includes('bram') ? 'Back again? Have a look.' : "Welcome to Bram's! Seeds, snacks, and the odd trinket. Have a look."],
          onClose: () => ui.shop(),
        });
        if (!state.met.includes('bram')) state.met.push('bram');
        break;
      case 'sign':
        ui.dialogue({ lines: it.lines ?? [] });
        break;
      case 'locked':
        ui.dialogue({ lines: ["It's locked. Nobody's expecting visitors."] });
        break;
    }
  }

  private ship(): void {
    ui.sell();
  }

  private useSelected(): void {
    if (this.interact(true)) return;
    const slot = state.selected;
    const stack = state.inventory[slot];
    if (!stack) return;
    const item = ITEMS[stack.id];
    if (stack.id === 'hoe') this.useHoe();
    else if (stack.id === 'can') this.useCan();
    else if (stack.id === 'sword') this.swingSword();
    else if (stack.id === 'suit') ui.toast("You're wearing the Slime Suit. Slimes think you're one of them.");
    else if (item.kind === 'seed') this.plant(slot);
    else if (item.energy || item.heal) this.offerEat(slot);
  }

  private spend(cost: number): boolean {
    if (state.energy < cost) {
      ui.toast("You're too tired. Eat something or get some sleep.");
      return false;
    }
    state.energy -= cost;
    return true;
  }

  private useHoe(): void {
    const t = this.facingTarget();
    this.toolAnim('hoe', t.px, t.py);
    if (!this.def.farmable) { ui.toast('The ground here is too hard. Till on your farm.'); return; }
    const tile = this.layer.getTileAt(t.tx, t.ty);
    const key = soilKey(t.tx, t.ty);
    if (!tile || (tile.index !== T.GRASS && tile.index !== T.FLOWER) || state.soil[key]) return;
    if (!this.spend(2)) return;
    state.soil[key] = { watered: false };
    this.layer.putTileAt(T.SOIL, t.tx, t.ty);
    this.burst((t.tx + 0.5) * TILE, (t.ty + 0.5) * TILE, 0x7a5232, 6);
  }

  private useCan(): void {
    const t = this.facingTarget();
    this.toolAnim('can', t.px, t.py);
    const soil = this.def.farmable ? state.soil[soilKey(t.tx, t.ty)] : undefined;
    if (!soil || soil.watered) return;
    if (!this.spend(1)) return;
    soil.watered = true;
    this.layer.putTileAt(T.SOIL_WET, t.tx, t.ty);
    this.burst((t.tx + 0.5) * TILE, (t.ty + 0.5) * TILE, 0x7fb4f2, 8);
  }

  private plant(slot: number): void {
    const t = this.facingTarget();
    const soil = this.def.farmable ? state.soil[soilKey(t.tx, t.ty)] : undefined;
    if (!soil) { ui.toast('Seeds need tilled soil. Use the Hoe on your farm first.'); return; }
    if (soil.crop) return;
    soil.crop = { id: ITEMS[state.inventory[slot]!.id].crop!, days: 0 };
    removeAt(slot, 1);
    this.refreshCrop(t.tx, t.ty);
    this.lockedUntil = this.time.now + 150;
  }

  refreshCrop(x: number, y: number): void {
    const key = soilKey(x, y);
    const soil = state.soil[key];
    let spr = this.cropSprites.get(key);
    if (!soil?.crop) {
      spr?.destroy();
      this.cropSprites.delete(key);
      return;
    }
    const frame = `${soil.crop.id}_${cropFrame(soil)}`;
    if (!spr) {
      spr = this.add.image((x + 0.5) * TILE, (y + 0.5) * TILE - 2, 'crops', frame).setDepth((y + 1) * TILE - 3);
      this.cropSprites.set(key, spr);
    } else spr.setFrame(frame);
  }

  private harvest(x: number, y: number): void {
    const soil = state.soil[soilKey(x, y)];
    const produce = CROPS[soil.crop!.id].produce;
    if (!addItem(produce, 1)) { ui.toast('Your bag is full!'); return; }
    soil.crop = undefined;
    this.refreshCrop(x, y);
    this.popIcon(produce, (x + 0.5) * TILE, (y + 0.5) * TILE);
    ui.toast(`+1 ${ITEMS[produce].name}`);
  }

  private offerEat(slot: number): void {
    const item = ITEMS[state.inventory[slot]!.id];
    const gains = [item.energy ? `+${item.energy} energy` : '', item.heal ? `+${item.heal} heart` : ''].filter(Boolean).join(', ');
    ui.dialogue({
      lines: [`Eat the ${item.name}? (${gains})`],
      choices: [
        {
          label: 'Eat',
          action: () => {
            if (state.inventory[slot]?.id !== item.id) return;
            state.energy = Math.min(state.maxEnergy, state.energy + (item.energy ?? 0));
            state.hp = Math.min(state.maxHp, state.hp + (item.heal ?? 0));
            removeAt(slot, 1);
            ui.toast(`Yum! ${gains}`);
          },
        },
        { label: 'No' },
      ],
    });
  }

  private openMenu(): void {
    ui.dialogue({
      speaker: 'Menu',
      lines: [`Day ${state.day}, ${formatTime(state.minutes)}.  Gold: ${state.gold}g.  Slimes defeated: ${state.slimes}.` +
        (goalText() ? `\nGoal: ${goalText()}` : '')],
      choices: [
        { label: 'Resume' },
        { label: 'Wait 1 hour', action: () => this.skipTime(60, false) },
        { label: 'Controls', action: () => ui.dialogue({ speaker: 'Controls', lines: CONTROLS }) },
        {
          label: 'Quit to title (progress since you last slept is lost)',
          action: () => { this.scene.stop('UI'); this.scene.start('Title'); },
        },
      ],
    });
  }

  // ------------------------------------------------------------------ combat

  private swingSword(): void {
    const now = this.time.now;
    if (now < this.swingReadyAt) return;
    this.swingReadyAt = now + 380;
    this.lockedUntil = now + 180;
    const d = DIR[this.facing];
    const b = this.pbody();
    // The swing covers a half circle in front of the player, centred on the middle of their body.
    const ox = b.center.x, oy = b.center.y - 4;
    this.slashArc(ox, oy, SLASH_ANGLE[this.facing]);

    const hits = (r: Phaser.Geom.Rectangle): boolean => {
      // Close enough: the nearest point of the target is within reach.
      const nx = Phaser.Math.Clamp(ox, r.left, r.right), ny = Phaser.Math.Clamp(oy, r.top, r.bottom);
      if (Math.hypot(nx - ox, ny - oy) > SWORD_REACH) return false;
      // In front: at least part of the target is on the facing side of the player (180 degrees).
      const fx = d.x >= 0 ? r.right : r.left, fy = d.y >= 0 ? r.bottom : r.top;
      return (fx - ox) * d.x + (fy - oy) * d.y >= 0;
    };
    // Knock targets straight away from the player, whichever side of the arc they were on.
    const away = (x: number, y: number) => {
      const len = Math.hypot(x - ox, y - oy) || 1;
      return { x: (x - ox) / len, y: (y - oy) / len };
    };
    this.story.onSwing(hits, away, now);
    for (const s of [...this.slimes]) {
      const sb = s.body as Body;
      if (!hits(new Phaser.Geom.Rectangle(sb.x, sb.y, sb.width, sb.height))) continue;
      const k = away(sb.center.x, sb.center.y);
      if (s.damage(k.x, k.y, now)) this.killSlime(s);
    }
  }

  /** A white arc that sweeps 180 degrees around the player, with the sword riding along its edge. */
  private slashArc(x: number, y: number, facingDeg: number): void {
    const g = this.add.graphics().setDepth(this.player.depth + 1);
    const sword = this.add.image(x, y, 'items', 'sword').setDepth(this.player.depth + 2);
    const start = Phaser.Math.DegToRad(facingDeg - 90);
    const sweep = { t: 0 };
    const r = SWORD_REACH - 6;
    const draw = () => {
      const end = start + Math.PI * sweep.t;
      g.clear();
      g.lineStyle(7, 0xdcefff, 0.35).beginPath().arc(x, y, r, start, end).strokePath();
      g.lineStyle(3, 0xffffff, 0.95).beginPath().arc(x, y, r + 2, Math.max(start, end - 1.2), end).strokePath();
      sword.setPosition(x + Math.cos(end) * (r - 6), y + Math.sin(end) * (r - 6));
      // The sword icon points up-right (-45 degrees); turn it to point outward along the swing.
      sword.setRotation(end + Math.PI / 4);
    };
    draw();
    this.tweens.add({
      targets: sweep, t: 1, duration: 150, ease: 'Quad.out', onUpdate: draw,
      onComplete: () => {
        sword.destroy();
        this.tweens.add({ targets: g, alpha: 0, duration: 120, onComplete: () => g.destroy() });
      },
    });
  }

  private killSlime(s: Slime): void {
    state.slimes++;
    this.burst(s.x, s.y + 2, 0x6ad06a, 12);
    if (Math.random() < 0.8) {
      // Drop it in the middle of a walkable tile, so you can step onto it.
      const tx = Math.floor(s.x / TILE), ty = Math.floor((s.y + 4) / TILE);
      const spot = [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: tx + dx, y: ty + dy })).find(p => this.canEnter(p.x, p.y));
      if (spot) this.addPickup((spot.x + 0.5) * TILE, (spot.y + 0.5) * TILE - 2, 'gel');
    }
    this.removeSlime(s);
    if (state.slimes % 10 === 0) ui.toast(`${state.slimes} slimes defeated! Mayor Orla will be pleased.`);
  }

  hurtPlayer(s: Slime | Boss): void {
    const now = this.time.now;
    if (modal.open || this.transitioning || now < this.invulnUntil) return;
    if (s instanceof Slime && (s.dead || (wearingSuit() && !s.angry))) return;
    state.hp--;
    this.invulnUntil = now + 1000;
    const dx = this.player.x - s.x, dy = this.player.y - s.y;
    // Knocked back one tile, away from whatever hit you, if there's room.
    if (!this.step) {
      const away: Facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
      this.tryStep(away, 0, 110);
    }
    if (s instanceof Slime) s.knock(-dx, -dy, now, 90);
    this.cameras.main.shake(120, 0.004);
    this.player.setTintFill(0xff6060);
    this.time.delayedCall(110, () => this.player.clearTint());
    if (state.hp <= 0) {
      state.hp = 0;
      const lost = Math.floor(state.gold * 0.1);
      state.gold -= lost;
      this.endDay(true, `You were knocked out! Someone from town carried you home.${lost ? ` (You dropped ${lost}g.)` : ''}`);
    }
  }

  // ------------------------------------------------------------------ pickups & effects

  private checkPickups(): void {
    const b = this.pbody();
    for (const p of [...this.pickups]) {
      if (Phaser.Math.Distance.Between(b.center.x, b.center.y, p.img.x, p.img.y + 2) < 9) this.collect(p);
    }
  }

  private collect(p: Pickup): void {
    if (!addItem(p.id, 1)) { ui.toast('Your bag is full!'); return; }
    this.pickups.splice(this.pickups.indexOf(p), 1);
    if (p.forageKey) state.forage[p.forageKey] = true;
    this.tweens.killTweensOf(p.img);
    this.popIcon(p.id, p.img.x, p.img.y);
    p.img.destroy();
    ui.toast(`+1 ${ITEMS[p.id].name}`);
  }

  private popIcon(id: ItemId, x: number, y: number): void {
    const img = this.add.image(x, y, 'items', id).setDepth(10000);
    this.tweens.add({ targets: img, y: y - 14, alpha: 0, duration: 500, ease: 'Quad.out', onComplete: () => img.destroy() });
  }

  private toolAnim(id: ItemId, x: number, y: number): void {
    this.lockedUntil = this.time.now + 230;
    this.pbody().setVelocity(0, 0);
    const flip = this.facing === 'left';
    const icon = this.add.image(x, y - 6, 'items', id).setDepth(this.player.depth + 1).setFlipX(flip);
    this.tweens.add({
      targets: icon, angle: { from: flip ? 40 : -40, to: flip ? -30 : 30 }, duration: 150,
      onComplete: () => this.tweens.add({ targets: icon, alpha: 0, duration: 90, onComplete: () => icon.destroy() }),
    });
  }

  burst(x: number, y: number, color: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const p = this.add.image(x, y, 'spark').setTint(color).setDepth(10000);
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 8;
      this.tweens.add({
        targets: p, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r - 4, alpha: 0,
        duration: 300 + Math.random() * 200, ease: 'Quad.out', onComplete: () => p.destroy(),
      });
    }
  }
}
