import Phaser from 'phaser';
import { TILE, ZOOM } from '../config';
import { BED_SPAWN, getMap, type Facing, type Interactable, type MapDef, type MapId, type NpcDef, type Point, type Warp } from '../maps';
import { T, SOLID, TREE_TILES } from '../tiles';
import { CROPS, ITEMS, RECIPES, SEASON_NAMES, countOf, plural, type ItemId } from '../items';
import {
  DAY_END, addItem, advanceDay, countItem, cropFrame, dateLabel, endVisit, farmView, formatTime, fromSaveData, inSeason, isMature, loadSave, removeAt,
  removeItem, runtime, save, seasonOf, soilKey, startVisit, state, yearOf,
} from '../state';
import {
  claimGift, cloudEnabled, currentUser, downloadSave, fetchBoard, pushFarm, uploadSave, fetchFarm, fetchGifts, formatCode, getProfile, sendGift, setOnBoards,
  type BoardId,
} from '../cloud';
import { askText, cleanCode } from '../textPrompt';
import { DEEP_PATH, DEEP_UNLOCK_SLIMES } from '../maps';
import {
  FRIEND_NAMES, canGift, chatted, claimRewards, friendsSummary, giftedToday, giveGift, heartBar, isFriend, type FriendId,
} from '../friends';
import { isMuted, setMuted, setMusicMood, sfx } from '../audio';
import { modal, ui } from '../bus';
import { Slime, type SlimeTier } from '../slime';
import { mulberry32 } from '../rng';
import { Boss } from '../boss';
import { Story, flag, goalText, wearingSuit } from '../quest';
import { consumeTouch, touch } from '../touch';
import { Critter, CRITTER_LINES } from '../critters';
import { Cat } from '../cat';
import { SideQuests, cowHasHat, mayorClementine, sideGoals } from '../sidequests';
import { CHARACTERS } from '../textures';

type Body = Phaser.Physics.Arcade.Body;

/** How often to check whether your farm changed (and send it for visitors), and how often a visit refreshes. */
const FARM_PUSH_MS = 4000;
/** Where the cat sits on the farm, by the house. */
const CAT_SPOT = { x: 10, y: 8 };
const VISIT_REFRESH_MS = 10000;
/** The farm view last sent, so unchanged farms aren't sent again. Kept across scene restarts. */
let lastPushed = '';
let pushing = false;

/** Multiplies two tint colours, channel by channel. */
function mix(a: number, b: number): number {
  const ch = (shift: number) => Math.round((((a >> shift) & 255) * ((b >> shift) & 255)) / 255) << shift;
  return ch(16) | ch(8) | ch(0);
}

