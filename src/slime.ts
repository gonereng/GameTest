import Phaser from 'phaser';

type Body = Phaser.Physics.Arcade.Body;

/** Deep Woods slimes: 2 = blue (tough), 3 = red (tough and hits for 2). */
export type SlimeTier = 1 | 2 | 3;
const TIER = {
  1: { hp: 2, chase: 34, sight: 72, texture: 'slime', power: 1 },
  2: { hp: 4, chase: 42, sight: 90, texture: 'slime_blue', power: 1 },
  3: { hp: 5, chase: 50, sight: 100, texture: 'slime_red', power: 2 },
} as const;

export class Slime extends Phaser.Physics.Arcade.Sprite {
  hp = 2;
  tier: SlimeTier = 1;
  /** Hearts lost when it touches you. */
  power = 1;
  dead = false;
  /** Pinned in place (by a friendly slime during the boss fight). */
  held = false;
  /** Part of the boss: ignores the Slime Suit disguise. */
  angry = false;
  private nextThink = 0;
  private knockUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, kind: 'slime' | 'gloop' = 'slime', tier: SlimeTier = 1) {
    const texture = kind === 'slime' ? TIER[tier].texture : kind;
    super(scene, x, y, texture, '0');
    this.tier = tier;
    this.hp = TIER[tier].hp;
    this.power = TIER[tier].power;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const b = this.body as Body;
    b.setSize(10, 7).setOffset(3, 8);
    b.setCollideWorldBounds(true);
    this.play(`${texture}_idle`);
    this.anims.setProgress(Math.random());
  }

  /** passive: the player is disguised, so just wander. */
  think(now: number, target: Phaser.GameObjects.Sprite, paused: boolean, passive = false): void {
    if (this.dead) return;
    const b = this.body as Body;
    this.setDepth(this.y + 8);
    if (paused || this.held) { b.setVelocity(0, 0); return; }
    if (now < this.knockUntil) return;
    const dx = target.x - this.x, dy = target.y - this.y;
    const d = Math.hypot(dx, dy);
    const { sight, chase } = TIER[this.tier];
    if (d < sight && d > 1 && (!passive || this.angry)) {
      b.setVelocity((dx / d) * chase, (dy / d) * chase);
      this.anims.timeScale = 2.2;
    } else {
      this.anims.timeScale = 1;
      if (now > this.nextThink) {
        this.nextThink = now + Phaser.Math.Between(700, 1800);
        if (Math.random() < 0.45) b.setVelocity(0, 0);
        else {
          const a = Math.random() * Math.PI * 2;
          b.setVelocity(Math.cos(a) * 18, Math.sin(a) * 18);
        }
      }
    }
    if (Math.abs(b.velocity.x) > 1) this.setFlipX(b.velocity.x < 0);
  }

  knock(dx: number, dy: number, now: number, speed = 170): void {
    const len = Math.hypot(dx, dy) || 1;
    (this.body as Body).setVelocity((dx / len) * speed, (dy / len) * speed);
    this.knockUntil = now + 220;
  }

  /** Returns true if this hit killed the slime. */
  damage(dx: number, dy: number, now: number, amount = 1): boolean {
    this.hp -= amount;
    this.knock(dx, dy, now);
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => this.active && this.clearTint());
    if (this.hp <= 0) this.dead = true;
    return this.dead;
  }
}
