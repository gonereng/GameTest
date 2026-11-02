import Phaser from 'phaser';
import { ui, type Choice, type DialogueOpts } from './bus';
import { ITEMS, countOf, type DishId, type ItemId } from './items';
import { countItem, removeItem, state } from './state';
import { sfx } from './audio';
import type { NpcDef } from './maps';
import type { WorldScene } from './scenes/WorldScene';

/**
 * THE WAYFARER'S REST
 *
 * You inherit your grandfather's crumbling inn at the crossroads of the Greenveil Realm: a leaking roof, a field of
 * briars and a mountain of debt. The Iron Crown (north) and the Verdant Freeholds (south) stopped trading, and the
 * travelers stopped coming. Restore the inn, feed its guests, and make the hearth neutral ground.
 *
 * Act I, Kindling the First Spark
 *   0  Meet Barnaby, the old carpenter on the porch.
 *   1  Brew him a decent pint of Honey-Wine. He fixes the door and the roof.
 *   2  First guests: Pell (runaway scribe) wants Root Ale, Maeve (grumpy herbalist) wants 3 Woodcaps,
 *      Finn (bard with broken strings) wants 2 Slime Gel for new strings.
 *   3  Stew Night: 3 hot dishes at the hearth after 6 PM. Corvin, a northern merchant, brings word that the
 *      magistrate has blockaded the high roads. The inn could be an information hub.
 * Act II, Smoke on the Horizon
 *   4  Renown: serve travelers until your reputation reaches 40.
 *   5  Sir Raymond (Iron Crown) and Isla (Freeholds) arrive and clash. Jorah, a disgraced palace chef, takes
 *      refuge in your kitchen and teaches you new recipes. Serve Raymond an Omelette and Isla a Honey-Wine.
 *   6  The crisis: each demands you take their side. You refuse.
 *   7  The Summit Feast at the hearth after 6 PM: 2 Omelettes (north), 2 Honey-Wines (south), 1 Moonmelon,
 *      with Hearth Warmth 60 or more. A ceasefire.
 * Act III, The Great Convergence
 *   8  Grand Chancellor Vexmoor is coming to seize the inn. Rally 8 signatures and earn 1500g at the inn.
 *   9  He arrives at your door. Everyone you've helped stands with you. He leaves.
 *  10  The Grand Festival of the Hearth: 5 different dishes at the hearth after 6 PM. The Crossroads Accord.
 *  11  Epilogue: the most famous sanctuary in the realm. Keep playing.
 *
 * Systems
 *   Reputation (0-100): story steps and every guest served. Higher reputation brings stranger, richer travelers.
 *   Hearth Warmth (0-100): +10 per guest served, +15 each night Finn plays; fades by 15 each night.
 *     At 50, Maeve drops her guard and asks for help with her eyes (an optional personal quest).
 *   Inn Ledger: travelers order dishes and pay about twice what the shipping bin does.
 */

export const INN = {
  ARRIVE: 0, HONEYWINE: 1, FIRST_GUESTS: 2, STEW_NIGHT: 3,
  RENOWN: 4, ENVOYS: 5, CRISIS: 6, SUMMIT: 7,
  RALLY: 8, CHANCELLOR: 9, FESTIVAL: 10, DONE: 11,
} as const;

const RENOWN_NEEDED = 40;
const SUMMIT_WARMTH = 60;
const MAEVE_WARMTH = 50;
const SIGNATURES_NEEDED = 8;
const EARNINGS_NEEDED = 1500;
const EVENING = 18 * 60;
/** Dishes that count as "hot" for Stew Night. */
const HOT: ItemId[] = ['soup', 'omelette', 'stew', 'pie', 'tart'];
/** Everything the hearth can make, for the Festival's "5 different dishes". */
const DISHES: DishId[] = ['soup', 'omelette', 'tart', 'stew', 'pie', 'honeywine', 'ale'];

const inn = () => state.inn;
const did = (key: string) => inn().done.includes(key);
const mark = (key: string) => { if (!did(key)) inn().done.push(key); };
const learn = (...dishes: DishId[]) => { for (const d of dishes) if (!state.recipes.includes(d)) state.recipes.push(d); };

export function addRep(n: number): void { inn().rep = Math.max(0, Math.min(100, inn().rep + n)); }
export function addWarmth(n: number): void { inn().warmth = Math.max(0, Math.min(100, inn().warmth + n)); }

function say(speaker: string | undefined, lines: string[], extra: Partial<DialogueOpts> = {}) {
  ui.dialogue({ speaker, lines, ...extra });
}

