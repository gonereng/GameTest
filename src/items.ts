export type CropId = 'strawberry' | 'onion' | 'potato' | 'leek' | 'moonmelon';
export type Season = 0 | 1 | 2 | 3;
export const SEASON_NAMES = ['Spring', 'Summer', 'Fall', 'Winter'] as const;
export const DAYS_PER_SEASON = 28;
export type Buff = 'speed' | 'strength';
export type DishId = 'soup' | 'omelette' | 'tart' | 'stew' | 'pie' | 'honeywine' | 'ale';
export type ItemId =
  | 'hoe' | 'can' | 'sword'
  | 'seed_strawberry' | 'seed_onion' | 'seed_potato' | 'seed_leek' | 'seed_moonmelon'
  | 'strawberry' | 'onion' | 'potato' | 'leek' | 'moonmelon'
  | 'gel' | 'berry' | 'mushroom' | 'bread' | 'suit' | 'egg' | 'golden_egg' | 'milk' | 'sprinkler' | 'core' | 'tophat' | 'cake'
  | DishId;

export type ItemKind = 'tool' | 'seed' | 'produce' | 'material' | 'forage' | 'food' | 'placeable';

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: ItemKind;
  desc: string;
  /** Price when shipped. */
  sell?: number;
  /** Price in the shop. */
  price?: number;
  /** Slime Gel the shop also wants for it. */
  gel?: number;
  crop?: CropId;
  energy?: number;
  heal?: number;
  /** Eating it gives this buff until bedtime. */
  buff?: Buff;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  hoe: { id: 'hoe', name: 'Hoe', kind: 'tool', desc: 'Turns grass on your farm into soil.' },
  can: { id: 'can', name: 'Watering Can', kind: 'tool', desc: 'Watered crops grow overnight.' },
  sword: { id: 'sword', name: 'Rusty Sword', kind: 'tool', desc: 'Good enough for slimes.' },
  seed_strawberry: { id: 'seed_strawberry', name: 'Strawberry Seeds', kind: 'seed', crop: 'strawberry', price: 15, desc: 'Spring and summer. Ready in 3 days. Sells for 35g.' },
  seed_onion: { id: 'seed_onion', name: 'Onion Seeds', kind: 'seed', crop: 'onion', price: 20, desc: 'Spring and fall. Ready in 4 days. Sells for 50g.' },
  seed_potato: { id: 'seed_potato', name: 'Potato Seeds', kind: 'seed', crop: 'potato', price: 25, desc: 'Spring and summer. Ready in 5 days. Sells for 70g.' },
  seed_leek: { id: 'seed_leek', name: 'Leek Seeds', kind: 'seed', crop: 'leek', price: 35, desc: 'Fall and winter. Ready in 6 days. Sells for 100g.' },
  seed_moonmelon: { id: 'seed_moonmelon', name: 'Moonmelon Seeds', kind: 'seed', crop: 'moonmelon', price: 60, desc: 'Any season: it grows by moonlight. Ready in 8 days. Sells for 220g.' },
  strawberry: { id: 'strawberry', name: 'Strawberry', kind: 'produce', sell: 35, energy: 12, desc: 'Sweet and a little bit smug.' },
  onion: { id: 'onion', name: 'Onion', kind: 'produce', sell: 50, energy: 14, desc: 'Has layers.' },
  potato: { id: 'potato', name: 'Potato', kind: 'produce', sell: 70, energy: 18, desc: 'Dependable.' },
  leek: { id: 'leek', name: 'Leek', kind: 'produce', sell: 100, energy: 20, desc: 'Fancy onion.' },
  moonmelon: { id: 'moonmelon', name: 'Moonmelon', kind: 'produce', sell: 220, energy: 40, heal: 1, desc: 'It hums quietly at night.' },
  egg: { id: 'egg', name: 'Egg', kind: 'produce', sell: 25, energy: 12, desc: 'Fresh from a chicken. Still warm.' },
  golden_egg: { id: 'golden_egg', name: 'Golden Egg', kind: 'produce', sell: 200, desc: 'Shiny, heavy, and slightly smug. Do not eat.' },
  gel: { id: 'gel', name: 'Slime Gel', kind: 'material', sell: 15, desc: 'Wobbly. Somebody buys this stuff.' },
  berry: { id: 'berry', name: 'Wild Berries', kind: 'forage', sell: 10, energy: 10, desc: 'Found in the Whispering Woods.' },
  mushroom: { id: 'mushroom', name: 'Woodcap', kind: 'forage', sell: 25, energy: 15, heal: 1, desc: 'A sturdy forest mushroom.' },
  suit: { id: 'suit', name: 'Slime Suit', kind: 'tool', desc: 'Hold it to become a slime. Mostly.' },
  bread: { id: 'bread', name: 'Fresh Bread', kind: 'food', price: 40, energy: 45, heal: 1, desc: 'Restores lots of energy.' },
  milk: { id: 'milk', name: 'Milk', kind: 'produce', sell: 60, energy: 25, desc: 'From Clementine. She would like you to know it was her idea.' },
  core: { id: 'core', name: 'Slime Core', kind: 'material', sell: 40, desc: 'The hard, glowing middle of a Deep Woods slime. Bram uses them for upgrades.' },
  soup: { id: 'soup', name: 'Veggie Soup', kind: 'food', sell: 150, energy: 60, heal: 1, desc: 'Potato and onion. Warm all the way down.' },
  omelette: { id: 'omelette', name: 'Omelette', kind: 'food', sell: 110, energy: 50, buff: 'speed', desc: 'Egg and milk. Makes you Fast until bedtime.' },
  tart: { id: 'tart', name: 'Berry Tart', kind: 'food', sell: 160, energy: 40, heal: 2, desc: "Pip's recipe. Sticky in the best way." },
  stew: { id: 'stew', name: 'Moon Stew', kind: 'food', sell: 420, energy: 100, heal: 3, buff: 'strength', desc: "Orla's recipe. Makes you Strong until bedtime." },
  pie: { id: 'pie', name: 'Leek Pie', kind: 'food', sell: 230, energy: 70, buff: 'strength', desc: "Bram's recipe. Makes you Strong until bedtime." },
  tophat: { id: 'tophat', name: 'Tiny Top Hat', kind: 'tool', price: 150, desc: 'Very small. Very distinguished. Cow-sized.' },
  cake: { id: 'cake', name: 'Harvest Cake', kind: 'food', sell: 500, energy: 100, heal: 3, desc: "Hazel's legendary Harvest Cake. Ten eggs' worth of glory." },
  honeywine: { id: 'honeywine', name: 'Honey-Wine', kind: 'food', sell: 90, energy: 30, desc: "Sweet berry mead, the way Barnaby likes it. The way everyone likes it." },
  ale: { id: 'ale', name: 'Root Ale', kind: 'food', sell: 80, energy: 25, desc: 'Brewed from potatoes. Earthy, honest, slightly suspicious.' },
  sprinkler: { id: 'sprinkler', name: 'Sprinkler', kind: 'placeable', price: 120, gel: 2, desc: 'Place it on farm grass. Waters the 8 tiles around it every morning.' },
};

