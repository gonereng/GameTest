import Phaser from 'phaser';
import { createAnimations, generateTextures } from '../textures';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create(): void {
    generateTextures(this);
    createAnimations(this);
    this.scene.start('Title');
  }
}
