import Phaser from 'phaser';
import { GAME_H, GAME_W } from './config';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { WorldScene } from './scenes/WorldScene';
import { UIScene } from './scenes/UIScene';
import { fullscreenOnFirstInput } from './fullscreen';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#1a1410',
  pixelArt: true,
  physics: { default: 'arcade', arcade: { debug: false } },
  input: { activePointers: 3 },
  // EXPAND fills the whole screen: 960x640 is the minimum view, and wider or taller screens see more.
  scale: { mode: Phaser.Scale.EXPAND, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, TitleScene, WorldScene, UIScene],
});

fullscreenOnFirstInput();

// Handy for debugging from the browser console.
(window as unknown as { game: Phaser.Game }).game = game;

// Read-only peek at the live save data from the console: `hollowbrook.state`.
import * as Save from './state';
Object.defineProperty(window, 'hollowbrook', { get: () => ({ state: Save.state }) });