const DIR: Record<Facing, Point> = {
  down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
const SLASH_ANGLE: Record<Facing, number> = { right: 0, down: 90, left: 180, up: -90 };
/** How far the sword reaches from the middle of the player's body, in world pixels (1.75 tiles). */
const SWORD_REACH = 28;
/** Time to walk one tile, in ms (80 pixels per second). */
const STEP_MS = 200;
/** With the Fast buff (from an Omelette). */
const FAST_STEP_MS = 150;
/** How the outdoors is tinted in each season: [ground, trees]. */
const SEASON_TINT: [number, number][] = [[0xffffff, 0xffffff], [0xffffff, 0xffffff], [0xffd890, 0xffa050], [0xd8e4f4, 0xc8d8f0]];
/** The Deep Woods are gloomier than the rest of the valley, whatever the season. */
const DEEP_GLOOM = 0xa8b8b0;
/** A quick tap shorter than this just turns the player to face that way. */
const TURN_MS = 90;
/** Real milliseconds per in-game minute. A full day (6 AM to 2 AM) is about 14 minutes. */
const MS_PER_MINUTE = 700;

const CONTROLS = [
  'Move: WASD or arrow keys.',
  'Space (or J): use the selected item. Facing a crop, sign or person, it interacts instead.',
  'E (or K): talk, read, harvest, open things.',
  '1-0 (and - = with the Backpack), Q or the mouse wheel: pick an item from the hotbar.',
  'Esc: menu. M: sound on or off. Sleep in your bed to end the day and save.',
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

type KeyName = 'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'space' | 'j' | 'e' | 'k' | 'q' | 'm' | 'esc';

export class WorldScene extends Phaser.Scene {
  private args: WorldArgs = {};
  def!: MapDef;
  layer!: Phaser.Tilemaps.TilemapLayer;
  player!: Phaser.Physics.Arcade.Sprite;
  npcs: Npc[] = [];
  lockedUntil = 0;
  private story!: Story;
  private side!: SideQuests;
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private facing: Facing = 'down';
  private slimes: Slime[] = [];
  private critters: Critter[] = [];
  private currentSkin: 'farmer' | 'suit' = 'farmer';
  private pickups: Pickup[] = [];
  private cropSprites = new Map<string, Phaser.GameObjects.Image>();
  private treeImages: Phaser.GameObjects.Image[] = [];
  /** The farm cat (pet it ten times). */
  private cat?: Cat;
  private sprinklerSprites = new Map<string, Phaser.GameObjects.Image>();
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
    this.sprinklerSprites = new Map();
    this.treeImages = [];
    this.cat = undefined;
    this.visitStamp = '';
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
    if (def.id === 'farm') this.cat = new Cat(this, CAT_SPOT.x, CAT_SPOT.y, TILE, (x, y, c, n) => this.burst(x, y, c, n));
    if (def.farmable) this.buildFarm();
    this.spawnNpcs();
    this.spawnSlimes(spawn);
    if (!runtime.visit) {
      this.spawnForage();
      this.spawnEggs();
    }
    this.story = new Story(this);
    this.story.create();
    this.side = new SideQuests(this);
    this.side.create();
    // Clementine keeps her campaign hat once she has it.
    if (this.def.id === 'farm' && cowHasHat()) this.critters.find(c => c.kind === 'cow')?.wearHat();

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
      space: 'SPACE', j: 'J', e: 'E', k: 'K', q: 'Q', m: 'M', esc: 'ESC',
    }) as Record<KeyName, Phaser.Input.Keyboard.Key>;
    kb.on('keydown', (e: KeyboardEvent) => {
      if (modal.open) return;
      const n = '1234567890-='.indexOf(e.key);
      if (n >= 0 && n < state.inventory.length) state.selected = n;
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!modal.open) this.cycleItem(dy > 0 ? 1 : -1);
    });

    if (def.id === 'forest' && flag('deepOpen')) for (const p of DEEP_PATH) this.layer.putTileAt(T.DARK_GRASS, p.x, p.y);
    this.applySeason();

    // Online: keep visitors' view of your farm up to date, or keep a visit up to date with its owner's farm.
    if (cloudEnabled) {
      this.time.addEvent({ delay: runtime.visit ? VISIT_REFRESH_MS : FARM_PUSH_MS, loop: true, callback: () => {
        if (runtime.visit) void this.refreshVisit();
        else void this.pushFarmIfChanged();
      } });
    }

    ui.location(def.name);
    if (this.args.intro) this.time.delayedCall(500, () => this.intro());
    else if (this.args.wake) this.time.delayedCall(500, () => ui.dialogue({ lines: [this.args.wake!] }));
    if (this.args.newDay) {
      this.time.delayedCall(300, () => ui.toast(`${dateLabel(state.day)} - Good morning!`));
      void this.morningNews();
      if (state.weather === 'rain') this.time.delayedCall(700, () => ui.toast("It's raining! Your crops are watered today."));
      this.story.onNewDay();
      this.side.onNewDay();
    }
  }

  // ------------------------------------------------------------------ setup

  private pbody(): Body { return this.player.body as Body; }

  /** Things to tell the player when they wake up: a new season, withered crops, the Deep Woods opening. */
  private async morningNews(): Promise<void> {
    const news: string[] = [];
    const dayOfSeason = (state.day - 1) % 28 + 1;
    if (dayOfSeason === 1 && state.day > 1) {
      const season = SEASON_NAMES[seasonOf(state.day)];
      news.push(`${season} has arrived${seasonOf(state.day) === 0 ? ` - welcome to Year ${yearOf(state.day)}!` : '!'} Bram has new seeds in stock.`);
      if (runtime.withered) news.push(`${runtime.withered} crop${runtime.withered > 1 ? 's' : ''} that can't grow in ${season} withered overnight.`);
    }
    if (!flag('deepOpen') && state.slimes >= DEEP_UNLOCK_SLIMES) {
      state.quest.flags.deepOpen = true;
      news.push(
        'A note was slipped under your door:',
        `"${DEEP_UNLOCK_SLIMES} slimes! The overgrown path on the west side of Mossy Woods has been cleared. The Deep Woods lie beyond. Tougher slimes, better loot. Do be careful. - Mayor Orla"`,
      );
    }
    news.push(...await this.checkMail());
    if (news.length) this.time.delayedCall(900, () => { if (this.scene.isActive()) ui.dialogue({ lines: news }); });
  }

  /** Outdoor maps take on the season's colours: warm in fall, frosty in winter. */
  private applySeason(): void {
    if (this.def.indoor) return;
    let [ground, trees] = SEASON_TINT[seasonOf(state.day)];
    if (this.def.tough) { ground = mix(ground, DEEP_GLOOM); trees = mix(trees, DEEP_GLOOM); }
    this.layer.setTint(ground);
    for (const img of this.treeImages) img.setTint(trees);
  }

  private buildFarm(): void {
    for (const [key, soil] of Object.entries(state.soil)) {
      const [x, y] = key.split(',').map(Number);
      this.layer.putTileAt(soil.watered ? T.SOIL_WET : T.SOIL, x, y);
      this.refreshCrop(x, y);
    }
    for (const key of state.sprinklers) this.addSprinklerSprite(key);
  }

  private addSprinklerSprite(key: string): void {
    const [x, y] = key.split(',').map(Number);
    const img = this.add.image((x + 0.5) * TILE, (y + 0.5) * TILE - 1, 'items', 'sprinkler').setDepth((y + 1) * TILE - 2);
    this.sprinklerSprites.set(key, img);
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
      const tier = this.def.tough ? (Math.random() < 0.3 ? 3 : 2) : 1;
      this.addSlime((p.x + 0.5) * TILE, (p.y + 0.5) * TILE - 4, 'slime', tier);
    }
  }

  addSlime(x: number, y: number, kind: 'slime' | 'gloop' = 'slime', tier: SlimeTier = 1): Slime {
    const s = new Slime(this, x, y, kind, tier);
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
        if (tile === undefined || solid.has(tile) || this.def.farmable && (state.soil[soilKey(x, y)] || this.hasSprinkler(x, y))) continue;
        if (this.def.id === 'farm' && x === CAT_SPOT.x && y === CAT_SPOT.y) continue;
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
        'Welcome to Thistle Farm, {name}, in the quiet valley of Hollowbrook.',
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
    if (Phaser.Input.Keyboard.JustDown(k.m) && !modal.open) this.toggleSound();
    setMusicMood({ night: state.minutes >= 20 * 60, rain: state.weather === 'rain', indoor: this.def.indoor });

    if (this.transitioning) return;

    const now = this.time.now;
    const paused = modal.open;
    if (!paused) {
      if (!runtime.visit) this.tickClock(delta);
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
    // Animals follow the real clock (not the game's), so every player sees them in the same places.
    const wall = Date.now();
    for (const c of this.critters) c.think(wall);
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
    if (this.hasSprinkler(x, y)) return false;
    if (this.cat && x === this.cat.tx && y === this.cat.ty) return false;
    if (this.side?.blocks(x, y)) return false;
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

  private tryStep(dir: Facing, elapsed: number, ms = state.buffs.speed ? FAST_STEP_MS : STEP_MS): boolean {
    const tx = this.grid.x + DIR[dir].x, ty = this.grid.y + DIR[dir].y;
    if (!this.canEnter(tx, ty)) return false;
    this.step = { tx, ty, t: elapsed / ms, ms };
    return true;
  }

  /** Arrived on a new tile: doors and exits, then anything pressed during the step. Returns true if leaving the map. */
  private arrive(): boolean {
    const { x, y } = this.grid;
    const w = this.def.warps.find(w => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h && (!w.requires || flag(w.requires)));
    if (w && runtime.visit) {
      ui.toast("Visitors stay on the farm. Press Esc (or the menu button) to go home.");
    } else if (w) {
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
      this.side.onMinute();
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

  /** The farmer's sideways frames (Tiny Farm pack, row 2) and the slime suit's both face right, so mirror them for left. */
  private flipPlayer(): boolean {
    return this.facing === 'left';
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
        this.treeImages.push(this.add.image((x + 0.5) * TILE, base + 1, 'tf_maple', big ? 'big' : 'medium').setOrigin(0.5, 1).setDepth(base));
      }
    // Only the map decides where animals can walk (not crops or anything else that differs between players),
    // so their paths are the same for everyone.
    const solid = new Set(SOLID);
    const walkable = (x: number, y: number) => {
      const t = this.def.tiles[y]?.[x];
      if (t === undefined || solid.has(t)) return false;
      return !(this.def.id === 'farm' && x === CAT_SPOT.x && y === CAT_SPOT.y);
    };
    for (const [i, c] of this.def.critters.entries()) {
      this.critters.push(new Critter(this, c.kind, { x: c.x, y: c.y }, i, this.def.id, walkable, TILE));
    }
  }

  private cycleItem(step: number): void {
    const n = state.inventory.length;
    state.selected = (state.selected + step + n) % n;
    sfx('select');
  }

  private hasSprinkler(x: number, y: number): boolean {
    return this.def.farmable && state.sprinklers.includes(soilKey(x, y));
  }

  private toggleSound(): void {
    setMuted(!isMuted());
    ui.toast(isMuted() ? 'Sound off. (M to turn it back on)' : 'Sound on.');
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
    if (runtime.visit) return this.visitorInteract();
    const t = this.facingTarget();
    for (const n of this.npcs) {
      if (Phaser.Math.Distance.Between(t.px, t.py, n.sprite.x, n.sprite.y + 4) < 13) {
        if (fromUse && isFriend(n.def.id) && this.offerGift(n.def.id)) return true;
        this.talk(n);
        return true;
      }
    }
    if (this.petCat()) return true;
    const critter = this.critters.find(c => Phaser.Math.Distance.Between(t.px, t.py, c.x, (c.body as Body).center.y) < 14);
    if (critter) {
      if (this.side.critter(critter)) return true;
      if (this.milk(critter)) return true;
      const lines = CRITTER_LINES[critter.kind];
      ui.dialogue({ lines: lines[critter.talks++ % lines.length] });
      return true;
    }
    if (this.side.interactAt(t.tx, t.ty)) return true;
    if (this.story.interactAt(t.tx, t.ty, fromUse)) return true;
    const it = this.def.interact.find(i => i.x === t.tx && i.y === t.ty);
    if (it && fromUse && it.kind === 'shop' && this.offerGift('bram')) return true;
    if (it) { this.useInteractable(it); return true; }
    if (this.hasSprinkler(t.tx, t.ty)) { this.offerPickUpSprinkler(t.tx, t.ty); return true; }
    const soil = this.def.farmable ? state.soil[soilKey(t.tx, t.ty)] : undefined;
    if (soil?.crop && isMature(soil)) { this.harvest(t.tx, t.ty); return true; }
    const p = this.pickups.find(p => Phaser.Math.Distance.Between(t.px, t.py, p.img.x, p.img.y) < 10);
    if (p) { this.collect(p); return true; }
    return false;
  }

  /** Your cow on the farm gives milk once a day. Returns false if there's no milk right now. */
  private milk(c: Critter): boolean {
    if (c.kind !== 'cow' || !this.def.farmable) return false;
    const key = `milk:${this.def.id}:${c.slot}`;
    if (state.forage[key]) {
      if (c.talks === 0) { c.talks++; ui.dialogue({ lines: ['Moo.', "(You've already had today's milk. Come back tomorrow.)"] }); return true; }
      return false;
    }
    // Mayor Clementine gives twice as much. It's in the decree.
    const n = mayorClementine() ? 2 : 1;
    if (!addItem('milk', n)) { ui.toast('Your bag is full!'); return true; }
    state.forage[key] = true;
    sfx('milk');
    this.popIcon('milk', c.x, c.y - 8);
    ui.toast(`+${n} Milk`);
    return true;
  }

  private placeSprinkler(slot: number): void {
    const t = this.facingTarget();
    if (!this.def.farmable) { ui.toast('Sprinklers go on your farm.'); return; }
    const tile = this.layer.getTileAt(t.tx, t.ty);
    const key = soilKey(t.tx, t.ty);
    const blocked = this.npcs.some(n => Math.floor(n.sprite.x / TILE) === t.tx && Math.floor((n.sprite.y + 4) / TILE) === t.ty);
    if (!tile || (tile.index !== T.GRASS && tile.index !== T.FLOWER) || state.soil[key] || this.hasSprinkler(t.tx, t.ty) || blocked) {
      sfx('error');
      ui.toast('Place the sprinkler on open grass, next to the soil you want watered.');
      return;
    }
    state.sprinklers.push(key);
    removeAt(slot, 1);
    this.addSprinklerSprite(key);
    sfx('place');
    this.burst((t.tx + 0.5) * TILE, (t.ty + 0.5) * TILE, 0x7fb4f2, 8);
    this.lockedUntil = this.time.now + 150;
    ui.toast('Sprinkler placed. It waters the 8 tiles around it every morning.');
  }

  private offerPickUpSprinkler(x: number, y: number): void {
    ui.dialogue({
      lines: ['A sprinkler. It waters the 8 tiles around it every morning.'],
      choices: [
        {
          label: 'Pick it up',
          action: () => {
            const key = soilKey(x, y);
            if (!state.sprinklers.includes(key)) return;
            if (!addItem('sprinkler', 1)) { ui.toast('Your bag is full!'); return; }
            state.sprinklers = state.sprinklers.filter(k => k !== key);
            this.sprinklerSprites.get(key)?.destroy();
            this.sprinklerSprites.delete(key);
            sfx('pickup');
          },
        },
        { label: 'Leave it' },
      ],
    });
  }

  private talk(n: Npc): void {
    const dx = this.player.x - n.sprite.x, dy = this.player.y - n.sprite.y;
    this.faceNpc(n, Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down');
    if (this.side.talk(n.def)) return;
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
    if (isFriend(n.def.id)) {
      chatted(n.def.id);
      lines = [...lines, ...claimRewards(n.def.id)];
    }
    ui.dialogue({ speaker: n.def.name, lines });
  }

  /** Using a held item on Orla, Pip or Bram's counter offers it as a gift. Returns false if there's nothing to give. */
  private offerGift(id: FriendId): boolean {
    const slot = state.selected;
    const stack = state.inventory[slot];
    if (!stack || !canGift(stack.id)) return false;
    const name = FRIEND_NAMES[id];
    if (giftedToday(id)) {
      ui.dialogue({ speaker: name, lines: ["You've already given me something today. Come back tomorrow!"] });
      return true;
    }
    const item = stack.id;
    ui.dialogue({
      lines: [`Give the ${ITEMS[item].name} to ${name}?`],
      choices: [
        {
          label: `Give it (${heartBar(id)})`,
          action: () => {
            if (state.inventory[slot]?.id !== item) return;
            removeAt(slot, 1);
            const reply = giveGift(id, item);
            sfx('pickup');
            ui.dialogue({ speaker: name, lines: [reply, `(${name}  ${heartBar(id)})`, ...claimRewards(id)] });
          },
        },
        { label: 'Keep it' },
      ],
    });
    return true;
  }

  /** The stove at home: pick a recipe you know and have the ingredients for. */
  private cook(): void {
    const known = RECIPES.filter(r => state.recipes.includes(r.dish));
    const has = (r: (typeof RECIPES)[number]) => r.needs.every(([id, n]) => countItem(id) >= n);
    const label = (r: (typeof RECIPES)[number]) =>
      `${has(r) ? '' : '(missing) '}${ITEMS[r.dish].name}: ${r.needs.map(([id, n]) => `${n > 1 ? `${n} ` : ''}${ITEMS[id].name}`).join(' + ')}`;
    const missing = RECIPES.length - known.length;
    ui.dialogue({
      lines: [`The stove. What shall we cook?${missing ? ` (${missing} more recipe${missing > 1 ? 's' : ''} to learn from friends in town.)` : ''}`],
      choices: [
        ...known.map(r => ({
          label: label(r),
          action: () => {
            if (!has(r)) { sfx('error'); ui.toast(`You need ${r.needs.map(([id, n]) => `${n} ${ITEMS[id].name}`).join(', ')}.`); return; }
            for (const [id, n] of r.needs) removeItem(id, n);
            if (!addItem(r.dish, 1)) {
              for (const [id, n] of r.needs) addItem(id, n);
              ui.toast('Your bag is full!');
              return;
            }
            sfx('harvest');
            ui.toast(`You cooked ${ITEMS[r.dish].name}!`);
          },
        })),
        { label: 'Nothing for now' },
      ],
    });
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
      case 'shop': {
        chatted('bram');
        if (this.side.shopCounter()) break;
        const greeting = this.story.shopGreeting()
          ?? [state.met.includes('bram') ? 'Back again, {name}? Have a look.' : "Welcome to Bram's, {name}! Seeds, snacks, and the odd trinket. Have a look."];
        ui.dialogue({ speaker: 'Bram', lines: [...greeting, ...claimRewards('bram')], onClose: () => ui.shop() });
        if (!state.met.includes('bram')) state.met.push('bram');
        break;
      }
      case 'stove':
        this.cook();
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

  /** Pets the cat if the player is facing it. Every 10th pet, it dances. */
  private petCat(): boolean {
    const t = this.facingTarget();
    if (!this.cat || t.tx !== this.cat.tx || t.ty !== this.cat.ty) return false;
    const line = this.cat.pet();
    if (line) ui.toast(line);
    else if (this.cat.dancing) ui.toast('OIIA OIIA!');
    return true;
  }

  /** On someone else's farm you can chat with the animals and read signs, but not touch anything. */
  private visitorInteract(): boolean {
    if (this.petCat()) return true;
    const t = this.facingTarget();
    const critter = this.critters.find(c => Phaser.Math.Distance.Between(t.px, t.py, c.x, (c.body as Body).center.y) < 14);
    if (critter) {
      const lines = CRITTER_LINES[critter.kind];
      ui.dialogue({ lines: lines[critter.talks++ % lines.length] });
      return true;
    }
    const it = this.def.interact.find(i => i.x === t.tx && i.y === t.ty);
    if (it?.kind === 'sign') { ui.dialogue({ lines: it.lines ?? [] }); return true; }
    ui.toast(`You're visiting ${runtime.visit!.name}'s farm, so you can look but not touch. Esc to go home.`);
    return true;
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
    else if (item.kind === 'placeable') this.placeSprinkler(slot);
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

  /** The tile in front, plus the tiles either side of it once the tool is upgraded (a row of 3). */
  private toolTiles(upgraded: boolean): Point[] {
    const t = this.facingTarget();
    if (!upgraded) return [{ x: t.tx, y: t.ty }];
    const d = DIR[this.facing];
    return [-1, 0, 1].map(i => ({ x: t.tx + i * d.y, y: t.ty + i * d.x }));
  }

  private useHoe(): void {
    const t = this.facingTarget();
    this.toolAnim('hoe', t.px, t.py);
    if (!this.def.farmable) { ui.toast('The ground here is too hard. Till on your farm.'); return; }
    let any = false;
    for (const p of this.toolTiles(state.upgrades.hoe > 0)) {
      const tile = this.layer.getTileAt(p.x, p.y);
      const key = soilKey(p.x, p.y);
      if (!tile || (tile.index !== T.GRASS && tile.index !== T.FLOWER) || state.soil[key] || this.hasSprinkler(p.x, p.y)) continue;
      if (!this.spend(2)) break;
      any = true;
      // On a rainy day freshly tilled soil is already wet.
      const wet = state.weather === 'rain';
      state.soil[key] = { watered: wet };
      this.layer.putTileAt(wet ? T.SOIL_WET : T.SOIL, p.x, p.y);
      this.burst((p.x + 0.5) * TILE, (p.y + 0.5) * TILE, 0x7a5232, 6);
    }
    if (any) sfx('hoe');
  }

  private useCan(): void {
    const t = this.facingTarget();
    this.toolAnim('can', t.px, t.py);
    if (!this.def.farmable) return;
    let any = false;
    for (const p of this.toolTiles(state.upgrades.can > 0)) {
      const soil = state.soil[soilKey(p.x, p.y)];
      if (!soil || soil.watered) continue;
      if (!this.spend(1)) break;
      any = true;
      soil.watered = true;
      this.layer.putTileAt(T.SOIL_WET, p.x, p.y);
      this.burst((p.x + 0.5) * TILE, (p.y + 0.5) * TILE, 0x7fb4f2, 8);
    }
    if (any) sfx('water');
  }

  private plant(slot: number): void {
    const t = this.facingTarget();
    const soil = this.def.farmable ? state.soil[soilKey(t.tx, t.ty)] : undefined;
    if (!soil) { ui.toast('Seeds need tilled soil. Use the Hoe on your farm first.'); return; }
    if (soil.crop) return;
    const crop = ITEMS[state.inventory[slot]!.id].crop!;
    if (!inSeason(crop)) {
      sfx('error');
      const when = CROPS[crop].seasons.map(i => SEASON_NAMES[i]).join(' and ');
      ui.toast(`${ITEMS[crop].name} only grows in ${when}. It's ${SEASON_NAMES[seasonOf(state.day)]}.`);
      return;
    }
    soil.crop = { id: crop, days: 0 };
    removeAt(slot, 1);
    sfx('plant');
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
    sfx('harvest');
    this.refreshCrop(x, y);
    this.popIcon(produce, (x + 0.5) * TILE, (y + 0.5) * TILE);
    ui.toast(`+1 ${ITEMS[produce].name}`);
  }

  private offerEat(slot: number): void {
    const item = ITEMS[state.inventory[slot]!.id];
    const BUFF_NAME = { speed: 'Fast', strength: 'Strong' } as const;
    const gains = [
      item.energy ? `+${item.energy} energy` : '', item.heal ? `+${item.heal} heart${item.heal > 1 ? 's' : ''}` : '',
      item.buff ? `${BUFF_NAME[item.buff]} until bedtime` : '',
    ].filter(Boolean).join(', ');
    ui.dialogue({
      lines: [`Eat the ${item.name}? (${gains})`],
      choices: [
        {
          label: 'Eat',
          action: () => {
            if (state.inventory[slot]?.id !== item.id) return;
            state.energy = Math.min(state.maxEnergy, state.energy + (item.energy ?? 0));
            state.hp = Math.min(state.maxHp, state.hp + (item.heal ?? 0));
            if (item.buff) state.buffs[item.buff] = true;
            removeAt(slot, 1);
            sfx('pickup');
            ui.toast(`Yum! ${gains}`);
          },
        },
        { label: 'No' },
      ],
    });
  }

  private openMenu(): void {
    if (runtime.visit) {
      ui.dialogue({
        speaker: 'Visiting',
        lines: [`You're visiting ${runtime.visit.name}'s farm (${formatCode(runtime.visit.code)}).`],
        choices: [{ label: 'Go home', action: () => this.goHome() }, { label: 'Keep looking around' }],
      });
      return;
    }
    ui.dialogue({
      speaker: 'Menu',
      lines: [`{name}  -  ${dateLabel(state.day)}, Year ${yearOf(state.day)} (day ${state.day}), ${formatTime(state.minutes)}.  Gold: ${state.gold}g.  Slimes defeated: ${state.slimes}.` +
        [goalText(), ...sideGoals()].filter(Boolean).map(g => `\nGoal: ${g}`).join('')],
      choices: [
        { label: 'Resume' },
        { label: 'Wait 1 hour', action: () => this.skipTime(60, false) },
        ...(cloudEnabled ? [{ label: 'Online: farm code, leaderboards, visits, gifts', action: () => void this.openOnline() }] : []),
        { label: 'Friends', action: () => ui.dialogue({ speaker: 'Friends', lines: [friendsSummary().join('\n') + '\nTalk every day, and press Use while holding an item to give a gift.'] }) },
        { label: 'Controls', action: () => ui.dialogue({ speaker: 'Controls', lines: CONTROLS }) },
        { label: isMuted() ? 'Sound: off (turn on)' : 'Sound: on (turn off)', action: () => this.toggleSound() },
        {
          label: 'Quit to title (progress since you last slept is lost)',
          action: () => { this.scene.stop('UI'); this.scene.start('Title'); },
        },
      ],
    });
  }

  // ------------------------------------------------------------------ online

  private async openOnline(): Promise<void> {
    if (!currentUser()) {
      ui.dialogue({ speaker: 'Online', lines: ['Sign in on the title screen (Quit to title, then Sign in) to share your farm, see leaderboards and send gifts.'] });
      return;
    }
    ui.toast('Connecting...');
    const p = await getProfile();
    if (!p.ok) { ui.dialogue({ speaker: 'Online', lines: [p.error] }); return; }
    // Visitors see the farm from the cloud. If this account has nothing there yet (it uploads when you sleep),
    // put the last saved farm up now. Only when the cloud is empty, so a newer save from another device is never replaced.
    const local = loadSave();
    if (local && (await downloadSave()) === null) await uploadSave(local);
    const { code, onBoards } = p.data;
    ui.dialogue({
      speaker: 'Online',
      lines: [
        `Your farm code: ${formatCode(code)}\nShare it so friends can visit your farm and send you gifts.\n` +
        `Leaderboards: ${onBoards ? 'you are listed (as ' + (state.playerName || 'Farmer') + ').' : 'you are not listed.'} They update when you sleep.`,
      ],
      choices: [
        { label: 'Leaderboards', action: () => void this.showBoards() },
        { label: 'Visit a farm', action: () => void this.visitFarm() },
        { label: "Send a gift (the item you're holding)", action: () => void this.giftToFarm() },
        { label: 'Check the mailbox', action: () => void this.checkMail(true).then(lines => ui.dialogue({ speaker: 'Mailbox', lines })) },
        {
          label: onBoards ? 'Take me off the leaderboards' : 'List me on the leaderboards',
          action: () => void setOnBoards(!onBoards).then(r => ui.toast(r.ok ? (r.data.onBoards ? "You're on the leaderboards." : "You're off the leaderboards.") : r.error)),
        },
        { label: 'Back' },
      ],
    });
  }

  private async showBoards(): Promise<void> {
    ui.toast('Loading leaderboards...');
    const pages: string[] = [];
    for (const board of ['shipped', 'slimes', 'moon'] as BoardId[]) {
      const r = await fetchBoard(board);
      if (!r.ok) { ui.dialogue({ speaker: 'Leaderboards', lines: [r.error] }); return; }
      const rows = r.data.rows.map((row, i) => `${String(i + 1).padStart(2)}. ${row.name.padEnd(16)} ${row.value}`);
      pages.push(`${r.data.title}\n${rows.length ? rows.join('\n') : '(Nobody yet. Be the first!)'}`);
    }
    ui.dialogue({ speaker: 'Leaderboards', lines: pages });
  }

  private async visitFarm(): Promise<void> {
    const code = await askText(this.input.keyboard, {
      label: "Visit a friend's farm", hint: 'Type their farm code, like ABCD-EFGH.', ok: 'Visit', maxLength: 9, clean: cleanCode,
    });
    if (!code) return;
    ui.toast('Walking over...');
    const r = await fetchFarm(code);
    if (!r.ok) { ui.dialogue({ speaker: 'Online', lines: [r.error] }); return; }
    if (!startVisit(r.data.farm, code)) { ui.dialogue({ speaker: 'Online', lines: ["That farm couldn't be loaded."] }); return; }
    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ map: 'farm', spawn: { x: 6, y: 7 }, facing: 'down', wake: `Welcome to ${runtime.visit!.name}'s farm! Look around as much as you like. Press Esc to go home.` });
    });
  }

  /** Sends the farm for visitors when it has changed since the last send (signed-in players only). */
  private async pushFarmIfChanged(): Promise<void> {
    if (pushing || runtime.visit || !currentUser()) return;
    const view = farmView();
    const sig = JSON.stringify(view);
    if (sig === lastPushed) return;
    pushing = true;
    try {
      if ((await pushFarm(view)).ok) lastPushed = sig;
    } finally {
      pushing = false;
    }
  }

  /** While visiting: fetch the owner's farm again and redraw anything that changed, without leaving. */
  private visitStamp = '';
  private async refreshVisit(): Promise<void> {
    const visit = runtime.visit;
    if (!visit) return;
    const r = await fetchFarm(visit.code);
    if (!r.ok || runtime.visit !== visit || r.data.updatedAt === this.visitStamp) return;
    this.visitStamp = r.data.updatedAt;
    const v = fromSaveData({ ...r.data.farm, version: 1 });
    if (!v) return;
    const before = Object.keys(state.soil);
    Object.assign(state, { soil: v.soil, sprinklers: v.sprinklers, day: v.day, weather: v.weather });
    // Soil that went away goes back to the map's own tile; everything else is redrawn from the new data.
    for (const key of before) {
      if (state.soil[key]) continue;
      const [x, y] = key.split(',').map(Number);
      this.layer.putTileAt(this.def.tiles[y][x], x, y);
      this.refreshCrop(x, y);
    }
    for (const [key, soil] of Object.entries(state.soil)) {
      const [x, y] = key.split(',').map(Number);
      this.layer.putTileAt(soil.watered ? T.SOIL_WET : T.SOIL, x, y);
      this.refreshCrop(x, y);
    }
    for (const img of this.sprinklerSprites.values()) img.destroy();
    this.sprinklerSprites.clear();
    for (const key of state.sprinklers) this.addSprinklerSprite(key);
  }

  private goHome(): void {
    endVisit();
    this.transitioning = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ map: 'farm', spawn: { x: 6, y: 7 }, facing: 'down' });
    });
  }

  private async giftToFarm(): Promise<void> {
    const slot = state.selected;
    const stack = state.inventory[slot];
    if (!stack || !canGift(stack.id) || stack.id === 'suit') {
      ui.dialogue({ speaker: 'Online', lines: ['Hold the item you want to send (crops, food, seeds, gel, cores...) and try again.'] });
      return;
    }
    const item = stack.id;
    const code = await askText(this.input.keyboard, {
      label: `Send ${ITEMS[item].name} to...`, hint: "Their farm code, like ABCD-EFGH. It arrives in their mailbox the next morning.",
      ok: 'Next', maxLength: 9, clean: cleanCode,
    });
    if (!code) return;
    const have = countItem(item);
    const amounts = [...new Set([1, 5, Math.min(10, have)])].filter(n => n <= have);
    ui.dialogue({
      speaker: 'Online',
      lines: [`How many ${plural(ITEMS[item].name)} to send to ${formatCode(code)}? (You have ${have}.)`],
      choices: [
        ...amounts.map(n => ({
          label: `Send ${n}`,
          action: () => void (async () => {
            if (countItem(item) < n) return;
            const r = await sendGift(code, item, n);
            if (!r.ok) { sfx('error'); ui.dialogue({ speaker: 'Online', lines: [r.error] }); return; }
            removeItem(item, n);
            // Save straight away, so the items can't be sent and then kept by quitting.
            save();
            sfx('coin');
            ui.toast(`Sent ${countOf(item, n)} to ${formatCode(code)}!`);
          })(),
        })),
        { label: 'Cancel' },
      ],
    });
  }

  /** Collects gifts from other players into the bag. Returns lines describing what arrived. */
  private async checkMail(always = false): Promise<string[]> {
    if (!currentUser() || runtime.visit) return [];
    const r = await fetchGifts();
    if (!r.ok) return always ? [r.error] : [];
    const lines: string[] = [];
    let full = false;
    for (const g of r.data.gifts) {
      const id = g.item as ItemId;
      if (!ITEMS[id]) continue;
      if (!addItem(id, g.qty)) { full = true; break; }
      const claimed = await claimGift(g.id);
      if (!claimed.ok) { removeItem(id, g.qty); continue; }
      lines.push(`From ${g.from}: ${countOf(id, g.qty)}${g.note ? ` - "${g.note}"` : ''}`);
    }
    if (lines.length) save();
    const out = lines.length ? [`You've got mail!\n${lines.join('\n')}`] : always ? ['Your mailbox is empty.'] : [];
    if (full) out.push("Your bag is full. The rest will wait in your mailbox until you make room.");
    return out;
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
    sfx('swing');

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
      if (s.damage(k.x, k.y, now, 1 + state.upgrades.sword + (state.buffs.strength ? 1 : 0))) this.killSlime(s);
      else sfx('slimeHit');
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
    sfx('slimeDie');
    this.burst(s.x, s.y + 2, 0x6ad06a, 12);
    if (Math.random() < 0.8) {
      // Drop it in the middle of a walkable tile, so you can step onto it.
      const tx = Math.floor(s.x / TILE), ty = Math.floor((s.y + 4) / TILE);
      const spot = [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: tx + dx, y: ty + dy })).find(p => this.canEnter(p.x, p.y));
      if (spot) this.addPickup((spot.x + 0.5) * TILE, (spot.y + 0.5) * TILE - 2, 'gel');
    }
    // Deep Woods slimes also drop a Slime Core: blue ones sometimes, red ones usually.
    if (s.tier > 1 && Math.random() < (s.tier === 3 ? 0.75 : 0.4)) {
      const tx = Math.floor(s.x / TILE), ty = Math.floor((s.y + 4) / TILE);
      const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]].map(([dx, dy]) => ({ x: tx + dx, y: ty + dy })).find(p => this.canEnter(p.x, p.y));
      if (spot) this.addPickup((spot.x + 0.5) * TILE, (spot.y + 0.5) * TILE - 2, 'core');
    }
    this.removeSlime(s);
    if (state.slimes % 10 === 0) ui.toast(`${state.slimes} slimes defeated! Mayor Orla will be pleased.`);
  }

  hurtPlayer(s: Slime | Boss): void {
    const now = this.time.now;
    if (modal.open || this.transitioning || now < this.invulnUntil) return;
    if (s instanceof Slime && (s.dead || (wearingSuit() && !s.angry))) return;
    state.hp -= s instanceof Slime ? s.power : 1;
    sfx('hurt');
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
    sfx('pickup');
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