export const ITEM_ORDER = Object.keys(ITEMS) as ItemId[];

export interface CropDef {
  id: CropId;
  days: number;
  produce: ItemId;
  seed: ItemId;
  /** Number of growth frames drawn, the last one being "ready to harvest". */
  frames: number;
  /** Row in the Tiny Farm crops sheet, or undefined for crops drawn in code. */
  sheetRow?: number;
  /** Seasons it grows in. Out of season it can't be planted, and it withers when its season ends. */
  seasons: Season[];
}

export const CROPS: Record<CropId, CropDef> = {
  strawberry: { id: 'strawberry', days: 3, produce: 'strawberry', seed: 'seed_strawberry', frames: 6, sheetRow: 1, seasons: [0, 1] },
  onion: { id: 'onion', days: 4, produce: 'onion', seed: 'seed_onion', frames: 6, sheetRow: 7, seasons: [0, 2] },
  potato: { id: 'potato', days: 5, produce: 'potato', seed: 'seed_potato', frames: 7, sheetRow: 5, seasons: [0, 1] },
  leek: { id: 'leek', days: 6, produce: 'leek', seed: 'seed_leek', frames: 6, sheetRow: 3, seasons: [2, 3] },
  moonmelon: { id: 'moonmelon', days: 8, produce: 'moonmelon', seed: 'seed_moonmelon', frames: 4, seasons: [0, 1, 2, 3] },
};

export interface Recipe {
  dish: DishId;
  needs: [ItemId, number][];
}

/** Cooked on the stove at home. You start knowing the first two; friends teach the rest. */
export const RECIPES: Recipe[] = [
  { dish: 'soup', needs: [['potato', 1], ['onion', 1]] },
  { dish: 'omelette', needs: [['egg', 1], ['milk', 1]] },
  { dish: 'tart', needs: [['strawberry', 1], ['berry', 2], ['egg', 1]] },
  { dish: 'pie', needs: [['leek', 1], ['egg', 1], ['milk', 1]] },
  { dish: 'stew', needs: [['moonmelon', 1], ['leek', 1], ['mushroom', 1]] },
  // Brewed at the hearth too, once Barnaby has shown you how (The Wayfarer's Rest, Act I).
  { dish: 'honeywine', needs: [['berry', 4]] },
  { dish: 'ale', needs: [['potato', 2]] },
];

export const STARTING_RECIPES: DishId[] = ['soup', 'omelette'];

/** Old item ids from saves made before the crops changed. */
export const RENAMED_ITEMS: Record<string, ItemId> = {
  carrot: 'strawberry', turnip: 'potato', seed_carrot: 'seed_strawberry', seed_turnip: 'seed_potato',
};

/** "Strawberry" -> "Strawberries", "Egg" -> "Eggs", "Wild Berries" stays as it is. */
export function plural(name: string): string {
  if (name.endsWith('s')) return name;
  if (/[^aeiou]y$/.test(name)) return name.slice(0, -1) + 'ies';
  return name + 's';
}

/** "1 Egg", "5 Eggs". */
export const countOf = (id: ItemId, n: number) => `${n} ${n === 1 ? ITEMS[id].name : plural(ITEMS[id].name)}`;
