import Phaser from 'phaser';
import { oiia, sfx } from './audio';

/** What the cat does on pets 1 to 9. The 10th pet makes it dance. */
const BUILD_UP = [
  'Mrrp?',
  '(The cat blinks at you, very slowly.)',
  'Mew.',
  '(It tilts its head. It is clearly thinking about something.)',
  'Mrrrrrrp.',
  '(Its tail starts swishing. Left. Right. Left.)',
  '(Its ears are... vibrating?)',
  '(The cat is humming. Quietly. Ominously.)',
  '(One more and something is going to happen. You can feel it.)',
];
export const PETS_TO_DANCE = BUILD_UP.length + 1;
const DANCE_MS = 4000;

/** The spin cycle: front, side, back, other side. Swapping views fast makes it look like it's spinning. */
const SPIN: [string, boolean][] = [['front', false], ['side', false], ['back', false], ['side', true]];

/** The farm cat. Pet it ten times. */
export class Cat {
  readonly sprite: Phaser.GameObjects.Sprite;
  pets = 0;
  dancing = false;
  private readonly homeY: number;

  constructor(private scene: Phaser.Scene, readonly tx: number, readonly ty: number, tile: number,
    private sparkle: (x: number, y: number, color: number, n: number) => void) {
    const x = (tx + 0.5) * tile, y = (ty + 0.5) * tile - 2;
    this.homeY = y;
    this.sprite = scene.add.sprite(x, y, 'cat', 'front').setDepth((ty + 1) * tile - 1);
    // Every so often it looks around.
    scene.time.addEvent({
      delay: 2400, loop: true, callback: () => {
        if (this.dancing || Math.random() < 0.5) return;
        const [frame, flip] = Phaser.Utils.Array.GetRandom([['front', false], ['side', false], ['side', true]] as [string, boolean][]);
        this.sprite.setFrame(frame).setFlipX(flip);
      },
    });
  }

  /** Returns what to say, or null when it starts dancing. */
  pet(): string | null {
    if (this.dancing) return null;
    this.pets++;
    if (this.pets % PETS_TO_DANCE === 0) {
      this.dance();
      return null;
    }
    this.sprite.setFrame('front').setFlipX(false);
    this.scene.tweens.add({ targets: this.sprite, y: this.homeY - 3, yoyo: true, duration: 90 });
    sfx('select');
    return BUILD_UP[(this.pets % PETS_TO_DANCE) - 1];
  }

  private dance(): void {
    this.dancing = true;
    const s = this.sprite;
    const scene = this.scene;
    oiia(DANCE_MS / 1000);
    // In front of everything while it dances, so the player's head never hides the show.
    const depth = s.depth;
    s.setDepth(9000);
    scene.cameras.main.shake(200, 0.003);
    let step = 0;
    const started = scene.time.now;
    // Spin, faster and faster, changing colour as it goes.
    const spin = scene.time.addEvent({
      delay: 16, loop: true, callback: () => {
        const t = (scene.time.now - started) / DANCE_MS;
        const every = Math.max(1, Math.round(5 - t * 4)); // frames per view: 5 at the start, 1 at full speed
        if (step++ % every) return;
        const [frame, flip] = SPIN[Math.floor(step / every) % SPIN.length];
        s.setFrame(frame).setFlipX(flip);
        s.setTint(Phaser.Display.Color.HSVToRGB(((scene.time.now - started) / 600) % 1, 0.45, 1).color);
      },
    });
    const bounce = scene.tweens.add({ targets: s, y: this.homeY - 10, yoyo: true, repeat: -1, duration: 130, ease: 'Sine.out' });
    const pulse = scene.tweens.add({ targets: s, scaleX: 1.25, scaleY: 0.85, yoyo: true, repeat: -1, duration: 160 });
    const sparkles = scene.time.addEvent({
      delay: 180, loop: true, callback: () => {
        const color = Phaser.Display.Color.HSVToRGB(Math.random(), 0.6, 1).color;
        this.sparkle(s.x + Phaser.Math.Between(-10, 10), s.y + Phaser.Math.Between(-12, 4), color, 4);
      },
    });
    scene.time.delayedCall(DANCE_MS, () => {
      spin.remove();
      sparkles.remove();
      bounce.stop();
      pulse.stop();
      s.setFrame('front').setFlipX(false).clearTint().setScale(1).setY(this.homeY).setDepth(depth);
      this.dancing = false;
    });
  }
}
