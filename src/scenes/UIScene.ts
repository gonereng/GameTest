import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { ITEMS, type ItemId } from '../items';
import { HOTBAR_SIZE, addItem, formatTime, runtime, state } from '../state';
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

interface ShopEntry { id?: ItemId; special?: 'heart'; story?: StoryShopEntry; name: string; price: number; desc: string }

const BASE_SHOP: ShopEntry[] = [
  ...(['seed_carrot', 'seed_turnip', 'seed_moonmelon', 'bread'] as ItemId[]).map(id => ({
    id, name: ITEMS[id].name, price: ITEMS[id].price!, desc: ITEMS[id].desc,
  })),
  { special: 'heart', name: 'Heart Charm', price: 300, desc: 'Permanently adds one heart. Handy in the woods.' },
];

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
    gold: Phaser.GameObjects.Text;
  };

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

    this.night = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0a1030, 1).setOrigin(0).setAlpha(0);
    this.moon = this.add.image(GAME_W / 2 - 150, 58, 'moon', 'plain').setScale(2.5).setAlpha(0);
    this.goalGfx = this.add.graphics();
    this.goalText = this.add.text(GAME_W - 24, 112, '', { ...textStyle(15, '#f4e4b0'), align: 'right', wordWrap: { width: 300 }, lineSpacing: 3 }).setOrigin(1, 0);
    this.lastGoal = '';

    // Top-left: hearts and gold.
    const g = this.add.graphics();
    panel(g, 12, 12, 250, 96, 0.7);
    this.add.image(26, 84, 'ui', 'coin').setScale(2).setOrigin(0, 0.5);
    this.goldText = this.add.text(64, 84, '', textStyle(22, '#ffe27a')).setOrigin(0, 0.5);

    // Top-right: clock.
    panel(g, GAME_W - 202, 12, 190, 84, 0.7);
    this.dayText = this.add.text(GAME_W - 107, 36, '', textStyle(22)).setOrigin(0.5);
    this.timeText = this.add.text(GAME_W - 107, 70, '', textStyle(24, '#ffe27a')).setOrigin(0.5);

    // Bottom-right: energy.
    panel(g, GAME_W - 58, GAME_H - 250, 44, 230, 0.7);
    this.add.text(GAME_W - 36, GAME_H - 232, 'E', textStyle(18, '#9be37a')).setOrigin(0.5);
    this.energyGfx = this.add.graphics();

    // Bottom: hotbar.
    this.hotbarGfx = this.add.graphics();
    const x0 = this.hotbarX();
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const sx = x0 + i * (SLOT + SLOT_GAP);
      this.add.text(sx + 5, GAME_H - 72, String((i + 1) % 10), textStyle(12, '#c8b090')).setDepth(2);
      this.slotIcons.push(this.add.image(sx + SLOT / 2, GAME_H - 74 + SLOT / 2, 'items', 'hoe').setScale(2.6).setDepth(1));
      this.slotQty.push(this.add.text(sx + SLOT - 4, GAME_H - 22, '', textStyle(16)).setOrigin(1, 1).setDepth(2));
    }
    this.itemName = this.add.text(GAME_W / 2, GAME_H - 96, '', textStyle(20)).setOrigin(0.5).setAlpha(0);
    this.locText = this.add.text(GAME_W / 2, 150, '', textStyle(34, '#f4e4b0')).setOrigin(0.5).setAlpha(0);

    bus.on('toast', this.toast, this);
    bus.on('dialogue', this.openDialogue, this);
    bus.on('shop', this.openShop, this);
    bus.on('location', this.showLocation, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('toast', this.toast, this);
      bus.off('dialogue', this.openDialogue, this);
      bus.off('shop', this.openShop, this);
      bus.off('location', this.showLocation, this);
      modal.open = false;
    });
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    if (isTouchDevice()) touch.enabled = true;
    this.touchUI = new TouchControls(this, { x: this.hotbarX(), y: GAME_H - 74, slot: SLOT, gap: SLOT_GAP });
    this.input.on('pointerdown', () => {
      if (this.dlg && !this.showingChoices() && performance.now() - modal.openedAt > 150) this.advance();
    });
  }

  private hotbarX(): number {
    return (GAME_W - (HOTBAR_SIZE * SLOT + (HOTBAR_SIZE - 1) * SLOT_GAP)) / 2;
  }

  update(): void {
    this.touchUI?.update();
    // While the moon is missing, nights are much darker. In the eternal night it's always dark.
    let dark = nightAlpha(state.minutes);
    if (moonMissing()) dark = Math.min(0.78, dark * 1.6);
    if (flag('eternal') && !flag('launched')) dark = 0.62;
    this.night.setAlpha(runtime.indoor ? 0 : dark);
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
    this.dayText.setText(`Day ${state.day}`);
    this.timeText.setText(formatTime(state.minutes));
    this.timeText.setColor(state.minutes >= 20 * 60 ? '#9fc8ff' : '#ffe27a');

    if (this.lastEnergy !== state.energy) {
      this.lastEnergy = state.energy;
      const ratio = state.energy / state.maxEnergy;
      const h = Math.round(186 * ratio);
      const color = ratio > 0.5 ? 0x7ad04a : ratio > 0.2 ? 0xe8c040 : 0xe04a3a;
      this.energyGfx.clear();
      this.energyGfx.fillStyle(0x120a05, 1).fillRect(GAME_W - 46, GAME_H - 214, 20, 186);
      this.energyGfx.fillStyle(color, 1).fillRect(GAME_W - 46, GAME_H - 28 - h, 20, h);
    }

    if (this.lastSelected !== state.selected) {
      this.lastSelected = state.selected;
      this.drawHotbar();
    }
    state.inventory.forEach((s, i) => {
      this.slotIcons[i].setVisible(!!s);
      if (s) this.slotIcons[i].setFrame(s.id);
      this.slotQty[i].setText(s && s.qty > 1 ? String(s.qty) : '');
    });
    const sel = state.inventory[state.selected];
    const selId = sel?.id ?? null;
    if (selId !== this.lastItemId) {
      this.lastItemId = selId;
      if (sel) this.flash(this.itemName, ITEMS[sel.id].name, 1200);
      else this.itemName.setAlpha(0);
    }
  }

  private updateGoal(): void {
    const goal = goalText();
    const deadline = deadlineText();
    const text = goal ? `${goal}${deadline ? `\n${deadline}` : ''}` : '';
    if (text === this.lastGoal) return;
    this.lastGoal = text;
    this.goalText.setText(text);
    this.goalGfx.clear();
    if (!text) return;
    const w = this.goalText.width + 24, h = this.goalText.height + 16;
    this.goalGfx.fillStyle(PANEL, 0.75).fillRoundedRect(GAME_W - 12 - w, 104, w, h, 8);
    this.goalGfx.lineStyle(2, 0x9fc8ff, 1).strokeRoundedRect(GAME_W - 12 - w, 104, w, h, 8);
    this.flash(this.itemName, 'New goal!', 900);
  }

  private drawHotbar(): void {
    const g = this.hotbarGfx;
    const x0 = this.hotbarX();
    g.clear();
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const sx = x0 + i * (SLOT + SLOT_GAP), sy = GAME_H - 74;
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
    const t = this.add.text(GAME_W / 2, 0, text, textStyle(20)).setOrigin(0.5).setDepth(50);
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
    const root = this.add.container(0, 0).setDepth(100);
    const gfx = this.add.graphics();
    const text = this.add.text(64, 0, '', { ...textStyle(22), wordWrap: { width: GAME_W - 140 }, lineSpacing: 6 });
    const hint = this.add.text(GAME_W - 64, 0, touch.enabled ? 'Tap >' : 'Space >', textStyle(16, '#ffe27a')).setOrigin(1, 1);
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
    const top = GAME_H - 96 - h;
    d.gfx.clear();
    panel(d.gfx, 40, top, GAME_W - 80, h, 0.94);
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
    modal.open = !!this.shop;
    modal.closedAt = performance.now();
    if (runOnClose) d.opts.onClose?.();
  }

  // ------------------------------------------------------------------ shop

  private shopRect() {
    const w = 600, h = 170 + this.entries.length * ROW;
    return { w, h, x: (GAME_W - w) / 2, y: Math.max(12, (GAME_H - h) / 2 - 40) };
  }

  private openShop(): void {
    this.entries = [
      ...storyShopEntries().map(story => ({ story, name: story.name, price: story.price, desc: story.desc })),
      ...BASE_SHOP,
    ];
    const { w, h, x, y } = this.shopRect();
    const root = this.add.container(0, 0).setDepth(90);
    const g = this.add.graphics();
    panel(g, x, y, w, h, 0.96);
    const sel = this.add.graphics();
    root.add([g, sel, this.add.text(x + w / 2, y + 30, "Bram's Seeds & Supplies", textStyle(26, '#ffe27a')).setOrigin(0.5)]);
    const rows: Phaser.GameObjects.Text[] = [];
    const prices: Phaser.GameObjects.Text[] = [];
    this.entries.forEach((e, i) => {
      const ry = y + 78 + i * ROW;
      const icon = e.id ? this.add.image(x + 50, ry, 'items', e.id)
        : e.story?.key === 'suit' ? this.add.image(x + 50, ry, 'items', 'suit')
        : e.story ? this.add.image(x + 50, ry, 'turnipult').setScale(0.4)
        : this.add.image(x + 50, ry, 'ui', 'heart');
      if (!e.story || e.story.key === 'suit') icon.setScale(2.4);
      else icon.setScale(1.1);
      const t = this.add.text(x + 86, ry, e.name, textStyle(22)).setOrigin(0, 0.5);
      const p = this.add.text(x + w - 40, ry, `${e.price}g${e.story?.gel ? ` +${e.story.gel} gel` : ''}`, textStyle(22, '#ffe27a')).setOrigin(1, 0.5);
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
    const hint = this.add.text(x + w - 30, y + h - 40, touch.enabled ? 'Tap twice to buy' : 'Space: buy   Esc: leave', textStyle(16, '#c8b090')).setOrigin(1, 0);
    const close = this.add.text(x + w - 22, y + 14, 'X', { ...textStyle(26, '#ffe27a'), backgroundColor: '#5a3a20', padding: { x: 10, y: 2 } })
      .setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.closeShop());
    root.add([desc, gold, hint, close]);
    this.shopTapped = -1;
    this.shop = { cursor: 0, root, rows, prices, sel, desc, gold };
    modal.open = true;
    modal.openedAt = performance.now();
    this.renderShop();
  }

  private renderShop(): void {
    const s = this.shop!;
    const { w, x, y } = this.shopRect();
    s.sel.clear();
    s.sel.fillStyle(0x5a3a20, 1).fillRoundedRect(x + 18, y + 78 + s.cursor * ROW - 20, w - 36, 40, 8);
    s.sel.lineStyle(2, 0xffe27a, 1).strokeRoundedRect(x + 18, y + 78 + s.cursor * ROW - 20, w - 36, 40, 8);
    this.entries.forEach((e, i) => {
      const afford = state.gold >= e.price;
      s.prices[i].setColor(afford ? '#ffe27a' : '#b06050');
      s.rows[i].setColor(i === s.cursor ? '#ffffff' : '#e8dcc0');
    });
    const e = this.entries[s.cursor];
    s.desc.setText(e.special === 'heart' && state.maxHp >= MAX_HEARTS ? 'You already have as many hearts as you can carry.' : e.desc);
    s.gold.setText(`Your gold: ${state.gold}g`);
  }

  private buy(): void {
    const s = this.shop!;
    const e = this.entries[s.cursor];
    if (e.story) {
      const err = buyStoryItem(e.story);
      if (err) { this.toast(err); return; }
      this.toast(`Bought ${e.name}.`);
      // Story items are one-offs: rebuild the list without it.
      this.closeShop();
      this.openShop();
      return;
    }
    if (state.gold < e.price) { this.toast('Not enough gold.'); return; }
    if (e.special === 'heart') {
      if (state.maxHp >= MAX_HEARTS) { this.toast('You already have the most hearts possible.'); return; }
      state.maxHp++;
      state.hp = state.maxHp;
    } else if (!addItem(e.id!, 1)) {
      this.toast('Your bag is full!');
      return;
    }
    state.gold -= e.price;
    this.toast(`Bought ${e.name}.`);
    this.renderShop();
  }

  private closeShop(): void {
    this.shop?.root.destroy();
    this.shop = undefined;
    modal.open = !!this.dlg;
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
    if (this.shop) {
      const n = this.entries.length;
      if (up) { this.shop.cursor = (this.shop.cursor + n - 1) % n; this.renderShop(); }
      else if (down) { this.shop.cursor = (this.shop.cursor + 1) % n; this.renderShop(); }
      else if (confirm) this.buy();
      else if (cancel) this.closeShop();
    }
  }
}
