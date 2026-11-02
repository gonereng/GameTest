import Phaser from 'phaser';
import { TILE } from './config';
import { BURROW, BED_SPAWN, type NpcDef } from './maps';
import { T } from './tiles';
import { countItem, removeItem, restoreBackup, saveBackup, soilKey, state, isMature } from './state';
import { ui, type Choice, type DialogueOpts } from './bus';
import { Boss, type BossHost } from './boss';
import type { Slime } from './slime';
import type { WorldScene } from './scenes/WorldScene';

/**
 * "The Moon Is in My Turnip": the story quest. See docs/STORY.md for the design.
 * Everything story-specific lives here; WorldScene calls in through a handful of hooks.
 */

export const Q = {
  NONE: 0, FALLEN: 1, ASK: 2, RING: 3, BURROW: 4, ARCHIVE: 5, CONFRONT: 6, BUILD: 7, MIDNIGHT: 8, DONE: 9,
} as const;

/** Top-left tile of Gerald's 2x2 crater on the farm. */
export const CRATER = { x: 26, y: 19 };
const FAKE_BUSH = { x: 33, y: 21 };
const RING_HOLE = { x: 33, y: 20 };
const GEL_NEEDED = 10;
const BOSS_HOUR = 22 * 60;
const MIDNIGHT = 24 * 60;
const TRIO: [string, number][] = [['Ollie', 0xf0a0c0], ['Rudy', 0xa0c8f0], ['Lars', 0xf0d890]];

export const quest = () => state.quest;
export const flag = (f: string) => !!state.quest.flags[f];
const setFlag = (f: string, v = true) => { state.quest.flags[f] = v; };

/** True while the moon is missing from the sky. */
export const moonMissing = () => flag('crashed') && !flag('launched');
export const wearingSuit = () => state.inventory[state.selected]?.id === 'suit';
export const deadlineDay = () => state.quest.crashDay + 3;
/** The story only counts down once the player has talked to Gerald and agreed to help (step ASK onwards). */
export const questAccepted = () => state.quest.step >= Q.ASK && state.quest.step < Q.DONE;

function isCrater(x: number, y: number) {
  return x >= CRATER.x && x <= CRATER.x + 1 && y >= CRATER.y && y <= CRATER.y + 1;
}

/** Soil right next to the crater bathes in moonlight. */
export function inMoonPatch(x: number, y: number) {
  return x >= CRATER.x - 1 && x <= CRATER.x + 2 && y >= CRATER.y - 1 && y <= CRATER.y + 2 && !isCrater(x, y);
}

function gelNeeded() {
  return flag('pardoned') ? GEL_NEEDED - 5 : GEL_NEEDED;
}

function partsStatus() {
  const gel = countItem('gel'), need = gelNeeded();
  return {
    gel, need,
    gelOk: gel >= need,
    spoonOk: flag('spoon'),
    melonOk: countItem('moonmelon') > 0,
  };
}

/** The current objective, shown in the HUD and the menu. */
export function goalText(): string | null {
  const q = state.quest;
  switch (q.step) {
    case Q.FALLEN: return flag('metGerald')
      ? 'Gerald is waiting in his crater, in case you change your mind.'
      : 'Something fell on your farm. Go and look!';
    case Q.ASK: return 'Ask around town about the Moonstring.';
    case Q.RING: return 'Find the circle of bushes past the bridge in Mossy Woods.';
    case Q.BURROW: return flag('doorSeen')
      ? "Get past the jelly door. Only slimes may pass... Bram sells everything."
      : 'Explore the hole in the bush circle.';
    case Q.ARCHIVE: return flag('riddles') ? 'Take what lies on the pedestal.' : 'Get past the Slime Librarian.';
    case Q.CONFRONT: return 'Somebody chewed through the string. Ask Mayor Orla.';
    case Q.BUILD: {
      const p = partsStatus();
      return `Build the Turnipult by Gerald:\n${p.gelOk ? '[x]' : '[ ]'} Slime Gel ${Math.min(p.gel, p.need)}/${p.need}\n` +
        `${p.spoonOk ? '[x]' : '[ ]'} Bram's big spoon\n${p.melonOk ? '[x]' : '[ ]'} 1 Moonmelon (grows fast near Gerald)`;
    }
    case Q.MIDNIGHT:
      if (!flag('bossDone')) return 'Guard the Turnipult. Something is coming at 10 PM...';
      return 'Launch Gerald at midnight!';
    default: return null;
  }
}

/** A short "days left" note while the clock is ticking. */
export function deadlineText(): string | null {
  if (!questAccepted() || flag('eternal')) return null;
  const left = deadlineDay() - state.day;
  if (left > 0) return `Deadline: midnight, Day ${deadlineDay()} (${left} day${left > 1 ? 's' : ''} left)`;
  return 'Deadline: TONIGHT at midnight!';
}

function whisper(lines: string[]): string[] {
  return flag('eternal') && !flag('launched') ? lines.map(l => `(whispering) ${l.toLowerCase()}`) : lines;
}

function say(speaker: string | undefined, lines: string[], extra: Partial<DialogueOpts> = {}) {
  ui.dialogue({ speaker, lines: whisper(lines), ...extra });
}

/** Extra shop items unlocked by the story. */
export interface StoryShopEntry { key: 'suit' | 'spoon'; name: string; price: number; gel?: number; desc: string }

export function storyShopEntries(): StoryShopEntry[] {
  const out: StoryShopEntry[] = [];
  if (state.quest.step >= Q.BURROW && countItem('suit') === 0) {
    out.push({ key: 'suit', name: 'Slime Suit', price: 50, gel: 5, desc: '50g + 5 Slime Gel. "I don\'t ask questions." Hold it to wear it.' });
  }
  if (state.quest.step >= Q.BUILD && !flag('spoon') && !flag('built')) {
    out.push({ key: 'spoon', name: 'Suspiciously Large Spoon', price: 300, desc: 'Big enough to throw a moon with. Coincidentally.' });
  }
  return out;
}

