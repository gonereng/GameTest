export type CropId = 'carrot' | 'turnip' | 'moonmelon';
export type ItemId =
  | 'hoe' | 'can' | 'sword'
  | 'seed_carrot' | 'seed_turnip' | 'seed_moonmelon'
  | 'carrot' | 'turnip' | 'moonmelon'
  | 'gel' | 'berry' | 'mushroom' | 'bread' | 'suit';

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
  seed_carrot: { id: 'seed_carrot', name: 'Carrot Seeds', kind: 'seed', crop: 'carrot', price: 15, desc: 'Ready in 3 days. Sells for 35g.' },
  seed_turnip: { id: 'seed_turnip', name: 'Turnip Seeds', kind: 'seed', crop: 'turnip', price: 25, desc: 'Ready in 5 days. Sells for 70g.' },
  seed_moonmelon: { id: 'seed_moonmelon', name: 'Moonmelon Seeds', kind: 'seed', crop: 'moonmelon', price: 60, desc: 'Ready in 8 days. Sells for 220g.' },
  carrot: { id: 'carrot', name: 'Carrot', kind: 'produce', sell: 35, energy: 12, desc: 'Crunchy.' },
  turnip: { id: 'turnip', name: 'Turnip', kind: 'produce', sell: 70, energy: 18, desc: 'Peppery and round.' },
  moonmelon: { id: 'moonmelon', name: 'Moonmelon', kind: 'produce', sell: 220, energy: 40, heal: 1, desc: 'It hums quietly at night.' },
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
  color: string;
}

export const CROPS: Record<CropId, CropDef> = {
  carrot: { id: 'carrot', days: 3, produce: 'carrot', color: '#e8862a' },
  turnip: { id: 'turnip', days: 5, produce: 'turnip', color: '#9a4ab0' },
  moonmelon: { id: 'moonmelon', days: 8, produce: 'moonmelon', color: '#6fc8b0' },
};
