import {
  CROPS, DAYS_PER_SEASON, ITEMS, RENAMED_ITEMS, SEASON_NAMES, STARTING_RECIPES,
  type Buff, type CropId, type DishId, type ItemId, type Season,
} from './items';
import { mulberry32 } from './rng';

export interface Stack {
  id: ItemId;
  qty: number;
}

export interface Soil {
  watered: boolean;
  crop?: { id: CropId; days: number };
}

export type Weather = 'sun' | 'rain';
export type ToolId = 'hoe' | 'can' | 'sword';

export interface Friendship {
  /** 50 points per heart, up to 5 hearts. */
  points: number;
  /** Day you last talked to them (the first chat each day counts). */
  talked: number;
  /** Day you last gave them a gift (one a day). */
  gifted: number;
  /** Heart rewards already given (2 and 4). */
  rewards: number[];
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
  /** crashDay: the day the story's countdown started (the day you agreed to help Gerald). */
  quest: { step: number; flags: Record<string, boolean>; crashDay: number; launchDay?: number };
  met: string[];
  shipped: number;
  /** Today's weather. Rain waters every crop on the farm in the morning. */
  weather: Weather;
  /** Sprinklers placed on the farm, keyed by "x,y". */
  sprinklers: string[];
  /** Friendship with the townspeople, keyed by NPC id. */
  friends: Record<string, Friendship>;
  /** Dishes you know how to cook. */
  recipes: DishId[];
  /** Buffs from food, until bedtime. */
  buffs: Partial<Record<Buff, boolean>>;
  /** Tool levels: 0 = starting tool, 1 = upgraded at Bram's. */
  upgrades: Record<ToolId, number>;
  /** Side quests from the townsfolk (see sidequests.ts): step numbers, plus Moo for Mayor's progress. */
  side: { hazel: number; mortimer: number; endorsed: string[]; pledges: string[]; debateDay?: number };
  /** The Wayfarer's Rest (src/inn.ts): story step, reputation, hearth warmth, tavern income, and who's been helped. */
  inn: {
    step: number; rep: number; warmth: number; earned: number;
    /** Story requests fulfilled and conversations had (by key). */
    done: string[];
    /** Names on the petition against the Chancellor (Act III). */
    signed: string[];
    /** Today's travelers in the common room and what they ordered. */
    travelers: { name: string; order: ItemId }[];
  };
}

export const HOTBAR_SIZE = 10;
/** Slots after buying the Backpack from Bram. */
export const BACKPACK_SIZE = 12;
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
    weather: 'sun',
    sprinklers: [],
    friends: {},
    recipes: [...STARTING_RECIPES],
    buffs: {},
    upgrades: { hoe: 0, can: 0, sword: 0 },
    side: { hazel: 0, mortimer: 0, endorsed: [], pledges: [] },
    inn: { step: 0, rep: 0, warmth: 0, earned: 0, done: [], signed: [], travelers: [] },
  };
}

/** The live game state. Other modules read it through this binding. */
export let state: GameState = newGame();

/** Facts about the current map that the UI needs, and what happened overnight. */
export const runtime = {
  map: 'house', indoor: true, withered: 0,
  /** Set while looking around someone else's farm. Nothing is saved during a visit. */
  visit: null as null | { name: string; code: string },
};

/** Your own game, put aside while visiting another farm. */
let home: GameState | null = null;

/**
 * Shows someone else's farm: their soil, crops, sprinklers and story, with your own bag and hearts.
 * Returns false if the farm data can't be used.
 */
export function startVisit(farm: Partial<GameState>, code: string): boolean {
  const v = fromSaveData({ ...farm, version: 1 });
  if (!v) return false;
  home ??= state;
  Object.assign(v, {
    inventory: home.inventory, selected: home.selected, hp: home.hp, maxHp: home.maxHp, energy: home.energy,
    maxEnergy: home.maxEnergy, gold: home.gold, upgrades: home.upgrades, buffs: home.buffs, minutes: 12 * 60,
  });
  state = v;
  runtime.visit = { name: v.playerName || 'Farmer', code };
  return true;
}