/** Buys a story item. Returns an error message, or null on success. */
export function buyStoryItem(e: StoryShopEntry): string | null {
  if (state.gold < e.price) return 'Not enough gold.';
  if (e.gel && countItem('gel') < e.gel) return `Bram needs ${e.gel} Slime Gel for that. "Don't ask."`;
  if (e.key === 'suit') {
    if (!state.inventory.some(s => !s)) return 'Your bag is full!';
    removeItem('gel', e.gel ?? 0);
    state.inventory[state.inventory.findIndex(s => !s)] = { id: 'suit', qty: 1 };
  } else setFlag('spoon');
  state.gold -= e.price;
  return null;
}

// ------------------------------------------------------------------ per-scene story controller

export class Story implements BossHost {
  private gerald?: Phaser.GameObjects.Sprite;
  private glow?: Phaser.GameObjects.Image;
  private turnipult?: Phaser.GameObjects.Image;
  private fakeBush?: Phaser.GameObjects.Image;
  private pedestalString?: Phaser.GameObjects.Image;
  private boss?: Boss;
  private minions: Slime[] = [];
  private helpers: Phaser.GameObjects.Sprite[] = [];
  private pet?: Phaser.GameObjects.Sprite;
  private launching = false;

  constructor(private w: WorldScene) {}

  private get scene(): Phaser.Scene { return this.w; }
  private get map() { return this.w.def.id; }

  create(): void {
    const q = state.quest;
    if (this.map === 'farm' && flag('crashed')) this.setupCrater();
    if (this.map === 'forest') this.setupRing();
    if (this.map === 'town' && moonMissing() && !flag('unmasked')) this.addPuddles();
    if (this.map === 'burrow') this.setupBurrow();
    if (flag('pet') && !this.w.def.indoor) {
      this.pet = this.scene.add.sprite(this.w.player.x - 12, this.w.player.y + 4, 'slime', '0').play('slime_idle').setScale(0.7);
    }
    if (this.map === 'farm' && q.step === Q.MIDNIGHT && !flag('bossDone') && state.minutes >= BOSS_HOUR) {
      this.scene.time.delayedCall(600, () => this.spawnBoss());
    }
  }

  // ---------------------------------------------------------------- hooks from WorldScene

  update(now: number, paused: boolean): void {
    if (this.boss?.active) this.boss.think(now, this.w.player, paused || this.launching);
    if (this.pet) {
      const p = this.w.player;
      const tx = p.x - 12, ty = p.y + 4;
      this.pet.x += (tx - this.pet.x) * 0.06;
      this.pet.y += (ty - this.pet.y) * 0.06;
      this.pet.setFlipX(tx < this.pet.x).setDepth(this.pet.y + 6);
    }
  }

  /** Called once per in-game minute, on any map. */
  onMinute(): void {
    const q = state.quest;
    const m = state.minutes;
    if (q.step === Q.NONE && m >= BOSS_HOUR) this.crash(true);
    if (flag('crashed') && m % 60 === 0) this.moonGrowth();
    if (q.step === Q.MIDNIGHT && !flag('bossDone') && m === BOSS_HOUR) {
      if (this.map === 'farm') this.spawnBoss();
      else ui.toast('The ground rumbles... something is heading for your farm!');
    }
    if (q.step === Q.MIDNIGHT && flag('bossDone') && m === MIDNIGHT) ui.toast("It's midnight! The sky is soft. Launch Gerald!");
  }

  onNewDay(): void {
    const q = state.quest;
    if (q.step === Q.NONE && state.day >= 2) {
      // You slept through it, but it still happened.
      this.crash(false);
      q.crashDay = state.day - 1;
    }
    // The countdown (and the endless night if it runs out) only applies once you've agreed to help Gerald.
    if (questAccepted() && state.day === deadlineDay() && !flag('backup')) {
      setFlag('backup');
      saveBackup();
    }
    if (questAccepted() && state.day > deadlineDay() && !flag('eternal')) {
      this.scene.time.delayedCall(700, () => this.failed());
    }
    if (flag('launched') && !flag('epilogue')) {
      setFlag('epilogue');
      this.scene.time.delayedCall(700, () => say('Epilogue', [
        'The moon is back. It has a carrot stuck in it. Nobody in Hollowbrook will ever mention this.',
        "Gerald's crater is now a Moonpatch: watered crops right next to it keep growing during the day.",
        flag('pardoned')
          ? 'Ollie, Rudy and Lars are back in the trench coat at town hall. Everyone knows. Nobody minds.'
          : 'Town hall is empty. There is a sign on the door: "MAYOR WANTED. MUST HAVE LEGS."',
        flag('pet') ? 'A small, happy slime has decided it lives on your farm now. It hums.' : 'Somewhere in the woods, the slimes hum along with the moon.',
        'THE END... of this story. Thistle Farm is still yours, {name}. Keep playing!',
      ]));
    }
  }

  /** fromUse: triggered by Space with an item, rather than E. */
  interactAt(tx: number, ty: number, fromUse = false): boolean {
    if (this.map === 'farm' && flag('crashed') && isCrater(tx, ty)) {
      if (flag('launched')) say(undefined, ['A Gerald-shaped hole. Crops right next to it grow in the moonlight.']);
      else this.talkGerald();
      return true;
    }
    const holdingSword = state.inventory[state.selected]?.id === 'sword';
    if (this.map === 'forest' && !flag('bush') && tx === FAKE_BUSH.x && ty === FAKE_BUSH.y && !(fromUse && holdingSword)) {
      say(undefined, state.quest.step >= Q.RING
        ? ['This bush is... wobbling. And breathing? Maybe give it a whack with your sword.']
        : ['The bush giggles. Bushes do not giggle.']);
      return true;
    }
    if (this.map === 'burrow') {
      if (tx === BURROW.door.x && ty === BURROW.door.y && !flag('door')) { this.jellyDoor(); return true; }
      if (tx === BURROW.pedestal.x && ty === BURROW.pedestal.y) { this.pedestal(); return true; }
    }
    return false;
  }

