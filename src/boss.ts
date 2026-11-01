import Phaser from 'phaser';

type Body = Phaser.Physics.Arcade.Body;
export type BossMode = 'chase' | 'windup' | 'lunge' | 'split' | 'cry' | 'asleep' | 'dead';

export interface BossHost {
  /** Called when the boss splits into minions. Returns how many minions are still alive when polled. */
  onSplit(boss: Boss): void;
  minionsAlive(): number;
  /** Called when the minions merge back in; any still alive should be removed. */
  onRejoin(boss: Boss): void;
  onCry(boss: Boss): void;
  onDefeated(boss: Boss): void;
}

const SCALE = 3;
const TINT = 0xffffff;

/** Lord Gloopington III: all the stolen moonlight, curdled into one very large, very sad slime. */
export class Boss extends Phaser.Physics.Arcade.Sprite {
  readonly maxHp = 24;
  hp = 24;
  mode: BossMode = 'chase';
  private nextAction = 0;
  private modeUntil = 0;
  private split = false;
  private cried = false;
  private hurtUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, private host: BossHost) {
    super(scene, x, y, 'gloop', '0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setScale(SCALE).setTint(TINT);
    const b = this.body as Body;
    b.setSize(12, 8);
    b.setOffset(2, 7);
    b.setCollideWorldBounds(true);
    this.play('gloop_idle');
    this.nextAction = scene.time.now + 1800;
  }

  /** True while touching the boss should hurt. */
  get dangerous(): boolean {
    return this.mode === 'chase' || this.mode === 'windup' || this.mode === 'lunge';
  }

  think(now: number, target: Phaser.GameObjects.Sprite, paused: boolean): void {
    const b = this.body as Body;
    this.setDepth(this.y + 20);
    if (paused || this.mode === 'dead') { b.setVelocity(0, 0); return; }
    if (now < this.hurtUntil) return;
    const dx = target.x - this.x, dy = target.y - this.y;
    const d = Math.hypot(dx, dy) || 1;

    switch (this.mode) {
      case 'chase': {
        const speed = this.split ? 34 : 24;
        b.setVelocity((dx / d) * speed, (dy / d) * speed);
        this.anims.timeScale = 1.5;
        if (now > this.nextAction) {
          this.mode = 'windup';
          this.modeUntil = now + (this.split ? 450 : 650);
          b.setVelocity(0, 0);
          this.scene.tweens.add({ targets: this, scaleY: SCALE * 0.75, scaleX: SCALE * 1.15, duration: 250, yoyo: true });
          this.setTint(0xff9ad0);
        }
        break;
      }
      case 'windup':
        b.setVelocity(0, 0);
        if (now > this.modeUntil) {
          this.mode = 'lunge';
          this.modeUntil = now + 560;
          const speed = this.split ? 200 : 170;
          b.setVelocity((dx / d) * speed, (dy / d) * speed);
          this.setTint(TINT);
        }
        break;
      case 'lunge':
        if (now > this.modeUntil) {
          this.mode = 'chase';
          this.nextAction = now + (this.split ? 1500 : 2200);
        }
        break;
      case 'split':
        b.setVelocity(0, 0);
        if (now > this.modeUntil || this.host.minionsAlive() === 0) this.rejoin(now);
        break;
      case 'cry':
      case 'asleep':
        b.setVelocity(0, 0);
        this.anims.timeScale = this.mode === 'asleep' ? 0.3 : 0.6;
        break;
    }
    if (Math.abs(b.velocity.x) > 1) this.setFlipX(b.velocity.x < 0);
  }

  /** Returns true if the hit defeated him. */
  damage(dx: number, dy: number, now: number): boolean {
    if (this.mode === 'split' || this.mode === 'dead' || this.mode === 'asleep') return false;
    this.hp--;
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => this.active && this.setTint(this.mode === 'windup' ? 0xff9ad0 : TINT));
    if (this.dangerous) {
      const len = Math.hypot(dx, dy) || 1;
      (this.body as Body).setVelocity((dx / len) * 60, (dy / len) * 60);
      this.hurtUntil = now + 120;
    }
    if (!this.split && this.hp <= 16) {
      this.split = true;
      this.mode = 'split';
      this.modeUntil = now + 15000;
      this.setVisible(false);
      (this.body as Body).enable = false;
      this.host.onSplit(this);
      return false;
    }
    if (!this.cried && this.hp <= 8) {
      this.cried = true;
      this.mode = 'cry';
      this.host.onCry(this);
      return false;
    }
    if (this.hp <= 0) {
      this.mode = 'dead';
      this.host.onDefeated(this);
      return true;
    }
    return false;
  }

  private rejoin(now: number): void {
    // Every minion you defeated took a chunk of him with it, but he always comes back for the last phase.
    const defeated = 4 - this.host.minionsAlive();
    this.hp = Math.max(9, this.hp - defeated * 2);
    this.host.onRejoin(this);
    this.mode = 'chase';
    this.nextAction = now + 1200;
    this.setVisible(true);
    (this.body as Body).enable = true;
    this.setAlpha(0);
    this.scene.tweens.add({ targets: this, alpha: 1, duration: 400 });
  }

  /** The lullaby ending: he shrinks, falls asleep, and becomes a regular (happy) slime. */
  fallAsleep(): void {
    this.mode = 'asleep';
    this.scene.tweens.add({ targets: this, scale: 1, duration: 1800, ease: 'Sine.inOut' });
  }
}
