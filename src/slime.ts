import Phaser from 'phaser';

type Body = Phaser.Physics.Arcade.Body;

export class Slime extends Phaser.Physics.Arcade.Sprite {
  hp = 2;
  dead = false;
  private nextThink = 0;
  private knockUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'slime', '0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const b = this.body as Body;
    b.setSize(10, 7).setOffset(3, 8);
    b.setCollideWorldBounds(true);
    this.play('slime_idle');
    this.anims.setProgress(Math.random());
  }

  think(now: number, target: Phaser.GameObjects.Sprite, paused: boolean): void {
    if (this.dead) return;
    const b = this.body as Body;
    this.setDepth(this.y + 8);
    if (paused) { b.setVelocity(0, 0); return; }
    if (now < this.knockUntil) return;
    const dx = target.x - this.x, dy = target.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 72 && d > 1) {
      b.setVelocity((dx / d) * 34, (dy / d) * 34);
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
  damage(dx: number, dy: number, now: number): boolean {
    this.hp--;
    this.knock(dx, dy, now);
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => this.active && this.clearTint());
    if (this.hp <= 0) this.dead = true;
    return this.dead;
  }
}
