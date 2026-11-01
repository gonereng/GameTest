import Phaser from 'phaser';
import { HOTBAR_SIZE, state } from './state';
import { modal } from './bus';
import { toggleFullscreen } from './fullscreen';

/** Shared touch input: the UI scene writes it, the world scene reads it. */
export const touch = {
  enabled: false,
  /** Joystick direction, each in -1..1. */
  dx: 0,
  dy: 0,
  use: false,
  talk: false,
  menu: false,
};

/** Reads a one-shot button press and clears it. */
export function consumeTouch(k: 'use' | 'talk' | 'menu'): boolean {
  const v = touch[k];
  touch[k] = false;
  return v;
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
}

/** Default joystick spot, measured from the bottom-left corner. */
const STICK_FROM_CORNER = { x: 120, y: 178 };
const STICK_R = 58;

interface Button { x: number; y: number; r: number; color: number; gfx: Phaser.GameObjects.Graphics; label?: Phaser.GameObjects.Text; down: boolean }
type HotbarRect = { x: number; y: number; slot: number; gap: number };

/** On-screen joystick and buttons, drawn in the UI scene. */
export class TouchControls {
  private root: Phaser.GameObjects.Container;
  private base: Phaser.GameObjects.Graphics;
  private knob: Phaser.GameObjects.Graphics;
  private stickId: number | null = null;
  private home = { x: 120, y: 462 };
  private origin = { x: 120, y: 462 };
  private size = { w: 960, h: 640 };
  private use: Button;
  private talk: Button;
  private menu: Button;
  private full: Button;
  private icons: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene, private hotbar: () => HotbarRect) {
    scene.input.addPointer(3);
    this.root = scene.add.container(0, 0).setDepth(80);
    this.base = scene.add.graphics();
    this.knob = scene.add.graphics();
    this.use = this.button(50, 'USE', 0xe8c040);
    this.talk = this.button(40, 'TALK', 0x7fb4f2);
    this.menu = this.button(22);
    this.full = this.button(22);
    this.icons = scene.add.graphics();
    this.root.add([this.icons, this.base, this.knob]);
    this.layout(scene.scale.width, scene.scale.height);

    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
    this.setVisible(touch.enabled);
  }

  setVisible(v: boolean): void {
    this.root.setVisible(v);
  }

  /** Fade the controls while a dialogue or the shop is open. */
  update(): void {
    if (!touch.enabled) return;
    if (!this.root.visible) this.setVisible(true);
    this.root.setAlpha(modal.open ? 0.25 : 1);
  }

  /** Positions the controls relative to the screen edges. */
  layout(w: number, h: number): void {
    this.size = { w, h };
    this.home = { x: STICK_FROM_CORNER.x, y: h - STICK_FROM_CORNER.y };
    if (this.stickId === null) this.origin = { ...this.home };
    const place = (b: Button, x: number, y: number) => { b.x = x; b.y = y; b.label?.setPosition(x, y); this.redraw(b); };
    place(this.use, w - 116, h - 170);
    place(this.talk, w - 224, h - 120);
    place(this.menu, w / 2 - 34, 30);
    place(this.full, w / 2 + 34, 30);
    this.drawIcons();
    this.drawStick();
  }

  private button(r: number, text?: string, color = 0xffffff): Button {
    const gfx = this.scene.add.graphics();
    const b: Button = { x: 0, y: 0, r, color, gfx, down: false };
    this.root.add(gfx);
    if (text) {
      b.label = this.scene.add.text(0, 0, text, {
        fontFamily: 'monospace', fontSize: `${Math.round(r * 0.42)}px`, fontStyle: 'bold',
        color: `#${color.toString(16).padStart(6, '0')}`, stroke: '#1a0f08', strokeThickness: 4,
      }).setOrigin(0.5);
      this.root.add(b.label);
    }
    return b;
  }

  private redraw(b: Button): void {
    b.gfx.clear();
    b.gfx.fillStyle(0x1a0f08, b.down ? 0.75 : 0.45).fillCircle(b.x, b.y, b.r);
    b.gfx.lineStyle(3, b.color, b.down ? 1 : 0.8).strokeCircle(b.x, b.y, b.r);
  }

  private drawIcons(): void {
    const g = this.icons.clear();
    g.fillStyle(0xf4e4b0, 1);
    const m = this.menu;
    for (const dy of [-7, 0, 7]) g.fillRect(m.x - 10, m.y + dy - 1.5, 20, 3);
    const f = this.full;
    g.lineStyle(3, 0xf4e4b0, 1);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = f.x + sx * 9, cy = f.y + sy * 9;
      g.lineBetween(cx, cy, cx - sx * 6, cy);
      g.lineBetween(cx, cy, cx, cy - sy * 6);
    }
  }

  private drawStick(): void {
    const { x, y } = this.origin;
    this.base.clear();
    this.base.fillStyle(0x1a0f08, 0.35).fillCircle(x, y, STICK_R + 8);
    this.base.lineStyle(3, 0xf4e4b0, 0.6).strokeCircle(x, y, STICK_R + 8);
    this.moveKnob(x, y);
  }

  private moveKnob(x: number, y: number): void {
    this.knob.clear();
    this.knob.fillStyle(0xf4e4b0, 0.85).fillCircle(x, y, 26);
    this.knob.lineStyle(3, 0x1a0f08, 0.6).strokeCircle(x, y, 26);
  }

  private hit(b: Button, p: Phaser.Input.Pointer): boolean {
    return Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y) <= b.r + 10;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (p.wasTouch && !touch.enabled) {
      touch.enabled = true;
      this.setVisible(true);
    }
    if (!touch.enabled) return;
    if (this.hit(this.full, p)) return; // handled on pointer up (browsers need that for fullscreen)
    if (modal.open) return;
    if (this.hit(this.menu, p)) { touch.menu = true; return; }
    if (this.hit(this.use, p)) { touch.use = true; this.press(this.use); return; }
    if (this.hit(this.talk, p)) { touch.talk = true; this.press(this.talk); return; }
    const hb = this.hotbar();
    if (p.y >= hb.y && p.y <= hb.y + hb.slot && p.x >= hb.x) {
      const i = Math.floor((p.x - hb.x) / (hb.slot + hb.gap));
      if (i >= 0 && i < HOTBAR_SIZE) { state.selected = i; return; }
    }
    if (this.stickId === null && p.x < this.size.w * 0.45 && p.y > this.size.h * 0.3) {
      this.stickId = p.id;
      this.origin = { x: p.x, y: p.y };
      this.drawStick();
    }
  }

  private press(b: Button): void {
    b.down = true;
    this.redraw(b);
    this.scene.time.delayedCall(140, () => { b.down = false; this.redraw(b); });
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (p.id !== this.stickId) return;
    let dx = p.x - this.origin.x, dy = p.y - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_R) { dx = (dx / len) * STICK_R; dy = (dy / len) * STICK_R; }
    touch.dx = dx / STICK_R;
    touch.dy = dy / STICK_R;
    this.moveKnob(this.origin.x + dx, this.origin.y + dy);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (touch.enabled && this.hit(this.full, p)) {
      toggleFullscreen();
      return;
    }
    if (p.id !== this.stickId) return;
    this.stickId = null;
    touch.dx = 0;
    touch.dy = 0;
    this.origin = { ...this.home };
    this.drawStick();
  }
}
