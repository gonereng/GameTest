import Phaser from 'phaser';
import { createAnimations, generateTextures } from '../textures';

const PACK = 'assets/tiny-farm/';

/** Named frames inside the Tiny Farm sheets: [x, y, w, h]. */
const FRAMES: Record<string, Record<string, [number, number, number, number]>> = {
  tf_house: { home: [141, 2, 80, 96], shop: [0, 0, 80, 89] },
  tf_interior: {
    bed: [87, 8, 18, 34], fireplace: [115, 8, 26, 40], plant_red: [4, 1, 8, 15], plant_tree: [34, 0, 11, 16],
    picture: [18, 1, 12, 15], clock: [1, 18, 13, 13], window: [1, 48, 14, 16], rug: [0, 82, 48, 30],
    table: [68, 120, 24, 23], drawer: [96, 120, 16, 18],
  },
  tf_maple: { big: [96, 1, 32, 46], medium: [71, 14, 20, 33], stump: [137, 35, 14, 12] },
  tf_chest: { closed: [8, 3, 15, 13], open: [8, 18, 15, 14] },
};

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload(): void {
    const bar = this.add.rectangle(this.scale.width / 2 - 150, this.scale.height / 2, 0, 12, 0xf4e4b0).setOrigin(0, 0.5);
    this.load.on('progress', (v: number) => bar.setSize(300 * v, 12));
    this.load.spritesheet('farmer_idle', `${PACK}farmer_idle.png`, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('farmer_walk', `${PACK}farmer_walk.png`, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('chicken_red', `${PACK}chicken_red.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('chicken_blonde', `${PACK}chicken_blonde.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('chick', `${PACK}chick.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('cow', `${PACK}cow.png`, { frameWidth: 32, frameHeight: 32 });
    this.load.image('tf_crops', `${PACK}crops.png`);
    this.load.image('tf_house', `${PACK}house.png`);
    this.load.image('tf_interior', `${PACK}interior.png`);
    this.load.image('tf_maple', `${PACK}maple_tree.png`);
    this.load.image('tf_chest', `${PACK}chest.png`);
  }

  create(): void {
    for (const [key, frames] of Object.entries(FRAMES)) {
      const tex = this.textures.get(key);
      for (const [name, [x, y, w, h]] of Object.entries(frames)) tex.add(name, 0, x, y, w, h);
    }
    generateTextures(this);
    createAnimations(this);
    this.createPackAnimations();
    this.scene.start('Title');
  }

  private createPackAnimations(): void {
    // Farmer sheets: row 0 faces down, row 1 up, row 2 sideways (right).
    ['down', 'up', 'side'].forEach((dir, row) => {
      this.anims.create({
        key: `farmer_${dir}`,
        frames: this.anims.generateFrameNumbers('farmer_walk', { start: row * 6, end: row * 6 + 5 }),
        frameRate: 10, repeat: -1,
      });
      this.anims.create({
        key: `farmer_idle_${dir}`,
        frames: this.anims.generateFrameNumbers('farmer_idle', { start: row * 4, end: row * 4 + 3 }),
        frameRate: 4, repeat: -1,
      });
    });
    for (const key of ['chicken_red', 'chicken_blonde']) {
      this.anims.create({ key: `${key}_walk`, frames: this.anims.generateFrameNumbers(key, { start: 0, end: 3 }), frameRate: 6, repeat: -1 });
      this.anims.create({ key: `${key}_idle`, frames: this.anims.generateFrameNumbers(key, { start: 4, end: 7 }), frameRate: 3, repeat: -1 });
    }
    this.anims.create({ key: 'chick_walk', frames: this.anims.generateFrameNumbers('chick', { start: 0, end: 3 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: 'chick_idle', frames: this.anims.generateFrameNumbers('chick', { start: 4, end: 7 }), frameRate: 3, repeat: -1 });
    ['side', 'down', 'up'].forEach((dir, row) => {
      this.anims.create({ key: `cow_${dir}`, frames: this.anims.generateFrameNumbers('cow', { start: row * 4, end: row * 4 + 3 }), frameRate: 4, repeat: -1 });
    });
  }
}