const stars = (rep: number) => '★'.repeat(Math.floor(rep / 20)) + '☆'.repeat(5 - Math.floor(rep / 20));

/** "Reputation ★★☆☆☆ 45 · Hearth Warmth 60", once the inn is open. */
export function innStatus(): string | null {
  if (inn().step < INN.FIRST_GUESTS) return null;
  return `Reputation ${stars(inn().rep)} ${inn().rep}   Hearth ${inn().warmth}/100`;
}

/** The current objective for the HUD and the menu. */
export function innGoal(): string | null {
  const s = inn();
  const status = innStatus();
  const goal = ((): string | null => {
    switch (s.step) {
      case INN.ARRIVE: return 'Talk to the old man on the porch of the Wayfarer\'s Rest.';
      case INN.HONEYWINE: return `Brew Honey-Wine at the hearth (4 Wild Berries, from the Whispering Woods) and bring it to Barnaby.`;
      case INN.FIRST_GUESTS: {
        const box = (k: string) => (did(k) ? '[x]' : '[ ]');
        return `Look after your first guests:\n${box('pell')} Pell: a Root Ale (2 Potatoes)\n${box('maeve')} Maeve: 3 Woodcaps\n${box('finn')} Finn: 2 Slime Gel for strings`;
      }
      case INN.STEW_NIGHT: return 'Host Stew Night: bring 3 hot dishes (Veggie Soup, Omelette...) to the hearth after 6 PM.';
      case INN.RENOWN: return `Serve travelers in the common room until your reputation reaches ${RENOWN_NEEDED} (${s.rep}/${RENOWN_NEEDED}).`;
      case INN.ENVOYS: {
        const box = (k: string) => (did(k) ? '[x]' : '[ ]');
        return `Make peace over dinner:\n${box('raymond')} Sir Raymond: an Omelette\n${box('isla')} Isla: a Honey-Wine\nTalk to Jorah in the kitchen.`;
      }
      case INN.CRISIS: return 'Sir Raymond and Isla want a word. Both of them. Now.';
      case INN.SUMMIT: return `Host the Summit Feast at the hearth after 6 PM:\n2 Omelettes, 2 Honey-Wines, 1 Moonmelon\nHearth Warmth ${s.warmth}/${SUMMIT_WARMTH}`;
      case INN.RALLY: return `Rally the crossroads against the Chancellor:\nSignatures ${Math.min(s.signed.length, SIGNATURES_NEEDED)}/${SIGNATURES_NEEDED} (talk to everyone you've helped)\nInn income ${Math.min(s.earned, EARNINGS_NEEDED)}/${EARNINGS_NEEDED}g` +
        (s.signed.length >= SIGNATURES_NEEDED && s.earned >= EARNINGS_NEEDED ? '\nReady. He arrives tomorrow morning.' : '');
      case INN.CHANCELLOR: return 'Grand Chancellor Vexmoor is at your door. Face him.';
      case INN.FESTIVAL: return 'The Grand Festival of the Hearth: bring 5 different dishes to the hearth after 6 PM.';
      default: return null;
    }
  })();
  return [goal, status].filter(Boolean).join('\n') || null;
}

/** Travelers who come once the inn has a reputation. Stranger, richer ones as it grows. */
const TRAVELERS: { minRep: number; names: string[]; orders: ItemId[]; bonus: number; rep: number }[] = [
  { minRep: 0, names: ['a Weary Traveler', 'a Peddler', 'a Pilgrim', 'a Shepherd'], orders: ['ale', 'honeywine', 'potato', 'egg', 'milk', 'strawberry', 'soup'], bonus: 0, rep: 2 },
  { minRep: 35, names: ['a Monster-Hunter', 'a Wandering Scholar', 'a Minor Noble', 'a Cartographer'], orders: ['omelette', 'soup', 'honeywine', 'tart', 'ale', 'mushroom'], bonus: 25, rep: 3 },
  { minRep: 70, names: ['an Elven Diplomat', 'a Dwarven Master-Smith', 'a Goblin Truffle-Hunter', 'a Sky-Sailor'], orders: ['stew', 'pie', 'tart', 'moonmelon', 'cake', 'core'], bonus: 80, rep: 5 },
];
const REVIEWS = ['"Honest ale. Honest bed. Honest cat."', '"The fire was warm and nobody stabbed anyone."', '"Five stars. Would be snowed in here again."', '"The stew talks back. In a good way."', '"Finally, a crossroads worth stopping at."'];

export class Inn {
  constructor(private w: WorldScene) {}

  private get scene() { return this.w as unknown as Phaser.Scene; }

  // ---------------------------------------------------------------- the day

