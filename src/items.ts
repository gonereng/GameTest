export type CropId = 'strawberry' | 'onion' | 'potato' | 'leek' | 'moonmelon';
export type ItemId =
  | 'hoe' | 'can' | 'sword'
  | 'seed_strawberry' | 'seed_onion' | 'seed_potato' | 'seed_leek' | 'seed_moonmelon'
  | 'strawberry' | 'onion' | 'potato' | 'leek' | 'moonmelon'
  | 'gel' | 'berry' | 'mushroom' | 'bread' | 'suit' | 'egg' | 'golden_egg';

export type ItemKind = 'tool' | 'seed' | 'produce' | 'material' | 'forage' | 'food';

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: ItemKind;
  desc: string;
  /** Price when shipped. */
  sell?: number;
  /** Price in the shop. */
  price?: number;
  crop?: CropId;
  energy?: number;
  heal?: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  hoe: { id: 'hoe', name: 'Hoe', kind: 'tool', desc: 'Turns grass on your farm into soil.' },
  can: { id: 'can', name: 'Watering Can', kind: 'tool', desc: 'Watered crops grow overnight.' },
  sword: { id: 'sword', name: 'Rusty Sword', kind: 'tool', desc: 'Good enough for slimes.' },
  seed_strawberry: { id: 'seed_strawberry', name: 'Strawberry Seeds', kind: 'seed', crop: 'strawberry', price: 15, desc: 'Ready in 3 days. Sells for 35g.' },
  seed_onion: { id: 'seed_onion', name: 'Onion Seeds', kind: 'seed', crop: 'onion', price: 20, desc: 'Ready in 4 days. Sells for 50g.' },
  seed_potato: { id: 'seed_potato', name: 'Potato Seeds', kind: 'seed', crop: 'potato', price: 25, desc: 'Ready in 5 days. Sells for 70g.' },
  seed_leek: { id: 'seed_leek', name: 'Leek Seeds', kind: 'seed', crop: 'leek', price: 35, desc: 'Ready in 6 days. Sells for 100g.' },
  seed_moonmelon: { id: 'seed_moonmelon', name: 'Moonmelon Seeds', kind: 'seed', crop: 'moonmelon', price: 60, desc: 'Ready in 8 days. Sells for 220g.' },
  strawberry: { id: 'strawberry', name: 'Strawberry', kind: 'produce', sell: 35, energy: 12, desc: 'Sweet and a little bit smug.' },
  onion: { id: 'onion', name: 'Onion', kind: 'produce', sell: 50, energy: 14, desc: 'Has layers.' },
  potato: { id: 'potato', name: 'Potato', kind: 'produce', sell: 70, energy: 18, desc: 'Dependable.' },
  leek: { id: 'leek', name: 'Leek', kind: 'produce', sell: 100, energy: 20, desc: 'Fancy onion.' },
  moonmelon: { id: 'moonmelon', name: 'Moonmelon', kind: 'produce', sell: 220, energy: 40, heal: 1, desc: 'It hums quietly at night.' },
  egg: { id: 'egg', name: 'Egg', kind: 'produce', sell: 25, energy: 12, desc: 'Fresh from a chicken. Still warm.' },
  golden_egg: { id: 'golden_egg', name: 'Golden Egg', kind: 'produce', sell: 200, desc: 'Shiny, heavy, and slightly smug. Do not eat.' },
  gel: { id: 'gel', name: 'Slime Gel', kind: 'material', sell: 15, desc: 'Wobbly. Somebody buys this stuff.' },
  berry: { id: 'berry', name: 'Wild Berries', kind: 'forage', sell: 10, energy: 10, desc: 'Found in Mossy Woods.' },
  mushroom: { id: 'mushroom', name: 'Woodcap', kind: 'forage', sell: 25, energy: 15, heal: 1, desc: 'A sturdy forest mushroom.' },
  suit: { id: 'suit', name: 'Slime Suit', kind: 'tool', desc: 'Hold it to become a slime. Mostly.' },
  bread: { id: 'bread', name: 'Fresh Bread', kind: 'food', price: 40, energy: 45, heal: 1, desc: 'Restores lots of energy.' },
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
}

export const CROPS: Record<CropId, CropDef> = {
  strawberry: { id: 'strawberry', days: 3, produce: 'strawberry', seed: 'seed_strawberry', frames: 6, sheetRow: 1 },
  onion: { id: 'onion', days: 4, produce: 'onion', seed: 'seed_onion', frames: 6, sheetRow: 7 },
  potato: { id: 'potato', days: 5, produce: 'potato', seed: 'seed_potato', frames: 7, sheetRow: 5 },
  leek: { id: 'leek', days: 6, produce: 'leek', seed: 'seed_leek', frames: 6, sheetRow: 3 },
  moonmelon: { id: 'moonmelon', days: 8, produce: 'moonmelon', seed: 'seed_moonmelon', frames: 4 },
};

/** Old item ids from saves made before the crops changed. */
export const RENAMED_ITEMS: Record<string, ItemId> = {
  carrot: 'strawberry', turnip: 'potato', seed_carrot: 'seed_strawberry', seed_turnip: 'seed_potato',
};
