import Phaser from 'phaser';
import { TILE } from './config';
import { ui, type DialogueOpts } from './bus';
import { addItem, countItem, removeItem, state } from './state';
import { sfx } from './audio';
import type { NpcDef } from './maps';
import type { Critter } from './critters';
import type { WorldScene } from './scenes/WorldScene';

/**
 * Side quests from the two townhouses.
 *
 *  Hazel's Harvest Cake (simple): Hazel, a retired baker, needs 10 Eggs. Reward: 300g and a Harvest Cake.
 *
 *  Moo for Mayor (long): Mortimer, a washed-up campaign manager, wants to run Clementine (your cow) for mayor.
 *   1. Endorsements: Pip (bring 1 Milk), Bram (2 Slime Cores, "campaign budget"), and 5 chickens' pledges.
 *   2. The look: buy a Tiny Top Hat from Bram and put it on Clementine.
 *   3. Debate night, 8 PM to midnight in the town plaza, against Sir Wobblesworth (a slime in a hat).
 *      You answer for Clementine: one Moo = yes, two = no, chewing = "a detailed five-point plan".
 *   4. Election morning: results, 800g, and Mayor Clementine gives 2 Milk a day.
 */

/**
 * Hazel's and Mortimer's quests are switched off: the game now follows "The Wayfarer's Rest" (src/inn.ts).
 * Hazel and Mortimer stay in their houses and just chat. Set this to true to bring the quests back.
 */
export const SIDE_QUESTS_ENABLED = false;

export const HAZEL = { NONE: 0, EGGS: 1, DONE: 2 } as const;
export const EGGS_NEEDED = 10;
export const MORT = { NONE: 0, ENDORSE: 1, HAT: 2, DEBATE: 3, WON: 4, DONE: 5 } as const;
export const PLEDGES_NEEDED = 5;
const DEBATE_FROM = 20 * 60, DEBATE_TO = 24 * 60;

const side = () => state.side;
export const cowHasHat = () => SIDE_QUESTS_ENABLED && side().mortimer >= MORT.DEBATE;
export const mayorClementine = () => SIDE_QUESTS_ENABLED && side().mortimer >= MORT.DONE;
const chickenKind = (k: string) => k === 'chicken_red' || k === 'chicken_blonde' || k === 'chick';

function say(speaker: string | undefined, lines: string[], extra: Partial<DialogueOpts> = {}) {
  ui.dialogue({ speaker, lines, ...extra });
}

/** HUD lines for the active side quests. */
export function sideGoals(): string[] {
  if (!SIDE_QUESTS_ENABLED) return [];
  const s = side();
  const goals: string[] = [];
  if (s.hazel === HAZEL.EGGS) goals.push(`Hazel needs ${EGGS_NEEDED} Eggs for her Harvest Cake (${Math.min(countItem('egg'), EGGS_NEEDED)}/${EGGS_NEEDED}).`);
  switch (s.mortimer) {
    case MORT.ENDORSE: {
      const has = (who: string) => (s.endorsed.includes(who) ? '[x]' : '[ ]');
      const n = Math.min(s.pledges.length, PLEDGES_NEEDED);
      goals.push(`Moo for Mayor: get endorsements\n${has('pip')} Pip (bring 1 Milk)\n${has('bram')} Bram (2 Slime Cores)\n` +
        `${n >= PLEDGES_NEEDED ? '[x]' : '[ ]'} Chicken pledges ${n}/${PLEDGES_NEEDED}`);
      break;
    }
    case MORT.HAT: goals.push('Moo for Mayor: buy a Tiny Top Hat from Bram and put it on Clementine.'); break;
    case MORT.DEBATE: goals.push('Moo for Mayor: debate in the town plaza, 8 PM to midnight.\nOne Moo = yes, two = no, chewing = a plan.'); break;
    case MORT.WON: goals.push('Moo for Mayor: the votes are counted overnight. Go to bed!'); break;
  }
  return goals;
}

/** Things standing in the plaza during the debate. */
const DEBATE = { mortimer: { x: 19, y: 10 }, cow: { x: 16, y: 10 }, rival: { x: 23, y: 10 } };

export class SideQuests {
  private debateSprites: Phaser.GameObjects.GameObject[] = [];

  constructor(private w: WorldScene) {}

  private get scene() { return this.w as unknown as Phaser.Scene; }