  /** A new morning: warmth fades (Finn's music keeps it up), travelers arrive, the story moves on. */
  onNewDay(): void {
    const s = inn();
    addWarmth(-15 + (did('finn') ? 15 : 0));
    // Travelers: one at first, two once word gets around.
    s.travelers = [];
    if (s.step >= INN.RENOWN) {
      const tiers = TRAVELERS.filter(t => s.rep >= t.minRep);
      for (let i = 0; i < (s.rep >= 30 ? 2 : 1); i++) {
        const t = Phaser.Utils.Array.GetRandom(tiers);
        s.travelers.push({ name: Phaser.Utils.Array.GetRandom(t.names), order: Phaser.Utils.Array.GetRandom(t.orders) });
      }
    }
    const news: string[] = [];
    if (s.step === INN.RENOWN && s.rep >= RENOWN_NEEDED) {
      s.step = INN.ENVOYS;
      news.push(
        'Word of the Wayfarer\'s Rest has reached both sides of the border.',
        'This morning, two very important people arrived at the same time, and are now glaring at each other across your common room:',
        'Sir Raymond of the Iron Crown, and Isla, envoy of the Freehold Guilds.',
        'Also, a man with a cleaver and a sad face is cooking in your kitchen. Nobody let him in.',
      );
    }
    if (s.step === INN.RALLY && s.signed.length >= SIGNATURES_NEEDED && s.earned >= EARNINGS_NEEDED) {
      s.step = INN.CHANCELLOR;
      news.push('Drums on the pass. Grand Chancellor Vexmoor and his inspection regiment have arrived at the Wayfarer\'s Rest.', 'He is standing at your door with a very large stamp.');
    }
    if (news.length) this.scene.time.delayedCall(1300, () => say(undefined, news));
  }

  // ---------------------------------------------------------------- talking

  /** Returns true if the inn's story handled this conversation. */
  talk(npc: NpcDef): boolean {
    const id = npc.id;
    if (inn().step === INN.RALLY && this.askSignature(id, npc.name)) return true;
    switch (id) {
      case 'barnaby': this.barnaby(); return true;
      case 'pell': this.pell(); return true;
      case 'maeve': this.maeve(); return true;
      case 'finn': this.finn(); return true;
      case 'corvin': this.corvin(); return true;
      case 'jorah': this.jorah(); return true;
      case 'raymond': case 'isla': this.envoy(id); return true;
      case 'chancellor': this.chancellor(); return true;
      case 'traveler0': case 'traveler1': this.traveler(id === 'traveler0' ? 0 : 1); return true;
    }
    return false;
  }

  /** Bram's shop counter: his signature in Act III. Returns true if it opened its own dialogue. */
  shopCounter(): boolean {
    if (inn().step !== INN.RALLY || inn().signed.includes('bram')) return false;
    inn().signed.push('bram');
    say('Bram', ['A petition against the Chancellor? He taxed my ladder. Give it here.', '(Bram signs. Then he signs again, smaller, in case the first one didn\'t count.)'], { onClose: () => ui.shop() });
    return true;
  }

  /** Offers a held dish or item to whoever asked for it. */
  private offer(speaker: string, need: ItemId, qty: number, prompt: string, then: () => void, notYet: string[]): void {
    if (countItem(need) < qty) { say(speaker, notYet); return; }
    say(speaker, [prompt], {
      choices: [
        { label: `Give ${countOf(need, qty)}`, action: () => { if (removeItem(need, qty)) { sfx('coin'); then(); } } },
        { label: 'Not yet' },
      ],
    });
  }

