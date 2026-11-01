/** Tile indices in the generated tileset texture. */
export const T = {
  GRASS: 0,
  FLOWER: 1,
  PATH: 2,
  WATER: 3,
  TREE: 4,
  WALL: 5,
  ROOF: 6,
  DOOR: 7,
  FENCE: 8,
  SOIL: 9,
  SOIL_WET: 10,
  ROCK: 11,
  FLOOR: 12,
  BED: 13,
  COUNTER: 14,
  BUSH: 15,
  BRIDGE: 16,
  BIN: 17,
  SIGN: 18,
  IN_WALL: 19,
  VOID: 20,
  WINDOW: 21,
  DARK_GRASS: 22,
  RUG: 23,
  SHELF: 24,
  TABLE: 25,
  DOOR_LOCKED: 26,
  CRATER: 27,
  HOLE: 28,
  JELLY_FLOOR: 29,
  ROOT_WALL: 30,
  JELLY_DOOR: 31,
  PEDESTAL: 32,
  LADDER: 33,
} as const;

export const TILE_COUNT = 34;

/** Tiles the player and monsters cannot walk through. */
export const SOLID: number[] = [
  T.WATER, T.TREE, T.WALL, T.ROOF, T.FENCE, T.ROCK, T.BED, T.COUNTER, T.BUSH,
  T.BIN, T.SIGN, T.IN_WALL, T.VOID, T.WINDOW, T.SHELF, T.TABLE, T.DOOR_LOCKED,
  T.CRATER, T.ROOT_WALL, T.JELLY_DOOR, T.PEDESTAL,
];
