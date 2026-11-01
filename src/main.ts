import Phaser from 'phaser';
import { GAME_H, GAME_W } from './config';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { WorldScene } from './scenes/WorldScene';
import { UIScene } from './scenes/UIScene';
import { fullscreenOnFirstInput } from './fullscreen';
import { currentUser, uploadSave } from './cloud';
import { ui } from './bus';

/**
 * The game's size in pixels, chosen to match the window's shape so it fills the screen with no bars.
 * 960x640 is the minimum; wider screens get a wider view, taller ones a taller view. Always whole pixels:
 * fractional sizes make pixel art blurry and cause seams between tiles.
 */
function viewSize(): [number, number] {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  return aspect >= GAME_W / GAME_H ? [Math.round(GAME_H * aspect), GAME_H] : [GAME_W, Math.round(GAME_W / aspect)];
}

const [startW, startH] = viewSize();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: startW,
  height: startH,
  backgroundColor: '#1a1410',
  pixelArt: true,
  physics: { default: 'arcade', arcade: { debug: false } },
  input: { activePointers: 3 },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, TitleScene, WorldScene, UIScene],
});

fullscreenOnFirstInput();

// Every save (sleeping) also goes to the player's account when signed in. The copy on this device is
// always written first, so nothing is lost if the upload fails.
Save.onSave(s => {
  if (!currentUser()) return;
  void uploadSave(s).then(ok => ui.toast(ok ? 'Saved to your account.' : "Couldn't reach the cloud. Saved on this device."));
});

// Keep the game's shape matched to the window (rotating, resizing, entering fullscreen).
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const [w, h] = viewSize();
    if (w !== game.scale.width || h !== game.scale.height) game.scale.setGameSize(w, h);
  }, 100);
});

// Handy for debugging from the browser console.
(window as unknown as { game: Phaser.Game }).game = game;

// Read-only peek at the live save data from the console: `hollowbrook.state`.
import * as Save from './state';
Object.defineProperty(window, 'hollowbrook', { get: () => ({ state: Save.state }) });