  private barnaby(): void {
    const s = inn();
    const B = 'Barnaby';
    if (s.step === INN.ARRIVE) {
      s.step = INN.HONEYWINE;
      learn('honeywine', 'ale');
      say(B, [
        "So. You're the grandchild. You've got his nose. Hopefully not his bookkeeping.",
        "Barnaby. Carpenter. Retired. I built half this inn, and I'm not lifting a hammer for the other half until somebody pours me a decent pint of honey-wine.",
        'Your grandfather brewed the best in the realm, right there at the hearth. Four handfuls of wild berries from the Whispering Woods, a little patience.',
        "I'll be on this porch. I have been on this porch for three years. I can wait.",
        '(You learned to brew Honey-Wine and Root Ale at the hearth.)',
      ]);
      return;
    }
    if (s.step === INN.HONEYWINE) {
      this.offer(B, 'honeywine', 1, 'Is that... honey-wine? Real honey-wine?', () => {
        s.step = INN.FIRST_GUESTS;
        addRep(5); addWarmth(10);
        say(B, [
          '(Barnaby drinks it slowly, with his eyes closed.)',
          '...He used to make it just like that. Too sweet. Perfect.',
          '(Barnaby stands, cracks his back, and spends the rest of the day banging things. By evening the door hangs straight and the roof only leaks a bit.)',
          "There. Doors open. You'll get guests now. Strays, mostly. That's how it starts.",
        ]);
      }, ["Honey-wine. Four handfuls of wild berries, at the hearth. I'm not getting any younger. I'm not getting any thirstier, either. Well. I am."]);
      return;
    }
    if (s.step === INN.DONE) {
      say(B, Phaser.Utils.Array.GetRandom([
        ["Look at this place. Your grandfather would've cried. Then complained about the paint."],
        ['I lost my family in the border wars, you know. Never thought I\'d get another one. At an inn. Typical.'],
        ['Same time tomorrow, kid. Pour me something.'],
      ]));
      return;
    }
    // Deep secret, once the hearth is warm.
    if (s.warmth >= MAEVE_WARMTH && !did('barnabySecret')) {
      mark('barnabySecret');
      addRep(2);
      say(B, ['...Warm in there tonight. Reminds me.', "I had a wife and a girl, up by the north pass. The border wars took them. I stopped building after that.", "Then you turned up with your grandfather's nose. Don't make me say anything else. Go on, back to work."]);
      return;
    }
    say(B, [Phaser.Utils.Array.GetRandom([
      'Keep the fire going. A cold hearth is an empty inn.',
      'Cook something people miss from home. That\'s the whole trick.',
      "The roof's holding. For now. Like me.",
    ])]);
  }

  private firstGuestDone(key: string): void {
    mark(key);
    addRep(3); addWarmth(10);
    if (['pell', 'maeve', 'finn'].every(did) && inn().step === INN.FIRST_GUESTS) {
      inn().step = INN.STEW_NIGHT;
      this.scene.time.delayedCall(400, () => ui.toast("Your first guests are happy! Barnaby says it's time for a Stew Night."));
    }
  }

  private pell(): void {
    const P = 'Pell';
    if (inn().step === INN.FIRST_GUESTS && !did('pell')) {
      this.offer(P, 'ale', 1, 'Is that ale? For me? I have no money. I have... a very nice pen.', () => {
        this.firstGuestDone('pell');
        say(P, ["I ran away from the Royal Archive. They wanted me to copy tax laws for the rest of my life.", "I'll copy something better here. Your guests' stories. Every one of them. Someone should write them down."]);
      }, ["Hello. I'm Pell. I'm a scribe. Was. I ran away. Please don't tell anyone.", 'Could I have a Root Ale? You brew it from 2 Potatoes. I would brew it myself but I am very bad at potatoes.']);
      return;
    }
    say(P, [Phaser.Utils.Array.GetRandom([
      'I\'ve written down forty-one stories this week. Three of them were Barnaby complaining. All very good.',
      'Did you know the Iron Crown and the Freeholds signed a treaty here once? A hundred years ago. In this room.',
      'Ink. Bread. Fire. That\'s all a scribe needs. And ale.',
    ])]);
  }

  private maeve(): void {
    const M = 'Maeve';
    const s = inn();
    if (s.step === INN.FIRST_GUESTS && !did('maeve')) {
      this.offer(M, 'mushroom', 3, 'Woodcaps. Three of them. Fine. Hand them over.', () => {
        this.firstGuestDone('maeve');
        say(M, ['...These are good ones. Fresh.', "Hmph. I suppose I'll stay. The shed out back has decent light. I'll grow my herbs there.", "Don't get used to me."]);
      }, ["What? I'm an herbalist, not a decoration. I need 3 Woodcaps from the Whispering Woods for a tincture.", "Bring them or don't. I'll sit here and judge your furniture either way."]);
      return;
    }
    // Her personal quest: only once the hearth is warm enough for her to say it.
    if (s.step > INN.FIRST_GUESTS && !did('maeveEyes')) {
      if (s.warmth < MAEVE_WARMTH) {
        say(M, ['Hmph. Cold in here tonight.', '(Maeve squints at you. She squints at everything. A warmer hearth might get her talking.)']);
        return;
      }
      if (!did('maeveAsked')) {
        mark('maeveAsked');
        say(M, [
          '...It\'s warm in here tonight. Fine. I\'ll say it once.',
          "My eyes are going. Slowly. Everything's a little blurrier every winter.",
          'There\'s an old cure. It needs a herb that grows by moonlight. The closest thing in this valley is a Moonmelon.',
          "If you ever grow one... I wouldn't say no.",
        ]);
        return;
      }
      this.offer(M, 'moonmelon', 1, 'A Moonmelon. You actually grew one. For me.', () => {
        mark('maeveEyes');
        addRep(5); addWarmth(10);
        state.maxHp = Math.min(10, state.maxHp + 1);
        state.hp = state.maxHp;
        say(M, [
          '(Maeve brews something that smells like moonlight and old socks, and drinks it in one go.)',
          '...I can see the grain in the table. I haven\'t seen that in years.',
          'Here. A salve for you. Don\'t argue. It works on stubborn farmers too.',
          '(Maeve\'s salve: your maximum hearts went up by one.)',
        ]);
      }, ['A Moonmelon. The seeds are at Bram\'s. It grows in any season. Take your time. I\'m not going anywhere. Literally. I can\'t find the door.']);
      return;
    }
    say(M, [Phaser.Utils.Array.GetRandom([
      'Chamomile for sleep. Woodcap for courage. Ale for everything else.',
      'Your fire smells of pine. Good. Pine keeps the damp out of the bones.',
      did('maeveEyes') ? 'I counted the stars last night. All of them. Showing off.' : "Hmph.",
    ])]);
  }

