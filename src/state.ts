import { CROPS, ITEMS, RENAMED_ITEMS, type CropId, type ItemId } from './items';

export interface Stack {
  id: ItemId;
  qty: number;
}

export interface Soil {
  watered: boolean;
  crop?: { id: CropId; days: number };
}

export interface GameState {
  version: number;
  day: number;
  /** Minutes since midnight. The day runs from 6:00 (360) to 2:00 next day (1560). */
  minutes: number;
  gold: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  inventory: (Stack | null)[];
  selected: number;
  /** Farm soil keyed by "x,y". */
  soil: Record<string, Soil>;
  /** Forage spots already picked today, keyed by "x,y". */
  forage: Record<string, boolean>;
  slimes: number;
  /** What the townspeople call you. */
  playerName: string;
  /** When this was last saved (ms since 1970), to pick the newer of the cloud and local saves. */
  savedAt: number;
  /** Story progress: see quest.ts for the steps and flags. */
  quest: { step: number; flags: Record<string, boolean>; crashDay: number };
  met: string[];
  shipped: number;
}

export const HOTBAR_SIZE = 10;
export const MAX_STACK = 99;
export const DAY_START = 6 * 60;
export const DAY_END = 26 * 60;
const SAVE_KEY = 'hollowbrook-save-v1';
const BACKUP_KEY = 'hollowbrook-save-backup-v1';

export function newGame(): GameState {
  const inventory: (Stack | null)[] = Array(HOTBAR_SIZE).fill(null);
  inventory[0] = { id: 'hoe', qty: 1 };
  inventory[1] = { id: 'can', qty: 1 };
  inventory[2] = { id: 'sword', qty: 1 };
  inventory[3] = { id: 'seed_strawberry', qty: 8 };
  return {
    version: 1,
    day: 1,
    minutes: DAY_START,
    gold: 120,
    hp: 5,
    maxHp: 5,
    energy: 100,
    maxEnergy: 100,
    inventory,
    selected: 0,
    soil: {},
    forage: {},
    slimes: 0,
    playerName: 'Farmer',
    savedAt: 0,
    quest: { step: 0, flags: {}, crashDay: 0 },
    met: [],
    shipped: 0,
  };
}

/** The live game state. Other modules read it through this binding. */
export let state: GameState = newGame();

/** Facts about the current map that the UI needs. */
export const runtime = { map: 'house', indoor: true };

export function startNewGame(playerName = 'Farmer'): void {
  state = newGame();
  state.playerName = playerName;
}

/** Called after every save, e.g. to upload it to the cloud. */
let afterSave: ((s: GameState) => void) | null = null;
export function onSave(fn: (s: GameState) => void): void {
  afterSave = fn;
}

export function save(): void {
  state.savedAt = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable (private mode); the game still runs */
  }
  afterSave?.(state);
}

/** Turns a save from anywhere (this device or the cloud) into a full, current game state. */
export function fromSaveData(data: Partial<GameState>): GameState | null {
  if (!data || data.version !== 1) return null;
  return migrate({ ...newGame(), ...data });
}

/** Makes a save the live game, and keeps a copy on this device. */
export function useSave(s: GameState): void {
  state = s;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** A second save made at the start of the story's last day, so a failed run can be retried. */
export function saveBackup(): void {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function restoreBackup(): boolean {
  const s = loadSave(BACKUP_KEY);
  if (!s) return false;
  state = s;
  save();
  return true;
}

export function loadSave(key = SAVE_KEY): GameState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<GameState>;
    if (data.version !== 1) return null;
    return migrate({ ...newGame(), ...data });
  } catch {
    return null;
  }
}

/** Updates saves from older versions of the game. */
function migrate(s: GameState): GameState {
  const rename = (id: string) => (RENAMED_ITEMS[id] ?? id) as ItemId;
  s.inventory = s.inventory.map(st => (st && ITEMS[rename(st.id)] ? { ...st, id: rename(st.id) } : null));
  for (const soil of Object.values(s.soil)) {
    if (soil.crop) {
      const id = rename(soil.crop.id) as CropId;
      if (CROPS[id]) soil.crop.id = id;
      else delete soil.crop;
    }
  }
  return s;
}


export const soilKey = (x: number, y: number) => `${x},${y}`;

/** Adds items, stacking where possible. Returns false (and adds nothing) if they don't fit. */
export function addItem(id: ItemId, qty = 1): boolean {
  const stackable = ITEMS[id].kind !== 'tool';
  const inv = state.inventory;
  let room = 0;
  for (const s of inv) {
    if (!s) room += stackable ? MAX_STACK : 1;
    else if (stackable && s.id === id) room += MAX_STACK - s.qty;
  }
  if (room < qty) return false;
  let left = qty;
  if (stackable) {
    for (const s of inv) {
      if (s && s.id === id && left > 0) {
        const n = Math.min(left, MAX_STACK - s.qty);
        s.qty += n;
        left -= n;
      }
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (!inv[i]) {
      const n = stackable ? Math.min(left, MAX_STACK) : 1;
      inv[i] = { id, qty: n };
      left -= n;
    }
  }
  return true;
}

export function countItem(id: ItemId): number {
  return state.inventory.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0);
}

/** Removes qty of an item from anywhere in the bag. Returns false (removing nothing) if there aren't enough. */
export function removeItem(id: ItemId, qty: number): boolean {
  if (countItem(id) < qty) return false;
  let left = qty;
  state.inventory.forEach((s, i) => {
    if (s && s.id === id && left > 0) {
      const n = Math.min(left, s.qty);
      left -= n;
      removeAt(i, n);
    }
  });
  return true;
}

export function removeAt(slot: number, qty = 1): void {
  const s = state.inventory[slot];
  if (!s) return;
  s.qty -= qty;
  if (s.qty <= 0) state.inventory[slot] = null;
}

export function isMature(soil: Soil): boolean {
  return !!soil.crop && soil.crop.days >= CROPS[soil.crop.id].days;
}

/** Which growth frame to draw: 0 = just planted, frames-1 = ready to harvest. */
export function cropFrame(soil: Soil): number {
  if (!soil.crop) return 0;
  const def = CROPS[soil.crop.id];
  if (isMature(soil)) return def.frames - 1;
  return Math.min(def.frames - 2, Math.floor((soil.crop.days / def.days) * (def.frames - 1)));
}

/** Moves to the next morning: watered crops grow, soil dries, forage respawns. */
export function advanceDay(passedOut: boolean): void {
  for (const soil of Object.values(state.soil)) {
    if (soil.crop && soil.watered) soil.crop.days++;
    soil.watered = false;
  }
  state.day++;
  state.minutes = DAY_START;
  state.forage = {};
  state.hp = state.maxHp;
  state.energy = passedOut ? Math.ceil(state.maxEnergy / 2) : state.maxEnergy;
}

export function formatTime(minutes: number): string {
  const m = Math.floor((minutes % 60) / 10) * 10;
  const h24 = Math.floor(minutes / 60) % 24;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}
