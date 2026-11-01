import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { BED_SPAWN } from '../maps';
import { continueGame, loadSave, startNewGame } from '../state';
import { T } from '../tiles';
import { isTouchDevice } from '../touch';

export class TitleScene extends Phaser.Scene {
  private options: { label: string; run: () => void }[] = [];
  private texts: Phaser.GameObjects.Text[] = [];
  private cursor = 0;

  constructor() { super('Title'); }

  create(): void {
    this.cursor = 0;
    this.texts = [];
    const S = 3;
    this.add.tileSprite(0, 0, GAME_W / S, GAME_H / S, 'tiles', `t${T.GRASS}`).setOrigin(0).setScale(S);
    const rnd = new Phaser.Math.RandomDataGenerator(['hollowbrook']);
    for (let i = 0; i < 40; i++) {
      const x = rnd.between(0, 19) * 48, y = rnd.between(0, 13) * 48;
      const tile = rnd.pick([T.FLOWER, T.FLOWER, T.TREE, T.BUSH]);
      if (y > 120 && y < 520 && x > 120 && x < 840) continue;
      this.add.image(x, y, 'tiles', `t${tile}`).setOrigin(0).setScale(S);
    }
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0a0805, 0.35).setOrigin(0);

    this.add.text(GAME_W / 2, 150, 'HOLLOWBROOK', {
      fontFamily: 'monospace', fontSize: '76px', fontStyle: 'bold', color: '#f4e4b0',
      stroke: '#3a2410', strokeThickness: 12,
    }).setOrigin(0.5).setShadow(0, 6, '#000', 0, true, true);
    this.add.text(GAME_W / 2, 220, 'a small farming & slime-bonking adventure', {
      fontFamily: 'monospace', fontSize: '20px', color: '#fff', stroke: '#2a1a0a', strokeThickness: 5,
    }).setOrigin(0.5);

    const hero = this.add.sprite(GAME_W / 2 - 70, 300, 'player', 'down_0').setScale(4).play('player_down');
    const slime = this.add.sprite(GAME_W / 2 + 70, 304, 'slime', '0').setScale(4).play('slime_idle');
    this.tweens.add({ targets: hero, y: 296, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.inOut' });
    this.tweens.add({ targets: slime, x: slime.x + 10, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });

    const save = loadSave();
    this.options = [];
    if (save) this.options.push({ label: `Continue  (Day ${save.day}, ${save.gold}g)`, run: () => this.begin(false) });
    this.options.push({ label: save ? 'New Game  (replaces save)' : 'New Game', run: () => this.begin(true) });

    this.options.forEach((opt, i) => {
      const t = this.add.text(GAME_W / 2, 390 + i * 46, opt.label, {
        fontFamily: 'monospace', fontSize: '26px', color: '#fff', stroke: '#2a1a0a', strokeThickness: 6,
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerover', () => { this.cursor = i; this.refresh(); });
      t.on('pointerdown', () => opt.run());
      this.texts.push(t);
    });

    this.add.text(GAME_W / 2, GAME_H - 46, isTouchDevice()
      ? 'Tap to start. Drag on the left to move, USE and TALK on the right, tap the hotbar to pick items.'
      : 'Move: WASD / Arrows   Use item: Space   Talk/Interact: E   Items: 1-0, Q, wheel   Menu: Esc', {
        fontFamily: 'monospace', fontSize: '15px', color: '#f4e4b0', stroke: '#2a1a0a', strokeThickness: 4,
      }).setOrigin(0.5);

    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => {
      if (['ArrowUp', 'KeyW'].includes(e.code)) this.cursor = (this.cursor + this.options.length - 1) % this.options.length;
      else if (['ArrowDown', 'KeyS'].includes(e.code)) this.cursor = (this.cursor + 1) % this.options.length;
      else if (['Space', 'Enter', 'KeyE', 'KeyJ'].includes(e.code)) { this.options[this.cursor].run(); return; }
      this.refresh();
    });
    this.refresh();
  }

  private refresh(): void {
    this.texts.forEach((t, i) => {
      const sel = i === this.cursor;
      t.setText(sel ? `> ${this.options[i].label} <` : this.options[i].label);
      t.setColor(sel ? '#ffe27a' : '#ffffff');
    });
  }

  private begin(fresh: boolean): void {
    if (fresh || !continueGame()) startNewGame();
    this.scene.launch('UI');
    this.scene.start('World', { map: 'house', spawn: BED_SPAWN, facing: 'down', intro: fresh, newDay: !fresh });
  }
}