  create(): void {
    if (!SIDE_QUESTS_ENABLED) return;
    const map = this.w.def.id;
    // Mortimer always wears his own (slightly larger) idea of a hat.
    if (map === 'mortimer') {
      const m = this.w.npcs.find(n => n.def.id === 'mortimer');
      if (m) this.scene.add.image(m.sprite.x, m.sprite.y - 7, 'hat_worn').setOrigin(0.5, 1).setDepth(m.sprite.depth + 1);
    }
    if (map === 'town' && this.debateTime()) this.setupDebate();
  }

  private debateTime(): boolean {
    return side().mortimer === MORT.DEBATE && state.minutes >= DEBATE_FROM && state.minutes < DEBATE_TO;
  }

  onMinute(): void {
    if (!SIDE_QUESTS_ENABLED) return;
    if (side().mortimer !== MORT.DEBATE) return;
    if (state.minutes === DEBATE_FROM) {
      if (this.w.def.id === 'town') this.setupDebate();
      ui.toast("It's 8 PM: the mayoral debate is starting in the town plaza!");
    }
    if (state.minutes === DEBATE_TO && this.debateSprites.length) {
      this.debateSprites.forEach(o => o.destroy());
      this.debateSprites = [];
      ui.toast('The debate crowd goes home. Mortimer will try again tomorrow night.');
    }
  }

  /** Election morning. */
  onNewDay(): void {
    if (!SIDE_QUESTS_ENABLED) return;
    if (side().mortimer !== MORT.WON) return;
    side().mortimer = MORT.DONE;
    state.gold += 800;
    this.scene.time.delayedCall(1200, () => say('Election results', [
      'The votes are in! Hollowbrook has a new mayor.',
      'Clementine (cow): 47 votes. Sir Wobblesworth (slime): 3 votes, all from slimes. Spoiled ballots: 1 (Pip drew a horse).',
      'Mortimer: "LANDSLIDE! A MOO-NDATE! I have waited my whole life to say that."',
      'Mayor Clementine has made her first decree: "Moo." Experts agree it means more milk.',
      '(You received 800g. From now on Clementine gives 2 Milk a day.)',
    ]));
  }

  // ---------------------------------------------------------------- talking

  /** Returns true if a side quest took over the conversation. */
  talk(npc: NpcDef): boolean {
    if (!SIDE_QUESTS_ENABLED) return false;
    switch (npc.id) {
      case 'hazel': return this.talkHazel();
      case 'mortimer': return this.talkMortimer();
      case 'pip': return this.pipEndorsement();
    }
    return false;
  }

  private talkHazel(): boolean {
    const s = side();
    const H = 'Hazel';
    if (s.hazel === HAZEL.NONE) {
      say(H, [
        "Oh! A visitor. Come in, come in. Mind the flour. It's everywhere. It's in me.",
        "I'm Hazel. I baked for this whole valley for fifty years. Weddings, birthdays, the Great Turnip Festival...",
        "Before I hang up my apron for good, I want to bake the Harvest Cake one last time. The legendary one.",
        `It needs ${EGGS_NEEDED} Eggs. But my hens retired. They moved to the coast. They send postcards.`,
        `Would you bring me ${EGGS_NEEDED} Eggs, dear?`,
      ], {
        choices: [
          { label: `I'll bring you ${EGGS_NEEDED} Eggs`, action: () => { s.hazel = HAZEL.EGGS; ui.toast("New quest: Hazel's Harvest Cake"); say(H, ['Wonderful! Your chickens lay them in the grass in the mornings. Take your time.']); } },
          { label: 'Not right now', action: () => say(H, ["That's all right, dear. The oven and I will be here. We're very patient. And warm."]) },
        ],
      });
      return true;
    }
    if (s.hazel === HAZEL.EGGS) {
      const have = countItem('egg');
      if (have < EGGS_NEEDED) {
        say(H, [`${have ? `${have} Eggs so far!` : 'No eggs yet?'} I need ${EGGS_NEEDED}. Your chickens lay them in the grass most mornings.`]);
        return true;
      }
      say(H, [`Are those... ${EGGS_NEEDED} Eggs? Oh, they're perfect.`], {
        choices: [
          {
            label: `Give Hazel ${EGGS_NEEDED} Eggs`,
            action: () => {
              if (!removeItem('egg', EGGS_NEEDED)) return;
              s.hazel = HAZEL.DONE;
              state.gold += 300;
              const fits = addItem('cake', 1);
              sfx('harvest');
              say(H, [
                '(Hazel bakes. The house fills with a smell so good the chickens outside fall silent.)',
                'There. The Harvest Cake. The last one I will ever bake. Probably. I said that in 1987 too.',
                fits ? 'Take this one. And some coins for your trouble.' : "Your bag's full, so I'll eat this one. For you. Here are some coins.",
                `(You received 300g${fits ? ' and a Harvest Cake' : ''}.)`,
              ]);
            },
          },
          { label: 'Not yet' },
        ],
      });
      return true;
    }
    return false; // done: her normal chatter
  }

