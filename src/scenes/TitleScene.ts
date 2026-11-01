import Phaser from 'phaser';
import { BED_SPAWN } from '../maps';
import { fromSaveData, loadSave, startNewGame, useSave, type GameState } from '../state';
import { askName } from '../namePrompt';
import { askAccount } from '../accountPrompt';
import { cloudEnabled, currentUser, downloadSave, refreshSession, signOut, uploadSave } from '../cloud';
import { T } from '../tiles';
import { isTouchDevice } from '../touch';

/** The newer of two saves (either may be missing). */
function newest(a: GameState | null, b: GameState | null): GameState | null {
  if (!a || !b) return a ?? b;
  return (b.savedAt ?? 0) > (a.savedAt ?? 0) ? b : a;
}

export class TitleScene extends Phaser.Scene {
  /** The signed-in player's cloud save, fetched once per page load (and after signing in). */
  private static cloudSave: GameState | null = null;
  private static cloudChecked = false;
  private static cloudError = false;
  private options: { label: string; run: () => void }[] = [];
  private texts: Phaser.GameObjects.Text[] = [];
  private cursor = 0;

  constructor() { super('Title'); }

  create(): void {
    const GAME_W = this.scale.width, GAME_H = this.scale.height;
    // Redraw the title screen if the window changes shape (rotating a phone, entering fullscreen).
    const onResize = () => this.time.delayedCall(50, () => this.scene.isActive() && this.scene.restart());
    this.scale.once(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    this.cursor = 0;
    this.texts = [];
    const S = 3;
    this.add.tileSprite(0, 0, GAME_W / S, GAME_H / S, 'tiles', `t${T.GRASS}`).setOrigin(0).setScale(S);
    const rnd = new Phaser.Math.RandomDataGenerator(['hollowbrook']);
    for (let i = 0; i < Math.round(40 * (GAME_W * GAME_H) / (960 * 640)); i++) {
      const x = rnd.between(0, Math.ceil(GAME_W / 48)) * 48, y = rnd.between(0, Math.ceil(GAME_H / 48)) * 48;
      const tile = rnd.pick([T.FLOWER, T.FLOWER, T.TREE, T.BUSH]);
      if (y > 120 && y < GAME_H - 120 && x > 120 && x < GAME_W - 120) continue;
      if (tile === T.TREE) this.add.image(x + 24, y + 48, 'tf_maple', rnd.pick(['big', 'medium'])).setOrigin(0.5, 1).setScale(S).setDepth(y);
      else this.add.image(x, y, 'tiles', `t${tile}`).setOrigin(0).setScale(S);
    }
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0a0805, 0.35).setOrigin(0);

    this.add.text(GAME_W / 2, 150, 'HOLLOWBROOK', {
      fontFamily: 'monospace', fontSize: '76px', fontStyle: 'bold', color: '#f4e4b0',
      stroke: '#3a2410', strokeThickness: 12,
    }).setOrigin(0.5).setShadow(0, 6, '#000', 0, true, true);
    this.add.text(GAME_W / 2, 220, 'a small farming & slime-bonking adventure', {
      fontFamily: 'monospace', fontSize: '20px', color: '#fff', stroke: '#2a1a0a', strokeThickness: 5,
    }).setOrigin(0.5);

    const hero = this.add.sprite(GAME_W / 2 - 70, 290, 'farmer_idle', 0).setScale(4).play('farmer_down');
    const slime = this.add.sprite(GAME_W / 2 + 70, 304, 'slime', '0').setScale(4).play('slime_idle');
    this.tweens.add({ targets: hero, y: 296, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.inOut' });
    this.tweens.add({ targets: slime, x: slime.x + 10, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });

    const local = loadSave();
    const save = newest(local, TitleScene.cloudSave);
    const user = currentUser();
    this.options = [];
    if (save) {
      const where = user && save === TitleScene.cloudSave ? ', from your account' : '';
      this.options.push({ label: `Continue  (${save.playerName}, Day ${save.day}${where})`, run: () => this.begin(false) });
    }
    this.options.push({ label: save ? 'New Game  (replaces save)' : 'New Game', run: () => this.newGame() });
    if (cloudEnabled) {
      this.options.push(user
        ? { label: 'Sign out', run: () => this.signOutAndRefresh() }
        : { label: 'Sign in / Create account', run: () => this.signInAndSync() });
      const status = user
        ? `Cloud saves on: signed in as ${user.email}${TitleScene.cloudError ? ' (cloud unreachable, using this device)' : ''}`
        : 'Saving on this device only. Sign in to keep your farm in the cloud.';
      this.add.text(GAME_W / 2, 390 + this.options.length * 46 + 6, status, {
        fontFamily: 'monospace', fontSize: '15px', color: user ? '#9be37a' : '#f4e4b0', stroke: '#2a1a0a', strokeThickness: 4,
      }).setOrigin(0.5);
      if (!TitleScene.cloudChecked) {
        TitleScene.cloudChecked = true;
        void this.syncAccount().then(() => this.scene.isActive() && this.scene.restart());
      }
    }

    this.options.forEach((opt, i) => {
      const t = this.add.text(GAME_W / 2, 390 + i * 46, opt.label, {
        fontFamily: 'monospace', fontSize: '26px', color: '#fff', stroke: '#2a1a0a', strokeThickness: 6,
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerover', () => { this.cursor = i; this.refresh(); });
      t.on('pointerdown', () => opt.run());
      this.texts.push(t);
    });

    this.add.text(GAME_W - 10, GAME_H - 8, 'Art: Tiny Farm RPG by Maeve Devs + drawn-in-code', {
      fontFamily: 'monospace', fontSize: '12px', color: '#f4e4b0', stroke: '#2a1a0a', strokeThickness: 3,
    }).setOrigin(1, 1);
    this.add.text(GAME_W / 2, GAME_H - 46, isTouchDevice()
      ? 'Tap to start. Drag on the left to move, USE and TALK on the right, tap the hotbar to pick items.'
      : 'Move: WASD / Arrows   Use item: Space   Talk/Interact: E   Items: 1-0, Q, wheel   Menu: Esc', {
        fontFamily: 'monospace', fontSize: '15px', color: '#f4e4b0', stroke: '#2a1a0a', strokeThickness: 4,
      }).setOrigin(0.5);

    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => {
      if (this.busy) return;
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

  /** True while a name or account box is open, so the menu ignores keys. */
  private busy = false;

  /** Asks for the player's name, then starts. Backing out returns to the title menu. */
  private async newGame(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const name = await askName(this.input.keyboard, currentUser()?.name ?? '');
    this.busy = false;
    if (name) this.begin(true, name);
  }

  /** Restores the session and fetches the cloud save. */
  private async syncAccount(): Promise<void> {
    TitleScene.cloudError = false;
    const user = await refreshSession();
    if (!user) { TitleScene.cloudSave = null; return; }
    const data = await downloadSave();
    if (data === undefined) TitleScene.cloudError = true;
    TitleScene.cloudSave = data ? fromSaveData(data) : null;
  }

  private async signInAndSync(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const ok = await askAccount(this.input.keyboard);
    if (ok) {
      await this.syncAccount();
      // Bring an existing farm on this device into the account, unless the account has a newer one.
      const local = loadSave();
      if (local && !TitleScene.cloudError && newest(local, TitleScene.cloudSave) === local && await uploadSave(local)) {
        TitleScene.cloudSave = local;
      }
    }
    this.busy = false;
    this.scene.restart();
  }

  private async signOutAndRefresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    await signOut();
    TitleScene.cloudSave = null;
    TitleScene.cloudError = false;
    this.busy = false;
    this.scene.restart();
  }

  private begin(fresh: boolean, name = 'Farmer'): void {
    const save = newest(loadSave(), TitleScene.cloudSave);
    if (fresh || !save) startNewGame(name);
    else useSave(save);
    this.scene.launch('UI');
    this.scene.start('World', { map: 'house', spawn: BED_SPAWN, facing: 'down', intro: fresh, newDay: !fresh });
  }
}