  private finn(): void {
    const F = 'Finn';
    if (inn().step === INN.FIRST_GUESTS && !did('finn')) {
      this.offer(F, 'gel', 2, 'Slime Gel! Stretchy, springy, perfect. Can I?', () => {
        this.firstGuestDone('finn');
        say(F, ['(Finn restrings the lute with slime gel. It sounds... wobbly. Wonderful.)', 'Every night, from now on, I play by your fire. Music keeps a hearth warm. Ask anyone. Ask a fire.']);
      }, ['Finn, bard of the open road! Currently a bard of the closed road. And of no strings.', 'Bring me 2 Slime Gel from the woods and I will make strings that would make a harp weep.']);
      return;
    }
    say(F, [Phaser.Utils.Array.GetRandom([
      '♪ Oh the crossroads were empty, the roof had a hole... ♪ Working title.',
      'A warm room makes people say true things. I just make the room warm. With song.',
      'I wrote a ballad about Barnaby. He threw a shoe at me. Critics.',
    ])]);
  }

  private corvin(): void {
    const s = inn();
    say('Corvin', [s.step <= INN.RENOWN
      ? 'The high roads are still blocked. Every trader with a cart is coming the long way now. Through here. You might want more beds.'
      : Phaser.Utils.Array.GetRandom([
        'I hear everything at this table. That\'s worth more than gold. Well. Almost.',
        'The magistrate\'s blockade is leaking like your old roof. Thanks to you.',
        'North wants iron. South wants grain. Everybody wants your stew.',
      ])]);
  }

  private jorah(): void {
    if (!did('jorah')) {
      mark('jorah');
      learn('tart', 'pie', 'stew');
      say('Jorah', [
        'Ah. You found me. Yes, I am cooking in your kitchen. No, I will not leave.',
        'Jorah. Former chef to the Royal Palace. I served the king a soup with too much salt and he took it very personally.',
        'Your guests are hungry and your recipes are... adequate. Let me fix that.',
        '(Jorah taught you Berry Tart, Leek Pie and Moon Stew.)',
        'And listen: Sir Raymond grew up on Iron Crown breakfasts. An omelette will make him homesick in the good way. Isla is from the south; they drink honey-wine at every wedding and every funeral.',
      ]);
      return;
    }
    say('Jorah', [Phaser.Utils.Array.GetRandom([
      'Food is diplomacy. A full stomach cannot shout. Trust me, I have tried.',
      'Salt is like an opinion. A little is necessary. Too much and someone gets exiled.',
      inn().step === INN.SUMMIT ? 'For the summit: two omelettes for the north, two honey-wines for the south, and something neither side has ever tasted. A Moonmelon.' : 'Taste everything twice. Once with your mouth, once with your heart.',
    ])]);
  }

