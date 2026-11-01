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

/** Farm animals that wander about. They don't block the player. */
export class Critter extends Phaser.Physics.Arcade.Sprite {
  private nextThink = 0;
  private moving = false;
  talks = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, readonly kind: CritterKind) {
    super(scene, x, y, kind, 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const b = this.body as Body;
    if (isCow(kind)) b.setSize(18, 8).setOffset(7, 23);
    else b.setSize(8, 5).setOffset(4, 11);
    b.setCollideWorldBounds(true);
    this.idle();
  }

  private idle(): void {
    this.moving = false;
    (this.body as Body).setVelocity(0, 0);
    this.play(isCow(this.kind) ? `${this.kind}_side` : `${this.kind}_idle`, true);
    if (isCow(this.kind)) this.anims.pause();
  }

  think(now: number, paused: boolean): void {
    const b = this.body as Body;
    this.setDepth(b.bottom);
    if (paused) { b.setVelocity(0, 0); return; }
    if (now < this.nextThink) return;
    this.nextThink = now + Phaser.Math.Between(1200, 3500);
    if (this.moving || Math.random() < 0.4) { this.idle(); return; }
    this.moving = true;
    const a = Math.random() * Math.PI * 2;
    const vx = Math.cos(a) * SPEED[this.kind], vy = Math.sin(a) * SPEED[this.kind];
    b.setVelocity(vx, vy);
    if (isCow(this.kind)) {
      const dir = Math.abs(vx) > Math.abs(vy) ? 'side' : vy > 0 ? 'down' : 'up';
      this.play(`${this.kind}_${dir}`, true);
      this.anims.resume();
      this.setFlipX(dir === 'side' && vx > 0);
    } else {
      this.play(`${this.kind}_walk`, true);
      this.setFlipX(vx > 0);
    }
  }
}