  private talkMortimer(): boolean {
    const s = side();
    const M = 'Mortimer';
    switch (s.mortimer) {
      case MORT.NONE:
        say(M, [
          "A farmer! Excellent. Sit. Don't sit there, that's the campaign chair.",
          "Mortimer Quill. Campaign manager. Retired. Undefeated, if you don't count the losses.",
          "Hollowbrook needs a leader. Someone calm. Someone who never lies. Someone who eats grass and is happy about it.",
          'I am talking, of course, about your cow. Clementine.',
          "Picture it: MAYOR CLEMENTINE. The posters write themselves. I know, because I've already written them.",
          'Will you be her campaign team?',
        ], {
          choices: [
            {
              label: "Let's make Clementine mayor",
              action: () => {
                s.mortimer = MORT.ENDORSE;
                ui.toast('New quest: Moo for Mayor');
                say(M, [
                  'MAGNIFICENT. Step one: endorsements.',
                  "Pip will vote for anyone who makes milk. Bring Pip a Milk.",
                  'Bram wants 2 Slime Cores for the "campaign budget". I don\'t ask. You shouldn\'t either.',
                  `And the chickens. Chickens vote as a bloc. Talk to ${PLEDGES_NEEDED} of them, here or on your farm. Get their pledges.`,
                ]);
              },
            },
            { label: 'A cow? For mayor? Not right now', action: () => say(M, ['They laughed at the scarecrow too. Then they voted for him. Well, one of them did. Come back when you are ready to make history.']) },
          ],
        });
        return true;
      case MORT.ENDORSE:
        say(M, ['Endorsements, endorsements! Pip wants Milk, Bram wants 2 Slime Cores, and the chickens want to be asked. Politely.']);
        return true;
      case MORT.HAT:
        say(M, ['The endorsements are in! Now she needs a LOOK.', 'A hat. A small, serious hat. Bram sells a Tiny Top Hat. Put it on her.']);
        return true;
      case MORT.DEBATE:
        say(M, [
          'Tonight: the debate. Eight o\'clock, town plaza. Her opponent is Sir Wobblesworth. A slime. In a hat. He copied us.',
          "Clementine can't hold a microphone, so you'll answer for her. Remember the code:",
          'ONE Moo means yes. TWO Moos mean no. Chewing means "I have a detailed five-point plan."',
          'Practise it. Say it in your sleep. I do.',
        ]);
        return true;
      case MORT.WON:
        say(M, ["We won the debate! Now we wait. The town votes tonight. Go home and sleep, I can't, I'm too excited."]);
        return true;
    }
    if (s.mortimer === MORT.DONE) {
      say(M, Phaser.Utils.Array.GetRandom([
        ["Mayor Clementine's approval rating is 100%. Nobody has disapproved. Nobody knows how."],
        ['She vetoed a bill today by lying down on it. Masterful.'],
        ['Next election I am running a chicken. Do not tell Clementine.'],
      ]));
      return true;
    }
    return false;
  }

  private endorse(who: string): void {
    const s = side();
    if (!s.endorsed.includes(who)) s.endorsed.push(who);
    this.checkEndorsements();
  }

  private checkEndorsements(): void {
    const s = side();
    if (s.mortimer !== MORT.ENDORSE) return;
    if (s.endorsed.includes('pip') && s.endorsed.includes('bram') && s.pledges.length >= PLEDGES_NEEDED) {
      s.mortimer = MORT.HAT;
      this.scene.time.delayedCall(400, () => ui.toast("All endorsements in! Mortimer says Clementine needs a hat. Bram sells one."));
    }
  }