  private envoy(id: 'raymond' | 'isla'): void {
    const s = inn();
    const name = id === 'raymond' ? 'Sir Raymond' : 'Isla';
    if (s.step === INN.ENVOYS && !did(id)) {
      if (id === 'raymond') {
        this.offer(name, 'omelette', 1, 'Is that... an Iron Crown breakfast? Eggs, folded properly?', () => this.envoyFed('raymond'), [
          'Sir Raymond of the Iron Crown. I am here to inspect this "neutral ground". It seems very... southern.',
          '(He glares across the room at Isla.)',
          'I have not had a proper breakfast in weeks. The food down here is all berries and feelings.',
        ]);
      } else {
        this.offer(name, 'honeywine', 1, 'Honey-wine. Like at home. You did this on purpose.', () => this.envoyFed('isla'), [
          'Isla, envoy of the Freehold Guilds. I came to buy grain. Instead I found HIM.',
          '(She glares across the room at Sir Raymond.)',
          'Is there anything to drink in this inn that does not taste of the north?',
        ]);
      }
      return;
    }
    if (s.step === INN.CRISIS) { this.crisis(); return; }
    if (s.step === INN.SUMMIT) {
      say(name, [id === 'raymond' ? 'A feast, with HER? ...Fine. If the cooking is as good as the breakfast.' : 'A summit. With him. Over dinner. ...If there is honey-wine, I will come.']);
      return;
    }
    say(name, [Phaser.Utils.Array.GetRandom(id === 'raymond' ? [
      'Isla says the Freeholds make a decent cheese. I said nothing. That was a compliment.',
      'At home they would have me flogged for sitting at a table with a guild envoy. Here, she passed me the salt.',
      'This inn is the only place in the realm where nobody bows to me. It is restful.',
    ] : [
      'Raymond snores. I know this because the walls are thin. That is all I know about Raymond.',
      'Trade is just people deciding not to be enemies on a schedule.',
      'He laughed at one of my jokes yesterday. He covered it with a cough. I saw.',
    ])]);
  }

  private envoyFed(id: 'raymond' | 'isla'): void {
    mark(id);
    addRep(5); addWarmth(10);
    say(id === 'raymond' ? 'Sir Raymond' : 'Isla', [id === 'raymond'
      ? "...That was excellent. Do not tell anyone a knight said so. Especially not her."
      : "...Thank you. I didn't expect to feel at home here. Do not tell HIM."]);
    if (did('raymond') && did('isla')) {
      inn().step = INN.CRISIS;
      this.scene.time.delayedCall(500, () => ui.toast('Raymond and Isla both put down their cups at the same time. Uh oh.'));
    }
  }

  /** Both sides demand the inn. Refusing is the only way forward, but you may say yes and regret it. */
  private crisis(): void {
    const side = (who: string, offer: string): Choice => ({
      label: offer,
      action: () => say('Barnaby', [
        `(${who === 'north' ? 'Isla' : 'Sir Raymond'} stands, leaves money on the table, and walks out without a word.)`,
        `...Is that what your grandfather built this place for? Half a realm's inn?`,
        "Talk to them again. I'm sure they'll both still be furious.",
        `(${who === 'north' ? 'Isla' : 'Sir Raymond'} comes back in an hour later. It's raining. Nobody mentions it.)`,
      ]),
    });
    say(undefined, [
      'The trade dispute boils over. Sir Raymond slams a scroll on the table: the Iron Crown wants the Wayfarer\'s Rest as a military outpost.',
      'Isla slams down a bigger scroll: the Freeholds want it as a tax haven for their guilds.',
      'Both look at you. The whole common room looks at you. Finn stops playing.',
    ], {
      choices: [
        side('north', 'Make it an Iron Crown outpost'),
        side('south', 'Make it a Freehold tax haven'),
        {
          label: 'Neither. This hearth belongs to everyone.',
          action: () => {
            inn().step = INN.SUMMIT;
            addRep(5);
            say(undefined, [
              'You: "Neither. This inn is neutral ground. And I can prove you both make more money talking than fighting."',
              '"Come to dinner. Both of you. Same table. A summit feast, here, at this hearth."',
              'Sir Raymond: "...Fine." Isla: "...Fine." Finn starts playing again, very quietly.',
              'Jorah, from the kitchen: "Two omelettes for the north, two honey-wines for the south, and a Moonmelon to surprise them both. And make the room WARM."',
            ]);
          },
        },
      ],
    });
  }

  private chancellor(): void {
    if (inn().step !== INN.CHANCELLOR) return;
    say('Grand Chancellor Vexmoor', [
      'By order of the capital, this inn is closed. It harbours spies, smugglers, and, I am told, a cat of questionable loyalty.',
      'My regiment will now inspect the premises. And then seize them.',
    ], {
      choices: [{
        label: 'Let the crossroads answer',
        action: () => {
          inn().step = INN.FESTIVAL;
          addRep(15);
          this.w.burst(this.w.player.x, this.w.player.y - 10, 0xffe27a, 18);
          say(undefined, [
            'Behind you, the door opens. Barnaby steps out with a hammer he has no intention of using.',
            `Then Pell, with a petition: ${inn().signed.length} names, in very neat handwriting. Then Maeve, Finn, Jorah, Corvin.`,
            'Sir Raymond: "Seize this inn and the Iron Crown cancels its grain order."',
            'Isla: "And the Freeholds cancel everything else. Everything."',
            `Corvin opens the inn ledger: ${inn().earned}g of honest trade, in one season, at one table.`,
            'The regiment looks at the Chancellor. The Chancellor looks at the ledger. A chicken looks at the Chancellor.',
            'Grand Chancellor Vexmoor: "...I see. A clerical error. Carry on."',
            '(He leaves. His regiment stays for lunch.)',
            'Isla and Sir Raymond, together: "We should sign something. Here. Properly. With a festival."',
          ]);
        },
      }],
    });
  }

