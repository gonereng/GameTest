import Phaser from 'phaser';

/** Event bus between the world scene and the UI scene. */
export const bus = new Phaser.Events.EventEmitter();

/** True while a dialogue box or menu has focus; the world pauses. */
export const modal = { open: false, openedAt: 0, closedAt: 0 };

export interface Choice {
  label: string;
  action?: () => void;
}

export interface DialogueOpts {
  speaker?: string;
  lines: string[];
  choices?: Choice[];
  onClose?: () => void;
}

export const ui = {
  dialogue: (opts: DialogueOpts) => bus.emit('dialogue', opts),
  toast: (text: string) => bus.emit('toast', text),
  shop: () => bus.emit('shop'),
  sell: () => bus.emit('sell'),
  location: (name: string) => bus.emit('location', name),
};