  private pipEndorsement(): boolean {
    const s = side();
    if (s.mortimer !== MORT.ENDORSE || s.endorsed.includes('pip')) return false;
    if (countItem('milk') < 1) {
      say('Pip', ['Clementine for mayor?! I will vote for ANYONE who makes milk. Bring me some Milk and she has my vote!']);
      return true;
    }
    say('Pip', ['Is that MILK? From the CANDIDATE?'], {
      choices: [
        {
          label: 'Give Pip 1 Milk',
          action: () => {
            if (!removeItem('milk', 1)) return;
            this.endorse('pip');
            say('Pip', ['(Pip drinks the whole thing in one go.)', 'CLEMENTINE! CLEMENTINE! I am making a sign. It is going to have SO many cows on it.']);
          },
        },
        { label: 'Not yet' },
      ],
    });
    return true;
  }

  /**
   * Bram's shop counter. Returns true if the side quest opened its own dialogue (which then opens the shop).
   */
  shopCounter(): boolean {
    if (!SIDE_QUESTS_ENABLED) return false;
    const s = side();
    if (s.mortimer !== MORT.ENDORSE || s.endorsed.includes('bram')) return false;
    if (countItem('core') < 2) {
      say('Bram', ['A cow? For mayor? Sure. Endorsement costs 2 Slime Cores. Campaign budget.', "Deep Woods slimes have them. Don't ask what the budget is for."], { onClose: () => ui.shop() });
      return true;
    }
    say('Bram', ['2 Slime Cores for an endorsement. Campaign budget.'], {
      choices: [
        {
          label: 'Give Bram 2 Slime Cores',
          action: () => {
            if (!removeItem('core', 2)) return;
            this.endorse('bram');
            say('Bram', ['Pleasure doing politics with you. "Bram endorses Clementine." There. Now buy something.'], { onClose: () => ui.shop() });
          },
        },
        { label: 'Just shopping', action: () => ui.shop() },
      ],
    });
    return true;
  }

  // ---------------------------------------------------------------- animals