  private traveler(i: number): void {
    const t = inn().travelers[i];
    if (!t) return;
    const tier = [...TRAVELERS].reverse().find(x => x.names.includes(t.name)) ?? TRAVELERS[0];
    const pay = (ITEMS[t.order].sell ?? 30) * 2 + tier.bonus;
    const who = t.name.replace(/^(a|an) /, '').replace(/^./, c => c.toUpperCase());
    this.offer(who, t.order, 1, `${ITEMS[t.order].name}? Just what I wanted. (Pays ${pay}g.)`, () => {
      inn().travelers.splice(i, 1);
      state.gold += pay;
      inn().earned += pay;
      addRep(tier.rep); addWarmth(10);
      this.w.burst(this.w.player.x, this.w.player.y - 10, 0xffe27a, 8);
      say(who, [`(${who} eats, pays ${pay}g, and leaves a review in the ledger.)`, `${'★'.repeat(3 + Math.floor(Math.random() * 3))} ${Phaser.Utils.Array.GetRandom(REVIEWS)}`]);
    }, [`Evening, innkeeper. I've come a long way. Could I get ${ITEMS[t.order].name === 'Egg' ? 'an' : 'a'} ${ITEMS[t.order].name}?`, `(The ledger says: ${t.name} would like ${ITEMS[t.order].name}.)`]);
  }

  /** Act III: everyone you've helped signs the petition, once. */
  private askSignature(id: string, name: string): boolean {
    const s = inn();
    const helpers = ['barnaby', 'pell', 'maeve', 'finn', 'corvin', 'jorah', 'raymond', 'isla', 'pip', 'orla', 'hazel', 'mortimer'];
    if (!helpers.includes(id) || s.signed.includes(id)) return false;
    s.signed.push(id);
    sfx('select');
    const lines: Record<string, string> = {
      barnaby: 'Sign it? I\'ll carve it into the door if I have to.',
      pell: 'I wrote the petition! Of course I\'ll sign it. Twice. No. Once. Properly.',
      maeve: 'I can see the line to sign on now, thanks to you. Hmph. Give it here.',
      finn: 'I\'ll sign it AND write a song about it. You can\'t stop me. Nobody can.',
      corvin: 'Every trader on the road owes this inn. I\'ll get you their names too.',
      jorah: 'The last person who tried to close my kitchen was a king. Look how that went. For me. Badly. Give it here.',
      raymond: 'An Iron Crown knight signing a petition against the capital. Father would faint. Good.',
      isla: 'The Freeholds stand with the Wayfarer\'s Rest. Write that down, Pell.',
      pip: 'I can write my WHOLE name now! Look! ...That\'s a horse. Hang on.',
      orla: 'The mayor of the crossroads signs. With great dignity. And a slightly damp hand.',
      hazel: 'Fifty years I baked for this crossroads. I\'ll not have it closed by a man with a stamp.',
      mortimer: 'A petition! Finally, a campaign I can believe in.',
    };
    say(name, [lines[id] ?? 'Of course.', `(${name} signs the petition. ${Math.min(s.signed.length, SIGNATURES_NEEDED)}/${SIGNATURES_NEEDED})`]);
    return true;
  }

  // ---------------------------------------------------------------- the hearth

