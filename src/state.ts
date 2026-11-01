import { CROPS, ITEMS, type CropId, type ItemId } from './items';

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
  met: string[];
  shipped: number;
}

export const HOTBAR_SIZE = 10;
export const MAX_STACK = 99;
export const DAY_START = 6 * 60;
export const DAY_END = 26 * 60;
const SAVE_KEY = 'hollowbrook-save-v1';

export function newGame(): GameState {
  const inventory: (Stack | null)[] = Array(HOTBAR_SIZE).fill(null);
  inventory[0] = { id: 'hoe', qty: 1 };
  inventory[1] = { id: 'can', qty: 1 };
  inventory[2] = { id: 'sword', qty: 1 };
  inventory[3] = { id: 'seed_carrot', qty: 8 };
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
    met: [],
    shipped: 0,
  };
}

/** The live game state. Other modules read it through this binding. */
export let state: GameState = newGame();

/** Facts about the current map that the UI needs. */
export const runtime = { map: 'house', indoor: true };

export function startNewGame(): void {
  state = newGame();
}

export function save(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable (private mode); the game still runs */
  }
}

export function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<GameState>;
    if (data.version !== 1) return null;
    return { ...newGame(), ...data };
  } catch {
    return null;
  }
}

export function continueGame(): boolean {
  const s = loadSave();
  if (!s) return false;
  state = s;
  return true;
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

export function removeAt(slot: number, qty = 1): void {
  const s = state.inventory[slot];
  if (!s) return;
  s.qty -= qty;
  if (s.qty <= 0) state.inventory[slot] = null;
}

export function isMature(soil: Soil): boolean {
  return !!soil.crop && soil.crop.days >= CROPS[soil.crop.id].days;
}

/** 0 = seeds, 1 = sprout, 2 = growing, 3 = ready to harvest. */
export function cropStage(soil: Soil): number {
  if (!soil.crop) return 0;
  if (isMature(soil)) return 3;
  return Math.min(2, Math.floor((soil.crop.days / CROPS[soil.crop.id].days) * 3));
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
