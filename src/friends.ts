import { ITEMS, type DishId, type ItemId } from './items';
import { state, type Friendship } from './state';

/** The townspeople you can befriend. */
export type FriendId = 'orla' | 'pip' | 'bram';
export const FRIEND_NAMES: Record<FriendId, string> = { orla: 'Mayor Orla', pip: 'Pip', bram: 'Bram' };
export const isFriend = (id: string): id is FriendId => id in FRIEND_NAMES;

export const POINTS_PER_HEART = 50;
export const MAX_HEARTS = 5;
const TALK_POINTS = 8;

interface Tastes { loved: ItemId[]; liked: ItemId[]; disliked: ItemId[] }

const TASTES: Record<FriendId, Tastes> = {
  orla: { loved: ['milk', 'moonmelon', 'soup'], liked: ['leek', 'onion', 'bread', 'pie'], disliked: ['gel', 'core'] },
  pip: { loved: ['gel', 'strawberry', 'tart', 'golden_egg'], liked: ['berry', 'mushroom', 'egg', 'omelette'], disliked: ['onion', 'leek'] },
  bram: { loved: ['golden_egg', 'pie', 'stew'], liked: ['potato', 'mushroom', 'core', 'soup'], disliked: ['berry'] },
};

const REACTIONS: Record<FriendId, Record<'loved' | 'liked' | 'neutral' | 'disliked', string>> = {
  orla: {
    loved: 'Oh, {name}! This is exactly what the mayor needed. The whole town thanks you. Mostly me.',
    liked: 'How thoughtful! I shall put it on the town ledger as a civic donation.',
    neutral: 'Ah. A gift. Thank you, {name}.',
    disliked: "Oh. Hm. I'll... file that somewhere. Far away.",
  },
  pip: {
    loved: 'WHAT. For ME? This is the BEST DAY.',
    liked: 'Ooh! Thanks! I am going to keep it in my pocket.',
    neutral: 'Huh. Okay! Thanks!',
    disliked: 'Bleh. That tastes like grown-up food.',
  },
  bram: {
    loved: "...Now that's quality. Thank you, {name}.",
    liked: 'Good stuff. Appreciated.',
    neutral: 'Thanks.',
    disliked: "I'll pretend you didn't give me that.",
  },
};

const GIFT_POINTS = { loved: 40, liked: 20, neutral: 8, disliked: -10 };

/** What each friend gives you at 2 and 4 hearts. */
interface Reward { hearts: number; lines: string[]; give: () => void; summary: string }
const learn = (dish: DishId) => () => { if (!state.recipes.includes(dish)) state.recipes.push(dish); };

export const REWARDS: Record<FriendId, Reward[]> = {
  pip: [
    {
      hearts: 2, summary: 'Berry Tart recipe', give: learn('tart'),
      lines: ["You're my best grown-up friend. Here, my SECRET recipe: Berry Tart!", '(You learned to cook Berry Tart. Use the stove in your house.)'],
    },
    {
      hearts: 4, summary: '+1 heart', give: () => { state.maxHp = Math.min(10, state.maxHp + 1); state.hp = state.maxHp; },
      lines: ['I made you a charm out of slime gel. It is lucky. I tested it on Mom.', '(Your maximum hearts went up by one!)'],
    },
  ],
  orla: [
    {
      hearts: 2, summary: 'Moon Stew recipe', give: learn('stew'),
      lines: ['You have been a great help to the crossroads, {name}.', 'Here is the town\'s oldest recipe: Moon Stew. Very nourishing.', '(You learned to cook Moon Stew. Use the stove in your house.)'],
    },
    {
      hearts: 4, summary: "500g Farmer's Grant", give: () => { state.gold += 500; },
      lines: ["The town council (me) has voted you the Farmer's Grant!", '(You received 500g.)'],
    },
  ],
  bram: [
    {
      hearts: 2, summary: '10% off at the shop', give: () => {},
      lines: ["You're a regular now. Ten percent off everything.", '(Bram gives you 10% off from now on.)'],
    },
    {
      hearts: 4, summary: 'Leek Pie recipe and 20% off', give: learn('pie'),
      lines: ["Family recipe. Don't tell anyone where you got it: Leek Pie.", 'And make that twenty percent off.', '(You learned to cook Leek Pie, and Bram gives you 20% off.)'],
    },
  ],
};

export function friendship(id: FriendId): Friendship {
  return (state.friends[id] ??= { points: 0, talked: 0, gifted: 0, rewards: [] });
}

export function hearts(id: FriendId): number {
  return Math.min(MAX_HEARTS, Math.floor(friendship(id).points / POINTS_PER_HEART));
}

/** "♥♥♡♡♡" */
export function heartBar(id: FriendId): string {
  const h = hearts(id);
  return '♥'.repeat(h) + '♡'.repeat(MAX_HEARTS - h);
}

function addPoints(id: FriendId, n: number): void {
  const f = friendship(id);
  f.points = Math.max(0, Math.min(MAX_HEARTS * POINTS_PER_HEART, f.points + n));
}

/** The first chat each day raises friendship a little. */
export function chatted(id: FriendId): void {
  const f = friendship(id);
  if (f.talked === state.day) return;
  f.talked = state.day;
  addPoints(id, TALK_POINTS);
}

export function canGift(id: ItemId): boolean {
  const kind = ITEMS[id].kind;
  return kind !== 'tool' && kind !== 'placeable';
}

export function giftedToday(id: FriendId): boolean {
  return friendship(id).gifted === state.day;
}

/** Gives a gift and returns what they say. */
export function giveGift(id: FriendId, item: ItemId): string {
  const t = TASTES[id];
  const kind = t.loved.includes(item) ? 'loved' : t.liked.includes(item) ? 'liked' : t.disliked.includes(item) ? 'disliked' : 'neutral';
  friendship(id).gifted = state.day;
  chatted(id);
  addPoints(id, GIFT_POINTS[kind]);
  return REACTIONS[id][kind];
}

/** Rewards they have earned but not yet given. Marks them as given and applies them. */
export function claimRewards(id: FriendId): string[] {
  const f = friendship(id);
  const lines: string[] = [];
  for (const r of REWARDS[id]) {
    if (hearts(id) >= r.hearts && !f.rewards.includes(r.hearts)) {
      f.rewards.push(r.hearts);
      r.give();
      lines.push(...r.lines);
    }
  }
  return lines;
}

/** Bram's discount, as a fraction: 0, 0.1 or 0.2. */
export function shopDiscount(): number {
  const got = friendship('bram').rewards;
  return got.includes(4) ? 0.2 : got.includes(2) ? 0.1 : 0;
}

/** Lines for the menu's Friends page. */
export function friendsSummary(): string[] {
  return (Object.keys(FRIEND_NAMES) as FriendId[]).map(id => {
    const next = REWARDS[id].find(r => !friendship(id).rewards.includes(r.hearts));
    return `${FRIEND_NAMES[id].padEnd(11)} ${heartBar(id)}${next ? `   at ${next.hearts} hearts: ${next.summary}` : ''}`;
  });
}