  /** The hearth's big nights. Returns true if one happened; otherwise the caller opens the cooking menu. */
  hearth(): boolean {
    const s = inn();
    const evening = state.minutes >= EVENING;
    if (s.step === INN.STEW_NIGHT) {
      const hot = HOT.reduce((n, id) => n + countItem(id), 0);
      if (!evening || hot < 3) return false;
      this.offerEvent('Stew Night', `Host Stew Night? (Uses 3 hot dishes: ${HOT.filter(id => countItem(id)).map(id => ITEMS[id].name).join(', ')}.)`, () => {
        let left = 3;
        for (const id of HOT) { const n = Math.min(left, countItem(id)); if (n) { removeItem(id, n); left -= n; } }
        s.step = INN.RENOWN;
        addRep(10); addWarmth(20);
        say(undefined, [
          'Stew Night. Everyone pulls a chair to the fire: Barnaby, Pell, Maeve, Finn. The roof doesn\'t leak once.',
          'Rumors go round with the bowls. Wolves on the west road. A dragon that turned out to be a very large goose. Barnaby laughs, once, and pretends he didn\'t.',
          'Then the door opens. A merchant, soaked to the bone: Corvin, from the northern border.',
          'Corvin: "The magistrate has blockaded the high roads. Nobody gets through. Every cart in the realm is turning back... or coming this way."',
          'You look around the room. Everyone is listening. Everyone is talking. News travels through this fire faster than through any road.',
          'This inn could be more than a bed and a bowl. It could be where the realm comes to hear itself think.',
          '(Act I complete! From tomorrow, travelers will stop by. Serve them what they order to grow your reputation.)',
        ]);
      });
      return true;
    }
    if (s.step === INN.SUMMIT) {
      const ok = evening && s.warmth >= SUMMIT_WARMTH && countItem('omelette') >= 2 && countItem('honeywine') >= 2 && countItem('moonmelon') >= 1;
      if (!ok) return false;
      this.offerEvent('The Summit Feast', 'Host the Summit Feast? (2 Omelettes, 2 Honey-Wines, 1 Moonmelon.)', () => {
        removeItem('omelette', 2); removeItem('honeywine', 2); removeItem('moonmelon', 1);
        s.step = INN.RALLY;
        addRep(20); addWarmth(20);
        say(undefined, [
          'The Summit Feast. One long table. Sir Raymond at one end, Isla at the other, everyone else in between so nobody can throw anything.',
          'The omelettes go north. The honey-wine goes south. The Moonmelon goes to the middle, and both of them reach for it at the same time.',
          'Sir Raymond: "...After you." Isla: "...No, after you." The whole room holds its breath.',
          'They share it. By dessert they are arguing about grain prices, which Corvin says is how you know it\'s going well.',
          'At midnight they shake hands: a ceasefire, and the high roads reopen. (Act II complete!)',
          'Then a rider bursts in, mud to the eyebrows: Grand Chancellor Vexmoor is marching down the pass to shut every independent inn at the crossroads. Starting with this one.',
          'Barnaby: "Then we\'ll show him who this inn belongs to." Gather signatures from everyone you\'ve helped, and keep the ledger full.',
        ]);
      });
      return true;
    }
    if (s.step === INN.FESTIVAL) {
      const have = DISHES.filter(id => countItem(id) > 0);
      if (!evening || have.length < 5) return false;
      this.offerEvent('The Grand Festival of the Hearth', `Begin the Festival? (Uses 1 each of: ${have.slice(0, 5).map(id => ITEMS[id].name).join(', ')}.)`, () => {
        for (const id of have.slice(0, 5)) removeItem(id, 1);
        s.step = INN.DONE;
        addRep(20); addWarmth(30);
        say('The Grand Festival of the Hearth', [
          'For three days the crossroads are full again: carts from the north, carts from the south, lanterns on every fence post.',
          'Finn plays until his slime strings give out, then plays on Pell\'s pen. Maeve dances. Nobody is allowed to mention it.',
          'On the last night, at your hearth, Sir Raymond and Isla sign the Crossroads Accord: the roads stay open, the inn stays neutral, forever.',
          'Barnaby carves the date over the door. He carves your name next to your grandfather\'s. He says it\'s because there was room.',
          'THE END... of this story. The Wayfarer\'s Rest is now the most famous sanctuary in the realm. Keep farming, cooking, and listening: there are always new travelers with new stories.',
        ]);
      });
      return true;
    }
    return false;
  }

  private offerEvent(title: string, prompt: string, run: () => void): void {
    say(title, [prompt], { choices: [{ label: 'Yes, tonight', action: run }, { label: 'Not yet (just cook)', action: () => this.w.openCooking() }] });
  }

  /** The Inn Ledger on the common-room table. */
  ledger(): void {
    const s = inn();
    const lines = [
      `THE WAYFARER'S REST\nReputation ${stars(s.rep)} ${s.rep}/100   Hearth Warmth ${s.warmth}/100\nEarned at the inn: ${s.earned}g`,
      s.travelers.length
        ? `Tonight's guests:\n${s.travelers.map(t => `- ${t.name}: ${ITEMS[t.order].name}`).join('\n')}`
        : s.step >= INN.RENOWN ? 'No travelers waiting. More come every morning.' : 'No travelers yet. Get the inn on its feet first.',
      'Serve guests what they ask for: they pay about twice what the shipping bin does, and tell their friends.',
    ];
    say('The Inn Ledger', lines);
  }
}