  /** Returns true if the story took over this conversation. */
  talk(npc: NpcDef, sprite: Phaser.GameObjects.Sprite): boolean {
    const step = state.quest.step;
    switch (npc.id) {
      case 'orla':
        if (step === Q.NONE) return false;
        if (step === Q.CONFRONT) { this.unmask(sprite); return true; }
        if (flag('launched')) {
          say('Mayor Orla', Phaser.Utils.Array.GetRandom([
            ['Everyone knows. Nobody minds. We are very good at mayor.'],
            ["Lovely moon tonight. It has a carrot in it. We're putting it on the town flag."],
            ['Town budget is balanced. Again. You are welcome.'],
          ]));
          return true;
        }
        if (step < Q.CONFRONT) {
          say('Mayor Orla', Phaser.Utils.Array.GetRandom([
            ['Moon? Never heard of her.', 'Have you tried NOT looking for it?'],
            ["Strings? No. No strings here. I'm a completely normal mayor. With legs."],
            ['(Mayor Orla is dripping slightly.)', "It's... humid today."],
            ['Please stop looking at my feet.'],
          ]));
          return true;
        }
        return false;
      case 'pip': return this.talkPip();
      case 'librarian': this.talkLibrarian(sprite); return true;
      case 'ollie': say('Ollie', ["We're helping! We're helping.", 'Stand near Gerald with gel. Lots of gel.']); return true;
      case 'rudy': say('Rudy', ['A budget for the Turnipult has been approved. Retroactively.', 'We already donated 5 Slime Gel. You only need 5 more.']); return true;
      case 'lars': say('Lars', ['I have always wanted to throw the moon.', 'Bram sells a spoon. A big one. Do not ask Bram why.']); return true;
    }
    if (npc.id.startsWith('burrow_')) { this.talkBurrowSlime(npc.id); return true; }
    return false;
  }

  shopGreeting(): string[] | null {
    const step = state.quest.step;
    if (flag('launched') && !flag('bramSun')) {
      setFlag('bramSun');
      const bram = this.w.npcs.find(n => n.def.id === 'bram')?.sprite;
      if (bram) {
        this.scene.time.delayedCall(900, () => {
          bram.setTintFill(0xffe060);
          this.scene.time.delayedCall(450, () => bram.clearTint());
        });
      }
      return ['Nice work with the moon, {name}. Professional courtesy.', 'Same time next eclipse?', "(For a moment Bram's eyes glow like two tiny suns. Then the shop just carries on being a shop.)"];
    }
    if (step >= Q.FALLEN && !flag('bramLadder')) {
      setFlag('bramLadder');
      return ["Moon fell? Happens.", "I've got a ladder. It's not long enough. Nothing is.", 'Have a look around.'];
    }
    if (step === Q.BURROW && flag('doorSeen') && countItem('suit') === 0) {
      return ['A slime costume? Sure. 50 gold and 5 Slime Gel.', "I don't ask questions."];
    }
    return null;
  }