/** What visitors see of your farm: the same fields the server keeps from a save. */
export function farmView(): Partial<GameState> {
  const { version, playerName, day, soil, sprinklers, weather, quest, shipped, slimes } = state;
  return { version, playerName, day, soil, sprinklers, weather, quest, shipped, slimes };
}

/** Back to your own game, exactly as you left it. */
export function endVisit(): void {
  if (home) state = home;
  home = null;
  runtime.visit = null;
}

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
  if (runtime.visit) return; // never save someone else's farm as yours
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
  s.upgrades = { ...{ hoe: 0, can: 0, sword: 0 }, ...(s.upgrades as Partial<GameState['upgrades']>) };
  if (s.inventory.length < HOTBAR_SIZE) s.inventory = [...s.inventory, ...Array(HOTBAR_SIZE - s.inventory.length).fill(null)];
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

export function seasonOf(day: number): Season {
  return (Math.floor((day - 1) / DAYS_PER_SEASON) % 4) as Season;
}

/** "Spring 5": the season and the day within it. */
export function dateLabel(day: number): string {
  return `${SEASON_NAMES[seasonOf(day)]} ${((day - 1) % DAYS_PER_SEASON) + 1}`;
}

export function yearOf(day: number): number {
  return Math.floor((day - 1) / (DAYS_PER_SEASON * 4)) + 1;
}

export function inSeason(crop: CropId, day = state.day): boolean {
  return CROPS[crop].seasons.includes(seasonOf(day));
}

/** "Copper Hoe" once the hoe is upgraded, and so on. */
export function itemName(id: ItemId): string {
  if (id === 'hoe' && state.upgrades.hoe) return 'Copper Hoe';
  if (id === 'can' && state.upgrades.can) return 'Copper Watering Can';
  if (id === 'sword' && state.upgrades.sword) return 'Steel Sword';
  return ITEMS[id].name;
}

/** The 8 tiles around a sprinkler, as soil keys. */
export function sprinklerReach(key: string): string[] {
  const [x, y] = key.split(',').map(Number);
  const out: string[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.push(soilKey(x + dx, y + dy));
  return out;
}

/**
 * The weather for a day. About one day in five is rainy, but never while you're helping Gerald (the story's
 * nights should stay clear, and rain would water his Moonpatch for you). Story steps 2-8 are that stretch
 * (quest.ts: ASK to MIDNIGHT), from agreeing to help until he's back in the sky.
 */
export function rollWeather(day: number): Weather {
  const step = state.quest.step;
  if (day < 2 || (step >= 2 && step <= 8)) return 'sun';
  return mulberry32(day * 2654435761 + 977)() < 0.2 ? 'rain' : 'sun';
}

/** Moves to the next morning: watered crops grow, soil dries, forage respawns, then rain and sprinklers water. */
export function advanceDay(passedOut: boolean): void {
  for (const soil of Object.values(state.soil)) {
    if (soil.crop && soil.watered) soil.crop.days++;
    soil.watered = false;
  }
  state.day++;
  state.buffs = {};
  // A new season: crops that don't grow in it wither (the soil stays tilled).
  runtime.withered = 0;
  if ((state.day - 1) % DAYS_PER_SEASON === 0) {
    for (const soil of Object.values(state.soil)) {
      if (soil.crop && !inSeason(soil.crop.id)) { delete soil.crop; runtime.withered++; }
    }
  }
  state.weather = rollWeather(state.day);
  if (state.weather === 'rain') for (const soil of Object.values(state.soil)) soil.watered = true;
  for (const key of state.sprinklers) for (const k of sprinklerReach(key)) if (state.soil[k]) state.soil[k].watered = true;
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
