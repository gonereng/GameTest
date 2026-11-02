import Phaser from 'phaser';
import { CROPS, ITEMS, plural, type ItemId } from '../items';
import {
  BACKPACK_SIZE, addItem, countItem, dateLabel, formatTime, inSeason, itemName, removeItem, runtime, seasonOf, state, type ToolId,
} from '../state';
import { shopDiscount } from '../friends';
import { sfx } from '../audio';
import { bus, modal, type DialogueOpts } from '../bus';
import { TouchControls, isTouchDevice, touch } from '../touch';
import { buyStoryItem, deadlineText, flag, goalText, moonMissing, storyShopEntries, type StoryShopEntry } from '../quest';

const FONT = 'monospace';
const PANEL = 0x2a1b10;
const BORDER = 0xe8c88a;
const SLOT = 56;
const SLOT_GAP = 4;
const MAX_HEARTS = 10;
/** Row height in the shop list. */
const ROW = 44;

interface ShopEntry {
  id?: ItemId; special?: 'heart' | 'backpack' | 'upgrade'; tool?: ToolId; story?: StoryShopEntry;
  name: string; price: number; desc: string;
  /** Other things Bram wants for it, such as Slime Gel and Slime Cores. */
  needs?: [ItemId, number][];
}

const UPGRADES: ShopEntry[] = [
  { special: 'upgrade', tool: 'hoe', name: 'Copper Hoe', price: 500, needs: [['gel', 5], ['core', 2]], desc: 'Upgrades your hoe: tills a row of 3 tiles at once.' },
  { special: 'upgrade', tool: 'can', name: 'Copper Can', price: 500, needs: [['gel', 5], ['core', 2]], desc: 'Upgrades your can: waters a row of 3 tiles at once.' },
  { special: 'upgrade', tool: 'sword', name: 'Steel Sword', price: 800, needs: [['gel', 8], ['core', 4]], desc: 'Upgrades your sword: hits twice as hard.' },
];

/** What Bram has today: in-season seeds, supplies, and upgrades you don't have yet. */
function baseShop(): ShopEntry[] {
  const seeds = (Object.values(CROPS).filter(c => inSeason(c.id)).map(c => c.seed));
  return [
    ...([...seeds, 'bread', 'sprinkler'] as ItemId[]).map(id => ({
      id, name: ITEMS[id].name, price: ITEMS[id].price!, desc: ITEMS[id].desc,
      needs: ITEMS[id].gel ? [['gel', ITEMS[id].gel!] as [ItemId, number]] : undefined,
    })),
    ...(state.maxHp < MAX_HEARTS ? [{ special: 'heart' as const, name: 'Heart Charm', price: 300, desc: 'Permanently adds one heart. Handy in the woods.' }] : []),
    ...(state.inventory.length < BACKPACK_SIZE ? [{ special: 'backpack' as const, name: 'Backpack', price: 600, desc: 'Two more hotbar slots (keys - and =). One per farmer.' }] : []),
    ...UPGRADES.filter(u => !state.upgrades[u.tool!]),
  ];
}

const NEED_NAME: Partial<Record<ItemId, string>> = { gel: 'gel', core: 'cores' };
const needsText = (needs?: [ItemId, number][]) => (needs ?? []).map(([id, n]) => ` +${n} ${NEED_NAME[id] ?? ITEMS[id].name}`).join('');

const textStyle = (size: number, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT, fontSize: `${size}px`, color, stroke: '#1a0f08', strokeThickness: Math.max(3, size / 5),
});

function panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, alpha = 0.88) {
  g.fillStyle(PANEL, alpha).fillRoundedRect(x, y, w, h, 10);
  g.lineStyle(3, BORDER, 1).strokeRoundedRect(x, y, w, h, 10);
}


/** How dark the night overlay is at a given time. */
function nightAlpha(min: number): number {
  if (min < 17 * 60) return 0;
  if (min < 21 * 60) return ((min - 17 * 60) / (4 * 60)) * 0.42;
  return 0.42 + Math.min(1, (min - 21 * 60) / (5 * 60)) * 0.18;
}

export class UIScene extends Phaser.Scene {
  private night!: Phaser.GameObjects.Rectangle;
  private buffText!: Phaser.GameObjects.Text;
  /** Shop row height: smaller when the list is long, so it always fits on screen. */
  private shopRow = ROW;
  private rain!: Phaser.GameObjects.TileSprite;
  private snow!: Phaser.GameObjects.TileSprite;
  /** A pale wash over the outdoors in winter. */
  private frost!: Phaser.GameObjects.Rectangle;
  private slotCount = -1;
  private hearts: Phaser.GameObjects.Image[] = [];
  private heartCount = -1;
  private goldText!: Phaser.GameObjects.Text;
  private dayText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private energyGfx!: Phaser.GameObjects.Graphics;
  private lastEnergy = -1;
  private hotbarGfx!: Phaser.GameObjects.Graphics;
  private slotIcons: Phaser.GameObjects.Image[] = [];
  private slotQty: Phaser.GameObjects.Text[] = [];
  private lastSelected = -1;
  private itemName!: Phaser.GameObjects.Text;
  private lastItemId: string | null = null;
  private locText!: Phaser.GameObjects.Text;
  private toasts: Phaser.GameObjects.Text[] = [];
  private hudGfx!: Phaser.GameObjects.Graphics;
  private energyLabel!: Phaser.GameObjects.Text;
  private slotNums: Phaser.GameObjects.Text[] = [];
  private moon!: Phaser.GameObjects.Image;
  private goalGfx!: Phaser.GameObjects.Graphics;
  private goalText!: Phaser.GameObjects.Text;
  private lastGoal = '';
  private entries: ShopEntry[] = [];
  private touchUI?: TouchControls;
  /** On touch screens the first tap on a shop row selects it and the second buys it. */
  private shopTapped = -1;