  /** Sword swing: may reveal the bush or hit the boss. */
  onSwing(
    hits: (r: Phaser.Geom.Rectangle) => boolean,
    away: (x: number, y: number) => { x: number; y: number },
    now: number,
  ): void {
    if (this.fakeBush && !flag('bush')) {
      if (hits(new Phaser.Geom.Rectangle(FAKE_BUSH.x * TILE, FAKE_BUSH.y * TILE, TILE, TILE))) this.revealBush();
    }
    if (this.boss?.active && this.boss.visible) {
      const b = this.boss.body as Phaser.Physics.Arcade.Body;
      if (hits(new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height))) {
        const k = away(b.center.x, b.center.y);
        this.boss.damage(k.x, k.y, now);
      }
    }
  }

  // ---------------------------------------------------------------- Act 0: the crash

  private crash(live: boolean): void {
    const q = state.quest;
    setFlag('crashed');
    q.step = Q.FALLEN;
    q.crashDay = state.day;
    for (let y = CRATER.y; y <= CRATER.y + 1; y++)
      for (let x = CRATER.x; x <= CRATER.x + 1; x++) delete state.soil[soilKey(x, y)];
    if (!live) return;
    const cam = this.scene.cameras.main;
    cam.flash(600, 255, 250, 220);
    cam.shake(900, 0.012);
    ui.toast('WHUMP!');
    this.scene.time.delayedCall(1000, () => ui.toast('Something just fell on your farm. The moon is gone from the sky.'));
    if (this.map === 'farm') this.setupCrater();
  }

  private setupCrater(): void {
    for (let y = CRATER.y; y <= CRATER.y + 1; y++)
      for (let x = CRATER.x; x <= CRATER.x + 1; x++) {
        this.w.layer.putTileAt(T.CRATER, x, y);
        this.w.refreshCrop(x, y);
      }
    const cx = (CRATER.x + 1) * TILE, cy = (CRATER.y + 1) * TILE;
    if (flag('built') || flag('launched')) {
      this.turnipult = this.scene.add.image(cx + 4, cy - 2, 'turnipult').setDepth(cy + 14);
    }
    if (flag('launched')) return;
    this.glow = this.scene.add.image(cx, cy - 2, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(1.6).setDepth(cy + 15);
    this.scene.tweens.add({ targets: this.glow, alpha: 0.55, scale: 1.9, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.inOut' });
    this.gerald = this.scene.add.sprite(cx, cy - 6, 'gerald', '0').setDepth(cy + 16).play('gerald_idle');
    this.scene.tweens.add({ targets: this.gerald, y: cy - 8, yoyo: true, repeat: -1, duration: 1100, ease: 'Sine.inOut' });
  }

  /** Watered crops next to the crater grow during the day: every hour while Gerald is here, every 3 hours after. */
  private moonGrowth(): void {
    if (flag('launched') && (state.minutes / 60) % 3 !== 0) return;
    for (const [key, soil] of Object.entries(state.soil)) {
      const [x, y] = key.split(',').map(Number);
      if (!inMoonPatch(x, y) || !soil.crop || !soil.watered || isMature(soil)) continue;
      soil.crop.days++;
      if (this.map === 'farm') {
        this.w.refreshCrop(x, y);
        this.w.burst((x + 0.5) * TILE, (y + 0.5) * TILE, 0xfff4a0, 5);
      }
    }
  }

  // ---------------------------------------------------------------- Gerald

  /** You agreed to help: the story (and its three-day countdown) starts today. */
  private acceptQuest(): void {
    const q = state.quest;
    q.step = Q.ASK;
    // The countdown (and the fastest-rescue leaderboard) runs from today, not from when the moon fell.
    q.crashDay = state.day;
    ui.toast('Quest started: The Moon Is in My Turnip!');
    say('Gerald', [
      'Splendid! Oh, splendid.',
      `Then we have until midnight on Day ${deadlineDay()}. After that, the night will simply... continue.`,
      "I'm told that is bad for crops. Do ask around town. Somebody must have seen something.",
    ]);
  }

  private talkGerald(): void {
    const q = state.quest;
    const G = 'Gerald';
    if (q.step === Q.FALLEN) {
      // Nothing is on the clock until you agree to help. Say no, and Gerald will ask again next time.
      const first = !flag('metGerald');
      setFlag('metGerald');
      say(G, first ? [
        'Ah. Hello. Please don\'t eat me.',
        'I am the Moon. You may call me Gerald. And you are... {name}? Splendid name. Very earthy.',
        'I seem to have fallen into your vegetable. It was the nearest soft thing.',
        'Someone cut my string. The Moonstring. It held me up there for four billion years.',
        "Once I start trying to get back up, I'll have three days before the sky forgets me and the night simply... continues. Forever.",
        'Will you help me get home, {name}?',
      ] : [
        'Oh, hello again. Still in your vegetable, I\'m afraid.',
        'Have you thought any more about helping me get home? Three days, once we start.',
      ], {
        choices: [
          { label: "I'll help you get home", action: () => this.acceptQuest() },
          {
            label: 'Not right now',
            action: () => say(G, ["Oh. Well. That's quite all right. I'll be here.", 'In your vegetable. Do come back if you change your mind.']),
          },
        ],
      });
      return;
    }
    if (q.step < Q.CONFRONT) {
      const hints: Record<number, string> = {
        [Q.ASK]: 'Any luck? That small person in town strikes me as the noticing type.',
        [Q.RING]: 'A circle of bushes, you say? Bushes are never up to anything good.',
        [Q.BURROW]: 'A door made of jelly? Well. Jelly respects jelly.',
        [Q.ARCHIVE]: 'A library! Under the woods! I can see everything from up there, and I never once noticed.',
      };
      say(G, [hints[q.step] ?? 'Hello again.', 'Oh, and do water the soil next to me. Things grow in my light. Rather quickly.']);
      return;
    }
    if (q.step === Q.CONFRONT) {
      say(G, ['My string! Splendid!', 'Though look at the ends. Chewed. Small teeth. Wet teeth.', 'Ask the mayor. Mayors know everything that happens in their town.']);
      return;
    }
    if (q.step === Q.BUILD) { this.turnipultTalk(); return; }
    if (q.step === Q.MIDNIGHT) {
      if (!flag('bossDone')) {
        say(G, ['Midnight is coming. I feel something coming with it.', 'Something big. Something... wobbly. Stay close, farmer.']);
      } else if (state.minutes < MIDNIGHT) {
        say(G, ["Almost. The sky isn't soft yet.", `Midnight, farmer. It's ${Math.floor(state.minutes / 60) % 24 > 12 ? Math.floor(state.minutes / 60) % 24 - 12 : Math.floor(state.minutes / 60) % 24} o'clock now.`]);
      } else {
        say(G, ['The sky is soft. It is time.'], {
          choices: [{ label: 'Launch Gerald!', action: () => this.launch() }, { label: 'Wait a moment' }],
        });
      }
    }
  }

  private turnipultTalk(): void {
    const G = 'Gerald';
    if (!flag('throwSpeech')) {
      setFlag('throwSpeech');
      say(G, [
        "The string alone won't do. I need a running start.",
        'What I need, frankly, is to be THROWN. Very hard. At midnight, when the sky is softest.',
        `Build me a catapult. Something elastic: ${gelNeeded()} Slime Gel should do.`,
        'Something to throw me with. A spoon, perhaps. A very large one.',
        'And a counterweight. A Moonmelon. I know, they take 8 days.',
        'But anything planted right next to me and watered grows every HOUR. Moonlight is wonderful like that.',
      ]);
      return;
    }
    const p = partsStatus();
    if (p.gelOk && p.spoonOk && p.melonOk) {
      say(G, ['Gel, spoon, melon. Oh, this is going to be undignified. I love it.'], {
        choices: [{ label: 'Build the Turnipult', action: () => this.buildTurnipult() }, { label: 'Not yet' }],
      });
      return;
    }
    say(G, [
      'Still missing:' +
        (p.gelOk ? '' : ` ${p.need - p.gel} more Slime Gel.`) +
        (p.spoonOk ? '' : ' A very large spoon (Bram?).') +
        (p.melonOk ? '' : ' A Moonmelon (plant it next to me and water it!).'),
    ]);
  }

  private buildTurnipult(): void {
    removeItem('gel', gelNeeded());
    removeItem('moonmelon', 1);
    setFlag('built');
    state.quest.step = Q.MIDNIGHT;
    const cx = (CRATER.x + 1) * TILE, cy = (CRATER.y + 1) * TILE;
    this.turnipult = this.scene.add.image(cx + 4, cy - 2, 'turnipult').setDepth(cy + 14).setScale(0);
    this.scene.tweens.add({ targets: this.turnipult, scale: 1, duration: 500, ease: 'Back.out' });
    this.w.burst(cx, cy, 0x6ad06a, 20);
    this.scene.cameras.main.shake(200, 0.005);
    say('Gerald', [
      "The Turnipult! It's hideous. It's perfect.",
      'Now we wait for midnight. And farmer... the woods have gone very quiet. Be ready at 10.',
    ]);
  }

  private launch(): void {
    if (!this.gerald) return;
    this.launching = true;
    this.w.lockedUntil = this.scene.time.now + 999999;
    const g = this.gerald;
    this.scene.tweens.killTweensOf(g);
    say('Gerald', ['Thank you, {name}. Do tell the slimes I will hum louder.', 'And if anyone asks: I was never in a turnip.'], {
      onClose: () => {
        const cam = this.scene.cameras.main;
        cam.shake(700, 0.01);
        if (this.turnipult) this.scene.tweens.add({ targets: this.turnipult, angle: -25, duration: 120, yoyo: true });
        const trail = this.scene.add.graphics().setDepth(9999);
        const startY = g.y;
        this.scene.tweens.add({
          targets: g, y: startY - 400, scale: 0.3, angle: 720, duration: 1600, ease: 'Quad.in',
          onUpdate: () => {
            trail.clear();
            trail.lineStyle(2, 0xfff4a0, 0.9);
            trail.lineBetween(g.x, g.y, g.x + Math.sin(g.y / 20) * 6, startY);
          },
          onComplete: () => {
            trail.destroy();
            g.destroy();
            this.glow?.destroy();
            cam.flash(800, 255, 255, 230);
            setFlag('launched');
            state.quest.launchDay = state.day;
            state.quest.step = Q.DONE;
            this.launching = false;
            this.w.lockedUntil = 0;
            ui.toast('Quest complete: The Moon Is in My Turnip!');
            this.scene.time.delayedCall(900, () => say(undefined, [
              'Gerald is back in the sky, Moonstring and all.',
              'Look up tonight. Something about the moon is... different.',
              'Get some sleep, farmer.',
            ]));
          },
        });
      },
    });
  }

  // ---------------------------------------------------------------- town

  private addPuddles(): void {
    const orla = this.w.npcs.find(n => n.def.id === 'orla');
    if (!orla) return;
    for (const [dx, dy] of [[-10, 10], [6, 14], [-4, 22], [14, 4]]) {
      this.scene.add.image(orla.sprite.x + dx, orla.sprite.y + dy, 'puddle').setDepth(1);
    }
  }

  private talkPip(): boolean {
    const step = state.quest.step;
    if (step === Q.NONE) return false;
    const P = 'Pip';
    if (step === Q.FALLEN) { say(P, ['Did you hear that WHUMP last night?!', 'Something fell on YOUR farm! Go look! GO!']); return true; }
    if (!flag('pipLead')) {
      setFlag('pipLead');
      if (state.quest.step === Q.ASK) state.quest.step = Q.RING;
      say(P, [
        'The moon fell?! I KNEW IT.',
        'I SAW slimes carrying a glowing rope into the woods! Past the bridge, where the bushes make a circle!',
        'Nobody believes me. Nobody EVER believes me.',
        "Oh! Bring me 3 Slime Gel. For science. You'll see. Probably.",
      ]);
      return true;
    }
    if (!flag('pipGel') && !flag('bossDone')) {
      if (countItem('gel') >= 3) {
        say(P, ['Is that SLIME GEL? Three of them?'], {
          choices: [
            {
              label: 'Give Pip 3 Slime Gel',
              action: () => {
                removeItem('gel', 3);
                setFlag('pipGel');
                say(P, ["YES. I'm going to make something AMAZING.", "Don't ask what. I'll bring it when you need it. You'll know."]);
              },
            },
            { label: 'Not now' },
          ],
        });
      } else say(P, ['Bring me 3 Slime Gel! For science!', 'Slimes are in the woods. Bonk, bonk, squish.']);
      return true;
    }
    if (flag('launched')) say(P, ['I WAS RIGHT.', 'Somebody write it down. Somebody write it down RIGHT NOW.']);
    else if (step >= Q.BUILD) say(P, ['Those vegetables near the moon are looking at me.']);
    else if (step >= Q.BURROW) say(P, ['Did you find a hole? There was a hole, right? I KNEW there was a hole.']);
    else say(P, ['Past the bridge! Where the bushes make a circle! GO!']);
    return true;
  }

  private unmask(sprite: Phaser.GameObjects.Sprite): void {
    say('Mayor Orla', [
      "That's... a very nice string. Never seen it before.",
      'Why are you looking at me like that.',
      '(The trench coat starts to wobble.)',
    ], {
      onClose: () => {
        this.scene.tweens.add({
          targets: sprite, scaleY: 0.2, scaleX: 1.4, duration: 400, ease: 'Quad.in',
          onComplete: () => {
            sprite.setVisible(false);
            const trio = TRIO.map(([, tint], i) =>
              this.scene.add.sprite(sprite.x + (i - 1) * 14, sprite.y + 2, 'slime', '0').setTint(tint).play('slime_idle').setDepth(sprite.depth));
            setFlag('unmasked');
            say('Ollie', ['Okay. Okay okay okay.'], {
              onClose: () => say('Rudy', ['In our defense, the town budget has been balanced for six years.'], {
                onClose: () => say('Lars', [
                  'We fixed the fountain. We invented Tuesday market. We are GOOD at mayor.',
                  'We only wanted the moon a little closer. We are made of moonlight, and every year there is less of us.',
                ], {
                  choices: [
                    { label: 'You can stay mayor. Help me fix this.', action: () => this.pardon(true, trio) },
                    { label: 'Get out of my town.', action: () => this.pardon(false, trio) },
                  ],
                }),
              }),
            });
          },
        });
      },
    });
  }

  private pardon(yes: boolean, trio: Phaser.GameObjects.Sprite[]): void {
    setFlag(yes ? 'pardoned' : 'banished');
    state.quest.step = Q.BUILD;
    if (yes) {
      say('Ollie, Rudy & Lars', [
        'Really?! Oh, thank you! THANK you!',
        "We'll help. We'll give you 5 Slime Gel for whatever Gerald needs. We have plenty. We ARE plenty.",
        'Go and talk to Gerald. Moons always have a plan.',
      ]);
    } else {
      trio.forEach((t, i) => this.scene.tweens.add({ targets: t, x: t.x - 300, duration: 1600 + i * 200, onComplete: () => t.destroy() }));
      say(undefined, ['The three slimes squeak and bounce off toward the woods.', 'Go and talk to Gerald. Moons always have a plan.']);
    }
  }

  // ---------------------------------------------------------------- forest & burrow

  private setupRing(): void {
    if (flag('bush')) {
      this.w.layer.putTileAt(T.DARK_GRASS, FAKE_BUSH.x, FAKE_BUSH.y);
      this.w.layer.putTileAt(T.HOLE, RING_HOLE.x, RING_HOLE.y);
      return;
    }
    // Replace the tile with a wobbling sprite, but keep it solid.
    const tile = this.w.layer.putTileAt(T.DARK_GRASS, FAKE_BUSH.x, FAKE_BUSH.y);
    tile.setCollision(true, true, true, true);
    const x = (FAKE_BUSH.x + 0.5) * TILE, y = (FAKE_BUSH.y + 0.5) * TILE;
    this.fakeBush = this.scene.add.image(x, y + 8, 'tiles', `t${T.DARK_BUSH}`).setOrigin(0.5, 1).setDepth(y + 8);
    this.scene.tweens.add({ targets: this.fakeBush, scaleY: 1.08, scaleX: 0.95, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.inOut' });
  }

  private revealBush(): void {
    if (state.quest.step < Q.RING) {
      ui.toast('The bush giggles and stays very still.');
      return;
    }
    setFlag('bush');
    state.quest.step = Math.max(state.quest.step, Q.BURROW);
    const b = this.fakeBush!;
    this.fakeBush = undefined;
    this.scene.tweens.killTweensOf(b);
    this.w.layer.putTileAt(T.DARK_GRASS, FAKE_BUSH.x, FAKE_BUSH.y);
    this.w.layer.putTileAt(T.HOLE, RING_HOLE.x, RING_HOLE.y);
    const runner = this.scene.add.sprite(b.x, b.y - 8, 'slime', '0').play('slime_idle').setDepth(b.depth + 1);
    b.setOrigin(0.5, 1);
    this.scene.tweens.add({ targets: b, x: b.x + 220, y: b.y + 60, duration: 1400, ease: 'Quad.in', onComplete: () => b.destroy() });
    this.scene.tweens.add({ targets: runner, x: runner.x + 220, y: runner.y + 60, duration: 1400, ease: 'Quad.in', onComplete: () => runner.destroy() });
    this.w.burst(b.x, b.y - 8, 0x3a8a3a, 14);
    say(undefined, ['EEEEEK!', 'A slime in a bush costume shrieks and runs off.', 'Behind it, in the middle of the bush circle, there is a hole.']);
  }

  private setupBurrow(): void {
    if (flag('door')) this.w.layer.putTileAt(T.JELLY_FLOOR, BURROW.door.x, BURROW.door.y);
    const lib = this.w.npcs.find(n => n.def.id === 'librarian');
    if (lib && flag('riddles')) lib.sprite.setPosition((BURROW.librarianMoved.x + 0.5) * TILE, (BURROW.librarianMoved.y + 0.5) * TILE - 4);
    if (!flag('string')) {
      const x = (BURROW.pedestal.x + 0.5) * TILE, y = BURROW.pedestal.y * TILE + 4;
      this.pedestalString = this.scene.add.image(x, y, 'moonstring').setDepth(y + 20);
      this.scene.tweens.add({ targets: this.pedestalString, y: y - 2, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
      const glow = this.scene.add.image(x, y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(0.6).setDepth(y + 19);
      this.scene.tweens.add({ targets: glow, alpha: 0.4, yoyo: true, repeat: -1, duration: 900 });
      this.pedestalString.setData('glow', glow);
    }
    if (!flag('burrowIntro')) {
      setFlag('burrowIntro');
      this.scene.time.delayedCall(500, () => say(undefined, [
        "A whole slime village, under the woods. There's jelly everywhere. Someone hung up tiny curtains.",
        "None of the slimes attack you. They seem to be on a break.",
      ]));
    }
  }

  private jellyDoor(): void {
    if (!wearingSuit()) {
      setFlag('doorSeen');
      say('Jelly Door', ['ONLY SLIMES MAY PASS.', '(The door jiggles smugly.)']);
      return;
    }
    setFlag('door');
    if (state.quest.step === Q.BURROW) state.quest.step = Q.ARCHIVE;
    this.w.layer.putTileAt(T.JELLY_FLOOR, BURROW.door.x, BURROW.door.y);
    this.w.burst((BURROW.door.x + 0.5) * TILE, (BURROW.door.y + 0.5) * TILE, 0x6ad06a, 16);
    say('Jelly Door', ['Welcome home, fellow slime.', '(The jelly parts with a polite squelch.)']);
  }

  private talkBurrowSlime(id: string): void {
    if (!wearingSuit()) { say('Slime', ['Blorp.', '(It politely ignores non-slimes.)']); return; }
    const lines: Record<string, string[]> = {
      burrow_union: ["We're unionized. Six squish breaks a day.", 'This is break number four.'],
      burrow_hum: ['The Big Round One used to hum us to sleep.', 'Now we only hum ourselves. Hmmmmmm.'],
      burrow_gossip: ["Don't tell anyone, but Mayor Orla is actually—"],
      burrow_shush: ['SHHHHHHHHH.'],
      burrow_hair: ['Nice suit. Very convincing.', '...Is that hair?'],
    };
    say('Slime', lines[id] ?? ['Blorp.']);
  }

  private talkLibrarian(sprite: Phaser.GameObjects.Sprite): void {
    const L = 'Slime Librarian';
    if (flag('string')) { say(L, ['We were wrong. Mostly.', 'Tell the Big Round One we said sorry. And hello. Mostly hello.']); return; }
    if (flag('riddles')) { say(L, ['Go on. The pedestal. Before I change my mind.']); return; }
    if (!wearingSuit()) { say(L, ['(The Librarian squints at you, despite having no eyes.)', 'Members only.']); return; }
    const riddles: { q: string; options: string[]; answer: number }[] = [
      { q: 'What grows only on nights after it has been cried on?', options: ['A sad onion', 'A watered crop', 'Mayor Orla', 'The moon'], answer: 1 },
      { q: 'How many people live in Hollowbrook?', options: ['23', 'Nobody knows', '23 and a few slimes', 'Seven'], answer: 2 },
      { q: 'How big was the mushroom?', options: ['Normal size', 'Small', 'THIS big', 'There was no mushroom'], answer: 2 },
    ];
    const ask = (i: number) => {
      if (i >= riddles.length) {
        setFlag('riddles');
        say(L, ['Correct. All three. Hmph.', 'You may approach the archive.'], {
          onClose: () => {
            this.scene.tweens.add({
              targets: sprite, x: (BURROW.librarianMoved.x + 0.5) * TILE, y: (BURROW.librarianMoved.y + 0.5) * TILE - 4, duration: 600,
            });
          },
        });
        return;
      }
      const r = riddles[i];
      const choices: Choice[] = r.options.map((label, j) => ({
        label,
        action: j === r.answer
          ? () => ask(i + 1)
          : () => say(L, ['(The Librarian sighs a long, wet sigh.)', 'Wrong. From the top.']),
      }));
      say(L, [`Question ${i + 1} of 3.`, r.q], { choices });
    };
    say(L, ['To enter the archive, answer three questions.', 'Everything you need, you have already heard.'], { onClose: () => ask(0) });
  }

  private pedestal(): void {
    if (flag('string')) { say(undefined, ['An empty pedestal. A tiny sign says "PLEASE DO NOT TOUCH THE MOON STRING". Oops.']); return; }
    if (!flag('riddles')) { say(undefined, ["You can't reach it from here."]); return; }
    setFlag('string');
    state.quest.step = Q.CONFRONT;
    const s = this.pedestalString;
    if (s) {
      (s.getData('glow') as Phaser.GameObjects.Image | undefined)?.destroy();
      this.scene.tweens.killTweensOf(s);
      this.scene.tweens.add({ targets: s, y: s.y - 16, alpha: 0, duration: 600, onComplete: () => s.destroy() });
    }
    ui.toast('Got the Moonstring!');
    say('Slime Librarian', [
      "We didn't mean for it to FALL.",
      "We're made of moonlight. Every year there's less of us.",
      'We only wanted it a little closer. Like sitting near a fire.',
      'Our leader said it was a good plan. Our leader is very busy.',
      'Our leader is the mayor.',
    ]);
  }

  // ---------------------------------------------------------------- Act 4: the boss

  private spawnBoss(): void {
    if (this.boss || flag('bossDone')) return;
    const x = 20 * TILE, y = 28 * TILE;
    this.boss = new Boss(this.scene, x, y, this);
    const aura = this.scene.add.image(x, y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xd0a0ff).setScale(2.2).setAlpha(0.7);
    const follow = () => {
      const b = this.boss;
      if (!b?.active) { aura.destroy(); this.scene.events.off(Phaser.Scenes.Events.UPDATE, follow); return; }
      aura.setPosition(b.x, b.y).setVisible(b.visible).setDepth(b.depth - 1);
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, follow);
    this.scene.physics.add.collider(this.boss, this.w.layer);
    this.scene.physics.add.overlap(this.w.player, this.boss, () => {
      if (this.boss?.dangerous) this.w.hurtPlayer(this.boss);
    });
    this.scene.cameras.main.shake(800, 0.008);
    say('Lord Gloopington III', [
      'THE BIG ROUND ONE STAYS.',
      'THE BIG ROUND ONE IS *OURS*.',
    ], { onClose: () => ui.toast('Dodge his lunges and hit him from the side!') });
  }

  onSplit(boss: Boss): void {
    this.w.burst(boss.x, boss.y, 0xc08af0, 24);
    const helping = flag('pardoned');
    [[-24, -12], [24, -12], [-24, 16], [24, 16]].forEach(([dx, dy], i) => {
      const s = this.w.addSlime(boss.x + dx, boss.y + dy, 'gloop');
      s.setScale(1.5);
      s.hp = 3;
      s.angry = true;
      if (helping && i < 3) {
        s.held = true;
        const [, tint] = TRIO[i];
        this.helpers.push(this.scene.add.sprite(s.x + 10, s.y + 2, 'slime', '0').setTint(tint).play('slime_idle').setDepth(s.y + 10));
      }
      this.minions.push(s);
    });
    say(undefined, helping
      ? ['Lord Gloopington splits into four pieces!', 'Ollie, Rudy and Lars come bouncing in and each grab one. "GO! HIT THEM!"']
      : ['Lord Gloopington splits into four pieces! Defeat them before they merge back together!']);
  }

  minionsAlive(): number {
    return this.minions.filter(m => m.active && !m.dead).length;
  }

  onRejoin(boss: Boss): void {
    for (const m of this.minions) {
      if (m.active && !m.dead) {
        this.w.burst(m.x, m.y, 0xc08af0, 6);
        this.w.removeSlime(m);
      }
    }
    this.minions = [];
    this.helpers.forEach(h => h.destroy());
    this.helpers = [];
    ui.toast(`Lord Gloopington pulls himself back together! (${boss.hp} HP left)`);
  }

  onCry(boss: Boss): void {
    // His tears water the whole farm, and everything grows a little.
    for (const [key, soil] of Object.entries(state.soil)) {
      soil.watered = true;
      if (soil.crop && !isMature(soil)) soil.crop.days++;
      const [x, y] = key.split(',').map(Number);
      this.w.layer.putTileAt(T.SOIL_WET, x, y);
      this.w.refreshCrop(x, y);
    }
    const tears = this.scene.time.addEvent({
      delay: 120, loop: true, callback: () => {
        if (!boss.active || boss.mode === 'dead') { tears.remove(); return; }
        const t = this.scene.add.image(boss.x + Phaser.Math.Between(-10, 10), boss.y - 6, 'spark').setTint(0x7fb4f2).setDepth(boss.depth + 1);
        this.scene.tweens.add({ targets: t, y: t.y + 20, x: t.x + Phaser.Math.Between(-12, 12), alpha: 0, duration: 600, onComplete: () => t.destroy() });
      },
    });
    const lines = ['Lord Gloopington stops. His lip wobbles. (He does not have a lip. It wobbles anyway.)', 'He is crying. Real tears. They water every crop on your farm.'];
    if (!flag('pipGel')) {
      say(undefined, [...lines, 'He is not fighting back anymore...'], { onClose: () => ui.toast('Finish it... gently.') });
      return;
    }
    say(undefined, lines, {
      onClose: () => {
        const p = this.w.player;
        const pip = this.scene.add.sprite(p.x + 140, p.y, 'pip', 'side_0').setFlipX(true).play('pip_side').setDepth(p.depth);
        this.scene.tweens.add({
          targets: pip, x: p.x + 22, duration: 900,
          onComplete: () => {
            pip.anims.stop();
            pip.setFrame('side_0');
            say('Pip', [
              'WAIT! I made it! From the Slime Gel!',
              "It's a KAZOO. A slime kazoo. Gerald used to hum them to sleep, right? So HUM!",
            ], {
              choices: [
                { label: 'Play the lullaby on the kazoo', action: () => this.lullaby(boss, pip) },
                { label: 'Keep fighting', action: () => { pip.destroy(); ui.toast('Finish it.'); } },
              ],
            });
          },
        });
      },
    });
  }

  private lullaby(boss: Boss, pip: Phaser.GameObjects.Sprite): void {
    const notes = this.scene.time.addEvent({
      delay: 250, repeat: 12, callback: () => {
        const n = this.scene.add.text(this.w.player.x + Phaser.Math.Between(-6, 6), this.w.player.y - 10, '~', {
          fontFamily: 'monospace', fontSize: '10px', color: '#fff4a0',
        }).setResolution(3).setDepth(10000);
        this.scene.tweens.add({ targets: n, y: n.y - 20, x: n.x + 10, alpha: 0, duration: 900, onComplete: () => n.destroy() });
      },
    });
    boss.fallAsleep();
    this.scene.time.delayedCall(2000, () => {
      notes.remove();
      setFlag('pet');
      this.bossDone(boss);
      this.pet = this.scene.add.sprite(boss.x, boss.y, 'slime', '0').play('slime_idle').setScale(0.7);
      boss.destroy();
      say(undefined, [
        'Bzzzzz bzz bzzzz. (It is a very bad lullaby. It works anyway.)',
        'Lord Gloopington III yawns, shrinks, and shrinks, and shrinks...',
        '...into one small, happy slime. It hums back. It seems to have adopted you.',
      ], { onClose: () => { pip.destroy(); this.afterBoss(); } });
    });
  }

  onDefeated(boss: Boss): void {
    for (let i = 0; i < 40; i++) {
      const p = this.scene.add.image(boss.x + Phaser.Math.Between(-20, 20), boss.y + Phaser.Math.Between(-10, 10), 'spark')
        .setTint(Phaser.Utils.Array.GetRandom([0xc08af0, 0x6ad06a, 0xfff4a0])).setDepth(10000);
      this.scene.tweens.add({ targets: p, y: p.y - 200 - Math.random() * 100, alpha: 0, duration: 1400 + Math.random() * 800, onComplete: () => p.destroy() });
    }
    this.scene.cameras.main.shake(500, 0.01);
    this.bossDone(boss);
    boss.destroy();
    say(undefined, ['Lord Gloopington III bursts into a shower of glowing gel...', '...that rains UP, into the empty sky.'], { onClose: () => this.afterBoss() });
  }

  private bossDone(_boss: Boss): void {
    setFlag('bossDone');
    this.boss = undefined;
  }

  private afterBoss(): void {
    say('Gerald', [
      'You did it! Oh, well done.',
      state.minutes >= MIDNIGHT ? 'And the sky is soft. Come, farmer. Throw me.' : 'Now we wait for midnight. Then, farmer, you throw me.',
    ]);
  }

  // ---------------------------------------------------------------- failure

  private failed(): void {
    say(undefined, [
      'The night goes on. And on.',
      'Somewhere, a slime hums alone.',
    ], {
      choices: [
        {
          label: `Try again from the morning of Day ${deadlineDay()}`,
          action: () => {
            if (restoreBackup()) {
              this.w.scene.restart({ map: 'house', spawn: BED_SPAWN, facing: 'down', newDay: true });
            } else ui.toast('No backup save found.');
          },
        },
        {
          label: 'Keep playing in the eternal night',
          action: () => {
            setFlag('eternal');
            say(undefined, ["Fine. It's always night now. Everyone whispers. Gerald can still be launched, if you're up for it."]);
          },
        },
      ],
    });
  }
}