  /** Talking to an animal. Returns true if a side quest handled it. */
  critter(c: Critter): boolean {
    if (!SIDE_QUESTS_ENABLED) return false;
    const s = side();
    if (s.mortimer === MORT.ENDORSE && chickenKind(c.kind)) {
      const key = `${this.w.def.id}:${c.slot}`;
      if (s.pledges.includes(key)) return false;
      s.pledges.push(key);
      sfx('select');
      const n = Math.min(s.pledges.length, PLEDGES_NEEDED);
      ui.toast(c.kind === 'chick' ? `Peep! (A pledge for Clementine. ${n}/${PLEDGES_NEEDED})` : `BAWK! (That's a vote for Clementine. ${n}/${PLEDGES_NEEDED})`);
      this.checkEndorsements();
      return true;
    }
    if (s.mortimer === MORT.HAT && c.kind === 'cow' && this.w.def.id === 'farm') {
      if (countItem('tophat') < 1) {
        say(undefined, ['Moo.', '(Clementine looks at your empty hands. She looks at her bare head. She looks at you again.)', '(Bram sells a Tiny Top Hat.)']);
        return true;
      }
      removeItem('tophat', 1);
      s.mortimer = MORT.DEBATE;
      c.wearHat();
      sfx('place');
      this.w.burst(c.x, c.y - 10, 0xffe27a, 10);
      say(undefined, [
        '(You place the Tiny Top Hat on Clementine. She stands a little taller. A nearby chicken salutes.)',
        'Moo.',
        "(A note from Mortimer is tucked under the hat: \"DEBATE TONIGHT. 8 PM. TOWN PLAZA. ONE MOO = YES, TWO = NO, CHEWING = A PLAN.\")",
      ]);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- the debate

  private setupDebate(): void {
    if (this.debateSprites.length) return;
    const at = (p: { x: number; y: number }) => ({ x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE });
    const m = at(DEBATE.mortimer), c = at(DEBATE.cow), r = at(DEBATE.rival);
    const mort = this.scene.add.sprite(m.x, m.y - 4, 'mortimer', 'down_0').setDepth(m.y + 8);
    const cow = this.scene.add.sprite(c.x, c.y, 'cow', 4).setDepth(c.y + 8);
    const rival = this.scene.add.sprite(r.x, r.y - 2, 'gloop', '0').play('gloop_idle').setDepth(r.y + 8);
    this.debateSprites.push(
      mort, cow, rival,
      this.scene.add.image(m.x, m.y - 11, 'hat_worn').setOrigin(0.5, 1).setDepth(m.y + 9),
      this.scene.add.image(c.x, c.y - 3, 'hat_worn').setOrigin(0.5, 1).setDepth(c.y + 9),
      this.scene.add.image(r.x, r.y - 7, 'hat_worn').setOrigin(0.5, 1).setDepth(r.y + 9),
      this.scene.add.text(c.x, c.y - 26, 'CLEMENTINE', { fontFamily: 'monospace', fontSize: '6px', color: '#ffe27a', resolution: 4 }).setOrigin(0.5).setDepth(10000),
      this.scene.add.text(r.x, r.y - 22, 'WOBBLESWORTH', { fontFamily: 'monospace', fontSize: '6px', color: '#c88af8', resolution: 4 }).setOrigin(0.5).setDepth(10000),
    );
    this.scene.tweens.add({ targets: rival, scaleX: 1.08, scaleY: 0.94, yoyo: true, repeat: -1, duration: 500 });
  }

  /** The debate stage blocks walking while it's up. */
  blocks(x: number, y: number): boolean {
    if (!SIDE_QUESTS_ENABLED) return false;
    if (!this.debateSprites.length) return false;
    return Object.values(DEBATE).some(p => p.x === x && p.y === y);
  }

  /** Using or talking at a tile. Returns true if a side quest handled it. */
  interactAt(tx: number, ty: number): boolean {
    if (!SIDE_QUESTS_ENABLED) return false;
    if (!this.debateSprites.length) return false;
    if (tx === DEBATE.cow.x && ty === DEBATE.cow.y) { say(undefined, ['Moo.', '(Clementine is ready. She has been ready her whole life.)']); return true; }
    if (tx === DEBATE.rival.x && ty === DEBATE.rival.y) { say('Sir Wobblesworth', ['Blorp.', '(He adjusts his hat. It is the same hat. He copied us.)']); return true; }
    if (tx !== DEBATE.mortimer.x || ty !== DEBATE.mortimer.y) return false;
    if (side().debateDay === state.day) {
      say('Mortimer', ['The crowd has seen enough for tonight. We regroup. Tomorrow night, 8 PM, same plaza.']);
      return true;
    }
    say('Mortimer', ['This is it. The big night. Remember: ONE Moo = yes, TWO = no, chewing = a detailed five-point plan.', 'Ready?'], {
      choices: [{ label: 'Start the debate', action: () => this.ask(0, 0) }, { label: 'Not yet' }],
    });
    return true;
  }

  private ask(i: number, score: number): void {
    const QUESTIONS: [string, number][] = [
      ['Question one! Will Clementine lower taxes for small businesses? (Bram is asking. Bram is staring.)', 0],
      ['Question two! Will Clementine let slimes chew through important strings? Like, say, the Moonstring?', 1],
      ['Final question! What is Clementine\'s plan if the moon ever falls again?', 2],
    ];
    const ANSWERS = ['Moo.', 'Moo moo.', '(Clementine chews thoughtfully.)', '(Clementine wanders off.)'];
    const [q, right] = QUESTIONS[i];
    say('Pip (moderator)', [q], {
      choices: ANSWERS.map((label, j) => ({
        label,
        action: () => {
          const ok = j === right;
          if (ok) sfx('coin'); else sfx('error');
          const next = score + (ok ? 1 : 0);
          say(undefined, [
            `Clementine: ${label}`,
            ok ? 'The crowd goes wild. A chicken faints from excitement.' : 'The crowd murmurs. Someone boos. It was a chicken.',
            'Sir Wobblesworth: Blorp.',
          ], { onClose: () => (i < QUESTIONS.length - 1 ? this.ask(i + 1, next) : this.endDebate(next)) });
        },
      })),
    });
  }

  private endDebate(score: number): void {
    side().debateDay = state.day;
    if (score >= 2) {
      side().mortimer = MORT.WON;
      this.w.burst(this.w.player.x, this.w.player.y - 10, 0xffe27a, 16);
      say('Pip (moderator)', [
        `That's the debate! Clementine answered ${score} out of 3 like a true leader. Sir Wobblesworth said "blorp" 3 times.`,
        'Voting is tonight! Results tomorrow morning!',
        'Mortimer: "We did it. Go home and sleep. I will be up all night refreshing nothing."',
      ]);
    } else {
      say('Mortimer', [
        `${score} out of 3. Oof. The chickens look disappointed. One of them is writing a strongly worded letter.`,
        'Remember the code: ONE Moo = yes, TWO = no, chewing = a plan. We go again tomorrow night!',
      ]);
    }
  }
}