  private dlg?: {
    opts: DialogueOpts; line: number; choice: number;
    root: Phaser.GameObjects.Container; gfx: Phaser.GameObjects.Graphics;
    text: Phaser.GameObjects.Text; name?: Phaser.GameObjects.Text;
    choiceTexts: Phaser.GameObjects.Text[]; hint: Phaser.GameObjects.Text;
  };
  private shop?: {
    cursor: number; root: Phaser.GameObjects.Container; rows: Phaser.GameObjects.Text[];
    prices: Phaser.GameObjects.Text[]; sel: Phaser.GameObjects.Graphics; desc: Phaser.GameObjects.Text;
    gold: Phaser.GameObjects.Text; status: Phaser.GameObjects.Text;
  };
  /** The shipping bin's sell menu. Rebuilt after every sale. */
  private sell?: { cursor: number; root: Phaser.GameObjects.Container; count: number };

  constructor() { super('UI'); }

  create(): void {
    this.hearts = [];
    this.heartCount = -1;
    this.lastEnergy = -1;
    this.lastSelected = -1;
    this.lastItemId = null;
    this.slotIcons = [];
    this.slotQty = [];
    this.toasts = [];
    this.dlg = undefined;
    this.shop = undefined;
    modal.open = false;

    this.slotNums = [];
    this.slotCount = -1;
    this.night = this.add.rectangle(0, 0, 10, 10, 0x0a1030, 1).setOrigin(0).setAlpha(0);
    this.frost = this.add.rectangle(0, 0, 10, 10, 0xf0f6ff, 1).setOrigin(0).setAlpha(0);
    this.rain = this.add.tileSprite(0, 0, 10, 10, 'rain').setOrigin(0).setTileScale(3).setVisible(false);
    this.snow = this.add.tileSprite(0, 0, 10, 10, 'snow').setOrigin(0).setTileScale(3).setVisible(false);
    this.moon = this.add.image(0, 58, 'moon', 'plain').setScale(2.5).setAlpha(0);
    this.goalGfx = this.add.graphics();
    this.goalText = this.add.text(0, 112, '', { ...textStyle(15, '#f4e4b0'), align: 'right', wordWrap: { width: 300 }, lineSpacing: 3 }).setOrigin(1, 0);
    this.lastGoal = '';

    // Panels are drawn in layout(), because their positions depend on the screen size.
    this.hudGfx = this.add.graphics();
    this.add.image(26, 84, 'ui', 'coin').setScale(2).setOrigin(0, 0.5);
    this.goldText = this.add.text(64, 84, '', textStyle(22, '#ffe27a')).setOrigin(0, 0.5);
    this.buffText = this.add.text(20, 118, '', textStyle(16, '#9fe8ff'));
    this.dayText = this.add.text(0, 36, '', textStyle(22)).setOrigin(0.5);
    this.timeText = this.add.text(0, 70, '', textStyle(24, '#ffe27a')).setOrigin(0.5);
    this.energyLabel = this.add.text(0, 0, 'E', textStyle(18, '#9be37a')).setOrigin(0.5);
    this.energyGfx = this.add.graphics();
    this.hotbarGfx = this.add.graphics();
    for (let i = 0; i < BACKPACK_SIZE; i++) {
      this.slotNums.push(this.add.text(0, 0, '1234567890-='[i], textStyle(12, '#c8b090')).setDepth(2));
      this.slotIcons.push(this.add.image(0, 0, 'items', 'hoe').setScale(2.6).setDepth(1));
      this.slotQty.push(this.add.text(0, 0, '', textStyle(16)).setOrigin(1, 1).setDepth(2));
    }
    this.itemName = this.add.text(0, 0, '', textStyle(20)).setOrigin(0.5).setAlpha(0);
    this.locText = this.add.text(0, 150, '', textStyle(34, '#f4e4b0')).setOrigin(0.5).setAlpha(0);

    bus.on('toast', this.toast, this);
    bus.on('dialogue', this.openDialogue, this);
    bus.on('shop', this.openShop, this);
    bus.on('sell', this.openSell, this);
    bus.on('location', this.showLocation, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('toast', this.toast, this);
      bus.off('dialogue', this.openDialogue, this);
      bus.off('shop', this.openShop, this);
      bus.off('sell', this.openSell, this);
      bus.off('location', this.showLocation, this);
      modal.open = false;
    });
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    if (isTouchDevice()) touch.enabled = true;
    this.touchUI = new TouchControls(this, () => ({ x: this.hotbarX(), y: this.H - 74, slot: SLOT, gap: SLOT_GAP }));
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this));
    this.input.on('pointerdown', () => {
      if (this.dlg && !this.showingChoices() && performance.now() - modal.openedAt > 150) this.advance();
    });
  }

  private get W(): number { return this.scale.width; }
  private get H(): number { return this.scale.height; }

  private hotbarX(): number {
    const n = state.inventory.length;
    return (this.W - (n * SLOT + (n - 1) * SLOT_GAP)) / 2;
  }

  private onResize(): void {
    this.layout();
    if (this.dlg) {
      this.dlg.text.setWordWrapWidth(this.W - 140);
      this.dlg.hint.setX(this.W - 64);
      this.renderDialogue();
    }
    if (this.sell) this.openSell(this.sell.cursor);
    if (this.shop) {
      const cursor = this.shop.cursor;
      this.closeShop();
      this.openShop();
      this.shop!.cursor = cursor;
      this.renderShop();
    }
  }

  /** Places everything anchored to a screen edge. Runs on start and whenever the screen size changes. */
  private layout(): void {
    const { W, H } = this;
    this.night.setSize(W, H);
    this.rain.setSize(W, H);
    this.snow.setSize(W, H);
    this.frost.setSize(W, H);
    this.moon.setX(W / 2 - 150);
    this.goalText.setX(W - 24);
    this.lastGoal = '-'; // force the goal panel to redraw
    const g = this.hudGfx.clear();
    panel(g, 12, 12, 250, 96, 0.7);
    panel(g, W - 242, 12, 230, 84, 0.7);
    panel(g, W - 58, H - 250, 44, 230, 0.7);
    this.dayText.setX(W - 127);
    this.timeText.setX(W - 127);
    this.energyLabel.setPosition(W - 36, H - 232);
    this.lastEnergy = -1;
    const x0 = this.hotbarX();
    this.slotCount = state.inventory.length;
    for (let i = 0; i < BACKPACK_SIZE; i++) {
      const sx = x0 + i * (SLOT + SLOT_GAP);
      this.slotNums[i].setVisible(i < this.slotCount);
      this.slotNums[i].setPosition(sx + 5, H - 72);
      this.slotIcons[i].setPosition(sx + SLOT / 2, H - 74 + SLOT / 2);
      this.slotQty[i].setPosition(sx + SLOT - 4, H - 22);
    }
    this.drawHotbar();
    this.itemName.setPosition(W / 2, H - 96);
    this.locText.setX(W / 2);
    this.toasts.forEach(t => t.setX(W / 2));
    this.touchUI?.layout(W, H);
  }

  update(): void {
    this.touchUI?.update();
    if (this.slotCount !== state.inventory.length) this.layout();
    // While the moon is missing, nights are much darker. In the eternal night it's always dark.
    let dark = nightAlpha(state.minutes);
    if (moonMissing()) dark = Math.min(0.78, dark * 1.6);
    if (flag('eternal') && !flag('launched')) dark = 0.62;
    const raining = state.weather === 'rain' && !runtime.indoor;
    if (raining) dark = Math.min(0.75, dark + 0.14);
    this.night.setAlpha(runtime.indoor ? 0 : dark);
    // In winter the rain is snow: slow, drifting flakes, and the outdoors gets a pale wash.
    const winter = seasonOf(state.day) === 3;
    this.frost.setAlpha(winter && !runtime.indoor ? 0.16 : 0);
    this.rain.setVisible(raining && !winter);
    this.snow.setVisible(raining && winter);
    if (raining && !winter) { this.rain.tilePositionX -= 1.2; this.rain.tilePositionY -= 4.5; }
    if (raining && winter) { this.snow.tilePositionX -= Math.sin(this.time.now / 900) * 0.25; this.snow.tilePositionY -= 0.5; }
    const moonVisible = !runtime.indoor && !moonMissing();
    this.moon.setFrame(flag('launched') ? 'carrot' : 'plain');
    this.moon.setAlpha(moonVisible ? Math.min(1, Math.max(0, (dark - 0.12) * 4)) : 0);
    this.updateGoal();

    const shown = Math.min(state.maxHp, MAX_HEARTS);
    if (this.heartCount !== shown) {
      this.hearts.forEach(h => h.destroy());
      this.hearts = [];
      for (let i = 0; i < shown; i++) this.hearts.push(this.add.image(24 + i * 23, 38, 'ui', 'heart').setScale(1.5).setOrigin(0, 0.5));
      this.heartCount = shown;
    }
    this.hearts.forEach((h, i) => h.setFrame(i < state.hp ? 'heart' : 'heart_empty'));
    this.goldText.setText(`${state.gold}g`);
    this.dayText.setText(`${dateLabel(state.day)}${state.weather === 'rain' ? (seasonOf(state.day) === 3 ? ' - Snow' : ' - Rain') : ''}`);
    this.buffText.setText([state.buffs.speed ? 'Fast' : '', state.buffs.strength ? 'Strong' : ''].filter(Boolean).join('  '));
    this.timeText.setText(formatTime(state.minutes));
    this.timeText.setColor(state.minutes >= 20 * 60 ? '#9fc8ff' : '#ffe27a');

    if (this.lastEnergy !== state.energy) {
      this.lastEnergy = state.energy;
      const ratio = state.energy / state.maxEnergy;
      const h = Math.round(186 * ratio);
      const color = ratio > 0.5 ? 0x7ad04a : ratio > 0.2 ? 0xe8c040 : 0xe04a3a;
      this.energyGfx.clear();
      this.energyGfx.fillStyle(0x120a05, 1).fillRect(this.W - 46, this.H - 214, 20, 186);
      this.energyGfx.fillStyle(color, 1).fillRect(this.W - 46, this.H - 28 - h, 20, h);
    }

    if (this.lastSelected !== state.selected) {
      this.lastSelected = state.selected;
      this.drawHotbar();
    }
    this.slotIcons.forEach((icon, i) => {
      if (i >= state.inventory.length) { icon.setVisible(false); this.slotQty[i].setText(''); }
    });
    state.inventory.forEach((s, i) => {
      this.slotIcons[i].setVisible(!!s);
      if (s) {
        this.slotIcons[i].setFrame(s.id);
        // Upgraded tools get a coppery (or steely) shine.
        const up = (s.id === 'hoe' || s.id === 'can' || s.id === 'sword') && state.upgrades[s.id];
        if (up) this.slotIcons[i].setTint(s.id === 'sword' ? 0xc8e0ff : 0xffb070);
        else this.slotIcons[i].clearTint();
      }
      this.slotQty[i].setText(s && s.qty > 1 ? String(s.qty) : '');
    });
    const sel = state.inventory[state.selected];
    const selId = sel?.id ?? null;
    if (selId !== this.lastItemId) {
      this.lastItemId = selId;
      if (sel) this.flash(this.itemName, itemName(sel.id), 1200);
      else this.itemName.setAlpha(0);
    }
  }

  private updateGoal(): void {
    const goal = runtime.visit ? `Visiting ${runtime.visit.name}'s farm. Look, don't touch!` : goalText();
    const deadline = runtime.visit ? 'Esc: go home' : deadlineText();
    const text = goal ? `${goal}${deadline ? `\n${deadline}` : ''}` : '';
    if (text === this.lastGoal) return;
    this.lastGoal = text;
    this.goalText.setText(text);
    this.goalGfx.clear();
    if (!text) return;
    const w = this.goalText.width + 24, h = this.goalText.height + 16;
    this.goalGfx.fillStyle(PANEL, 0.75).fillRoundedRect(this.W - 12 - w, 104, w, h, 8);
    this.goalGfx.lineStyle(2, 0x9fc8ff, 1).strokeRoundedRect(this.W - 12 - w, 104, w, h, 8);
    this.flash(this.itemName, 'New goal!', 900);
  }

  private drawHotbar(): void {
    const g = this.hotbarGfx;
    const x0 = this.hotbarX();
    g.clear();
    for (let i = 0; i < state.inventory.length; i++) {
      const sx = x0 + i * (SLOT + SLOT_GAP), sy = this.H - 74;
      const selected = i === state.selected;
      g.fillStyle(selected ? 0x5a3a20 : PANEL, 0.9).fillRoundedRect(sx, sy, SLOT, SLOT, 8);
      g.lineStyle(selected ? 4 : 2, selected ? 0xffe27a : BORDER, 1).strokeRoundedRect(sx, sy, SLOT, SLOT, 8);
    }
  }

  private flash(t: Phaser.GameObjects.Text, text: string, hold: number): void {
    this.tweens.killTweensOf(t);
    t.setText(text).setAlpha(1);
    this.tweens.add({ targets: t, alpha: 0, delay: hold, duration: 400 });
  }

  private showLocation(name: string): void {
    this.flash(this.locText, name, 1200);
  }

  private toast(text: string): void {
    // Above dialogue boxes and the shop, so messages are never hidden.
    const t = this.add.text(this.W / 2, 0, text, textStyle(20)).setOrigin(0.5).setDepth(200);
    this.toasts.push(t);
    this.layoutToasts();
    this.tweens.add({
      targets: t, alpha: 0, delay: 2200, duration: 400,
      onComplete: () => { this.toasts.splice(this.toasts.indexOf(t), 1); t.destroy(); this.layoutToasts(); },
    });
    if (this.toasts.length > 4) {
      const old = this.toasts.shift()!;
      this.tweens.killTweensOf(old);
      old.destroy();
      this.layoutToasts();
    }
  }

  private layoutToasts(): void {
    this.toasts.forEach((t, i) => t.setY(200 + i * 30));
  }

  // ------------------------------------------------------------------ dialogue

  private openDialogue(opts: DialogueOpts): void {
    this.closeDialogue(false);
    // Any line, speaker or choice can say {name} to use the player's name.
    const named = (t: string) => t.split('{name}').join(state.playerName || 'Farmer');
    opts = {
      ...opts,
      speaker: opts.speaker && named(opts.speaker),
      lines: opts.lines.map(named),
      choices: opts.choices?.map(c => ({ ...c, label: named(c.label) })),
    };
    const root = this.add.container(0, 0).setDepth(100);
    const gfx = this.add.graphics();
    const text = this.add.text(64, 0, '', { ...textStyle(22), wordWrap: { width: this.W - 140 }, lineSpacing: 6 });
    const hint = this.add.text(this.W - 64, 0, touch.enabled ? 'Tap >' : 'Space >', textStyle(16, '#ffe27a')).setOrigin(1, 1);
    root.add([gfx, text, hint]);
    let name: Phaser.GameObjects.Text | undefined;
    if (opts.speaker) {
      name = this.add.text(64, 0, opts.speaker, textStyle(20, '#ffe27a'));
      root.add(name);
    }
    this.tweens.add({ targets: hint, alpha: 0.3, yoyo: true, repeat: -1, duration: 500 });
    this.dlg = { opts, line: 0, choice: 0, root, gfx, text, name, choiceTexts: [], hint };
    modal.open = true;
    modal.openedAt = performance.now();
    this.renderDialogue();
  }

  private showingChoices(): boolean {
    const d = this.dlg;
    return !!d && !!d.opts.choices?.length && d.line >= d.opts.lines.length - 1;
  }

  private renderDialogue(): void {
    const d = this.dlg!;
    d.text.setText(d.opts.lines[d.line] ?? '');
    d.choiceTexts.forEach(t => t.destroy());
    d.choiceTexts = [];
    const choices = this.showingChoices() ? d.opts.choices! : [];
    const textH = Math.max(d.text.height, 28);
    const h = 44 + textH + (choices.length ? 14 + choices.length * 32 : 0) + 18;
    const top = this.H - 96 - h;
    d.gfx.clear();
    panel(d.gfx, 40, top, this.W - 80, h, 0.94);
    d.text.setY(top + 26);
    if (d.name) {
      d.gfx.fillStyle(0x5a3a20, 1).fillRoundedRect(52, top - 18, d.name.width + 24, 34, 8);
      d.gfx.lineStyle(3, BORDER, 1).strokeRoundedRect(52, top - 18, d.name.width + 24, 34, 8);
      d.name.setPosition(64, top - 13);
    }
    choices.forEach((c, i) => {
      const sel = i === d.choice;
      const t = this.add.text(84, top + 40 + textH + i * 32, `${sel ? '> ' : '  '}${c.label}`, textStyle(20, sel ? '#ffe27a' : '#ffffff'))
        .setInteractive({ useHandCursor: true });
      t.on('pointerover', () => { if (d.choice !== i) { d.choice = i; this.renderDialogue(); } });
      t.on('pointerdown', () => this.pickChoice(i));
      d.root.add(t);
      d.choiceTexts.push(t);
    });
    d.hint.setVisible(!choices.length);
    d.hint.setY(top + h - 10);
  }

  private advance(): void {
    const d = this.dlg!;
    if (d.line < d.opts.lines.length - 1) {
      d.line++;
      this.renderDialogue();
    } else this.closeDialogue(true);
  }

  private pickChoice(i: number): void {
    const action = this.dlg?.opts.choices?.[i]?.action;
    this.closeDialogue(true);
    action?.();
  }

  private closeDialogue(runOnClose: boolean): void {
    const d = this.dlg;
    if (!d) return;
    this.dlg = undefined;
    this.tweens.killTweensOf(d.hint);
    d.root.destroy();
    modal.open = !!this.shop || !!this.sell;
    modal.closedAt = performance.now();
    if (runOnClose) d.opts.onClose?.();
  }

  // ------------------------------------------------------------------ shop

  private shopRect() {
    this.shopRow = Math.max(30, Math.min(ROW, Math.floor((this.H - 24 - 200) / Math.max(1, this.entries.length))));
    const w = Math.min(720, this.W - 40), h = 200 + this.entries.length * this.shopRow;
    return { w, h, x: (this.W - w) / 2, y: Math.max(12, (this.H - h) / 2 - 40) };
  }

  /** Price after Bram's friendship discount. Story items are always full price. */
  private price(e: ShopEntry): number {
    return e.story ? e.price : Math.round(e.price * (1 - shopDiscount()));
  }

  private openShop(): void {
    this.entries = [
      ...storyShopEntries().map(story => ({ story, name: story.name, price: story.price, desc: story.desc })),
      ...baseShop(),
    ];
    const { w, h, x, y } = this.shopRect();
    const root = this.add.container(0, 0).setDepth(90);
    const g = this.add.graphics();
    panel(g, x, y, w, h, 0.96);
    const sel = this.add.graphics();
    root.add([g, sel, this.add.text(x + w / 2, y + 30, "Bram's Seeds & Supplies", textStyle(26, '#ffe27a')).setOrigin(0.5)]);
    const rows: Phaser.GameObjects.Text[] = [];
    const prices: Phaser.GameObjects.Text[] = [];
    const R = this.shopRow, big = R >= 40;
    this.entries.forEach((e, i) => {
      const ry = y + 78 + i * R;
      const icon = e.id ? this.add.image(x + 50, ry, 'items', e.id)
        : e.tool ? this.add.image(x + 50, ry, 'items', e.tool).setTint(e.tool === 'sword' ? 0xc8e0ff : 0xffb070)
        : e.special === 'backpack' ? this.add.image(x + 50, ry, 'ui', 'coin')
        : e.story?.key === 'suit' ? this.add.image(x + 50, ry, 'items', 'suit')
        : e.story ? this.add.image(x + 50, ry, 'turnipult').setScale(0.4)
        : this.add.image(x + 50, ry, 'ui', 'heart');
      if (!e.story || e.story.key === 'suit') icon.setScale(big ? 2.4 : 1.8);
      else icon.setScale(big ? 1.1 : 0.8);
      const t = this.add.text(x + 86, ry, e.name, textStyle(big ? 22 : 19)).setOrigin(0, 0.5);
      const extra = e.story?.gel ? ` +${e.story.gel} gel` : needsText(e.needs);
      const p = this.add.text(x + w - 40, ry, `${this.price(e)}g${extra}`, textStyle(big ? 22 : 19, '#ffe27a')).setOrigin(1, 0.5);
      for (const o of [t, p]) {
        o.setInteractive({ useHandCursor: true });
        o.on('pointerover', () => { if (this.shop) { this.shop.cursor = i; this.renderShop(); } });
        o.on('pointerdown', (p: Phaser.Input.Pointer) => {
          if (!this.shop) return;
          if (p.wasTouch && this.shopTapped !== i) {
            this.shopTapped = i;
            this.shop.cursor = i;
            this.renderShop();
            return;
          }
          this.buy();
        });
      }
      root.add([icon, t, p]);
      rows.push(t);
      prices.push(p);
    });
    const desc = this.add.text(x + 30, y + h - 96, '', { ...textStyle(18, '#e8dcc0'), wordWrap: { width: w - 60 } });
    const gold = this.add.text(x + 30, y + h - 40, '', textStyle(20, '#ffe27a'));
    const status = this.add.text(x + w / 2, y + h - 122, '', textStyle(20, '#9be37a')).setOrigin(0.5).setAlpha(0);
    const hint = this.add.text(x + w - 30, y + h - 40, touch.enabled ? 'Tap twice to buy' : 'Space: buy   Esc: leave', textStyle(16, '#c8b090')).setOrigin(1, 0);
    const close = this.add.text(x + w - 22, y + 14, 'X', { ...textStyle(26, '#ffe27a'), backgroundColor: '#5a3a20', padding: { x: 10, y: 2 } })
      .setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.closeShop());
    root.add([desc, gold, hint, close, status]);
    this.shopTapped = -1;
    this.shop = { cursor: 0, root, rows, prices, sel, desc, gold, status };
    modal.open = true;
    modal.openedAt = performance.now();
    this.renderShop();
  }

  private renderShop(): void {
    const s = this.shop!;
    const { w, x, y } = this.shopRect();
    s.sel.clear();
    const R = this.shopRow, hh = Math.min(40, R - 2);
    s.sel.fillStyle(0x5a3a20, 1).fillRoundedRect(x + 18, y + 78 + s.cursor * R - hh / 2, w - 36, hh, 8);
    s.sel.lineStyle(2, 0xffe27a, 1).strokeRoundedRect(x + 18, y + 78 + s.cursor * R - hh / 2, w - 36, hh, 8);
    this.entries.forEach((e, i) => {
      const afford = state.gold >= this.price(e) && (e.needs ?? []).every(([id, n]) => countItem(id) >= n);
      s.prices[i].setColor(afford ? '#ffe27a' : '#b06050');
      s.rows[i].setColor(i === s.cursor ? '#ffffff' : '#e8dcc0');
    });
    const e = this.entries[s.cursor];
    const off = shopDiscount();
    s.desc.setText(e.desc + (off && !e.story ? `  (Friend price: ${Math.round(off * 100)}% off.)` : ''));
    s.gold.setText(`Gold: ${state.gold}g  Gel: ${countItem('gel')}  Cores: ${countItem('core')}`);
  }

  private buy(): void {
    const s = this.shop!;
    const e = this.entries[s.cursor];
    if (e.story) {
      const err = buyStoryItem(e.story);
      if (err) { sfx('error'); this.shopStatus(err, false); return; }
      sfx('coin');
      // Story items are one-offs: rebuild the list without it.
      this.closeShop();
      this.openShop();
      this.shopStatus(`Bought ${e.name}! (-${e.price}g)`, true);
      return;
    }
    const fail = (msg: string) => { sfx('error'); this.shopStatus(msg, false); };
    const price = this.price(e);
    if (state.gold < price) { fail(`Not enough gold. You need ${price - state.gold}g more.`); return; }
    const short = (e.needs ?? []).find(([id, n]) => countItem(id) < n);
    if (short) {
      const [id, n] = short;
      fail(`Bram also wants ${n} ${ITEMS[id].name}${id === 'core' ? 's from the Deep Woods' : id === 'gel' ? ' from Mossy Woods' : ''}.`);
      return;
    }
    let rebuild = false;
    if (e.special === 'heart') {
      if (state.maxHp >= MAX_HEARTS) { fail('You already have the most hearts possible.'); return; }
      state.maxHp++;
      state.hp = state.maxHp;
      rebuild = state.maxHp >= MAX_HEARTS;
    } else if (e.special === 'backpack') {
      if (state.inventory.length >= BACKPACK_SIZE) { fail('You already have a Backpack.'); return; }
      while (state.inventory.length < BACKPACK_SIZE) state.inventory.push(null);
      rebuild = true;
    } else if (e.special === 'upgrade') {
      state.upgrades[e.tool!] = 1;
      rebuild = true;
    } else if (!addItem(e.id!, 1)) {
      fail('Your bag is full!');
      return;
    }
    state.gold -= price;
    for (const [id, n] of e.needs ?? []) removeItem(id, n);
    sfx('coin');
    if (rebuild) {
      // One-off purchases leave the list.
      const cursor = s.cursor;
      this.closeShop();
      this.openShop();
      this.shop!.cursor = Math.min(cursor, this.entries.length - 1);
      this.renderShop();
      this.shopStatus(`Bought ${e.name}! (-${price}g)`, true);
      return;
    }
    this.renderShop();
    this.shopStatus(`Bought ${e.name}! (-${price}g)`, true);
    // A little bounce on the row you bought from.
    const row = s.rows[s.cursor];
    this.tweens.add({ targets: row, scale: 1.12, duration: 90, yoyo: true });
  }

  /** A short message inside the shop panel: green for a purchase, red for a problem. */
  private shopStatus(msg: string, ok: boolean): void {
    const t = this.shop?.status;
    if (!t) return;
    this.tweens.killTweensOf(t);
    t.setText(msg).setColor(ok ? '#9be37a' : '#ff8a7a').setAlpha(1).setScale(1.15);
    this.tweens.add({ targets: t, scale: 1, duration: 150, ease: 'Back.out' });
    this.tweens.add({ targets: t, alpha: 0, delay: 1600, duration: 400 });
  }

  // ------------------------------------------------------------------ sell (shipping bin)

  /** Sellable items in the bag, one entry per item type. */
  private sellables(): { id: ItemId; qty: number; price: number }[] {
    const out = new Map<ItemId, { id: ItemId; qty: number; price: number }>();
    for (const s of state.inventory) {
      const def = s && ITEMS[s.id];
      if (!s || !def?.sell || !['produce', 'material', 'forage', 'food'].includes(def.kind)) continue;
      const e = out.get(s.id) ?? { id: s.id, qty: 0, price: def.sell };
      e.qty += s.qty;
      out.set(s.id, e);
    }
    return [...out.values()];
  }

  private openSell(cursor = 0, status?: { msg: string; ok: boolean }): void {
    this.sell?.root.destroy();
    const items = this.sellables();
    const total = items.reduce((n, e) => n + e.qty * e.price, 0);
    const rowsCount = items.length ? items.length + 1 : 1; // + "ship everything"
    // With a full Backpack there can be a dozen kinds of things to sell; shrink the rows to fit the screen.
    const ROW = Math.max(30, Math.min(44, Math.floor((this.H - 24 - 190) / rowsCount)));
    const w = 680, h = 190 + rowsCount * ROW;
    const x = (this.W - w) / 2, y = Math.max(12, (this.H - h) / 2 - 40);
    cursor = Math.min(cursor, Math.max(0, rowsCount - 1));
    const root = this.add.container(0, 0).setDepth(90);
    const g = this.add.graphics();
    panel(g, x, y, w, h, 0.96);
    root.add([g, this.add.text(x + w / 2, y + 30, 'Shipping Bin', textStyle(26, '#ffe27a')).setOrigin(0.5)]);
    const close = this.add.text(x + w - 22, y + 14, 'X', { ...textStyle(26, '#ffe27a'), backgroundColor: '#5a3a20', padding: { x: 10, y: 2 } })
      .setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.closeSell());
    root.add(close);

    if (items.length) {
      const sel = this.add.graphics();
      const hh = Math.min(40, ROW - 2);
      sel.fillStyle(0x5a3a20, 1).fillRoundedRect(x + 18, y + 78 + cursor * ROW - hh / 2, w - 36, hh, 8);
      sel.lineStyle(2, 0xffe27a, 1).strokeRoundedRect(x + 18, y + 78 + cursor * ROW - hh / 2, w - 36, hh, 8);
      root.add(sel);
    }
    const button = (bx: number, by: number, label: string, onTap: () => void) => {
      const b = this.add.text(bx, by, label, { ...textStyle(18, '#ffe27a'), backgroundColor: '#3a2412', padding: { x: 8, y: 3 } })
        .setOrigin(0.5).setInteractive({ useHandCursor: true });
      b.on('pointerup', onTap);
      root.add(b);
    };
    items.forEach((e, i) => {
      const ry = y + 78 + i * ROW;
      const hover = this.add.zone(x + 18, ry - 20, w - 36, 40).setOrigin(0).setInteractive();
      hover.on('pointerover', () => { if (this.sell && this.sell.cursor !== i) this.openSell(i); });
      root.add([
        hover,
        this.add.image(x + 46, ry, 'items', e.id).setScale(2.2),
        this.add.text(x + 76, ry, `${ITEMS[e.id].name}  x${e.qty}`, textStyle(21, i === cursor ? '#ffffff' : '#e8dcc0')).setOrigin(0, 0.5),
        this.add.text(x + w - 250, ry, `${e.price}g each`, textStyle(18, '#ffe27a')).setOrigin(1, 0.5),
      ]);
      button(x + w - 180, ry, 'Sell 1', () => this.sellItem(e.id, 1, i));
      button(x + w - 80, ry, `All +${e.qty * e.price}g`, () => this.sellItem(e.id, e.qty, i));
    });
    const lastY = y + 78 + (rowsCount - 1) * ROW;
    if (items.length) {
      const hover = this.add.zone(x + 18, lastY - 20, w - 36, 40).setOrigin(0).setInteractive();
      hover.on('pointerover', () => { if (this.sell && this.sell.cursor !== items.length) this.openSell(items.length); });
      root.add([hover, this.add.text(x + 76, lastY, 'Ship everything', textStyle(21, cursor === items.length ? '#ffffff' : '#e8dcc0')).setOrigin(0, 0.5)]);
      button(x + w - 80, lastY, `+${total}g`, () => this.sellEverything());
    } else {
      root.add(this.add.text(x + w / 2, lastY, 'Nothing to sell. Crops, eggs, milk, cooking, forage and gel go in here.', textStyle(18, '#e8dcc0')).setOrigin(0.5));
    }
    const statusText = this.add.text(x + w / 2, y + h - 80, '', textStyle(20, '#9be37a')).setOrigin(0.5).setAlpha(0);
    root.add([
      statusText,
      this.add.text(x + 30, y + h - 40, `Your gold: ${state.gold}g`, textStyle(20, '#ffe27a')),
      this.add.text(x + w - 30, y + h - 40, touch.enabled ? 'Tap Sell 1 or All' : 'Space: sell 1   A: sell all   Esc: close', textStyle(16, '#c8b090')).setOrigin(1, 0),
    ]);
    if (status) {
      statusText.setText(status.msg).setColor(status.ok ? '#9be37a' : '#ff8a7a').setAlpha(1).setScale(1.15);
      this.tweens.add({ targets: statusText, scale: 1, duration: 150, ease: 'Back.out' });
      this.tweens.add({ targets: statusText, alpha: 0, delay: 1600, duration: 400 });
    }
    const wasOpen = !!this.sell;
    this.sell = { cursor, root, count: items.length };
    modal.open = true;
    if (!wasOpen) modal.openedAt = performance.now();
  }

  private sellItem(id: ItemId, qty: number, cursor: number): void {
    const price = ITEMS[id].sell ?? 0;
    if (!removeItem(id, qty)) return;
    state.gold += price * qty;
    state.shipped += price * qty;
    sfx('coin');
    const name = ITEMS[id].name;
    this.openSell(cursor, { msg: `Sold ${qty} ${qty > 1 ? plural(name) : name} for ${price * qty}g`, ok: true });
  }

  private sellEverything(): void {
    const items = this.sellables();
    if (!items.length) return;
    let total = 0;
    for (const e of items) {
      removeItem(e.id, e.qty);
      total += e.qty * e.price;
    }
    state.gold += total;
    state.shipped += total;
    sfx('coin');
    this.openSell(0, { msg: `Shipped everything for ${total}g!`, ok: true });
  }

  private closeSell(): void {
    this.sell?.root.destroy();
    this.sell = undefined;
    modal.open = !!this.dlg || !!this.shop;
    modal.closedAt = performance.now();
  }

  private closeShop(): void {
    this.shop?.root.destroy();
    this.shop = undefined;
    modal.open = !!this.dlg || !!this.sell;
    modal.closedAt = performance.now();
  }

  // ------------------------------------------------------------------ input

  private onKey(e: KeyboardEvent): void {
    if (!modal.open || performance.now() - modal.openedAt < 150) return;
    const c = e.code;
    const confirm = ['Space', 'Enter', 'NumpadEnter', 'KeyE', 'KeyJ', 'KeyK'].includes(c);
    const cancel = ['Escape', 'Backspace', 'KeyQ'].includes(c);
    const up = c === 'ArrowUp' || c === 'KeyW';
    const down = c === 'ArrowDown' || c === 'KeyS';

    if (this.dlg) {
      const d = this.dlg;
      if (this.showingChoices()) {
        const n = d.opts.choices!.length;
        if (up) { d.choice = (d.choice + n - 1) % n; this.renderDialogue(); }
        else if (down) { d.choice = (d.choice + 1) % n; this.renderDialogue(); }
        else if (confirm) this.pickChoice(d.choice);
        else if (cancel) this.closeDialogue(false);
      } else if (confirm || cancel) this.advance();
      return;
    }
    if (this.sell) {
      const items = this.sellables();
      const n = items.length ? items.length + 1 : 1;
      const cur = this.sell.cursor;
      if (up) this.openSell((cur + n - 1) % n);
      else if (down) this.openSell((cur + 1) % n);
      else if (cancel) this.closeSell();
      else if (!items.length) return;
      else if (cur === items.length && (confirm || c === 'KeyA')) this.sellEverything();
      else if (confirm) this.sellItem(items[cur].id, 1, cur);
      else if (c === 'KeyA') this.sellItem(items[cur].id, items[cur].qty, cur);
      return;
    }
    if (this.shop) {
      const n = this.entries.length;
      if (up) { this.shop.cursor = (this.shop.cursor + n - 1) % n; this.renderShop(); }
      else if (down) { this.shop.cursor = (this.shop.cursor + 1) % n; this.renderShop(); }
      else if (confirm) this.buy();
      else if (cancel) this.closeShop();
    }
  }
}
