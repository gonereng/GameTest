/**
 * Sound effects and background music, synthesized with the Web Audio API (no audio files).
 * Browsers only allow sound after the player taps, clicks or presses a key, so nothing plays before that.
 */

export type Sfx =
  | 'hoe' | 'water' | 'plant' | 'harvest' | 'pickup' | 'coin' | 'swing' | 'slimeHit' | 'slimeDie'
  | 'hurt' | 'error' | 'milk' | 'place' | 'select';

const PREF_KEY = 'hollowbrook-sound';
const SFX_VOLUME = 0.5;
const MUSIC_VOLUME = 0.16;

let ctx: AudioContext | null = null;
let master: GainNode;
let sfxBus: GainNode;
let musicBus: GainNode;
let noiseBuf: AudioBuffer;
let muted = readMuted();
/** What the music should sound like right now; set by the game each frame. */
let mood = { night: false, rain: false, indoor: false };

function readMuted(): boolean {
  try { return localStorage.getItem(PREF_KEY) === 'off'; } catch { return false; }
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = SFX_VOLUME;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = MUSIC_VOLUME;
  musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Starts sound on the first tap, click or key press, and pauses it while the tab is hidden. */
export function initAudio(): void {
  const unlock = () => {
    const ac = audio();
    if (!ac) return;
    void ac.resume();
    startMusic();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try { localStorage.setItem(PREF_KEY, m ? 'off' : 'on'); } catch { /* ignore */ }
  if (ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
}

export function setMusicMood(m: typeof mood): void {
  mood = m;
}

// ---------------------------------------------------------------- building blocks

function tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; to?: number; at?: number; out?: AudioNode } = {}): void {
  const ac = ctx!;
  const t = ac.currentTime + (opts.at ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = opts.type ?? 'square';
  osc.frequency.setValueAtTime(freq, t);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  const vol = opts.vol ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(opts.out ?? sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, opts: { filter?: BiquadFilterType; freq?: number; vol?: number; at?: number } = {}): void {
  const ac = ctx!;
  const t = ac.currentTime + (opts.at ?? 0);
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = opts.filter ?? 'lowpass';
  f.frequency.value = opts.freq ?? 1000;
  const g = ac.createGain();
  g.gain.setValueAtTime(opts.vol ?? 0.3, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const SFX: Record<Sfx, () => void> = {
  hoe: () => { noise(0.14, { freq: 500, vol: 0.5 }); tone(110, 0.1, { type: 'triangle', vol: 0.3, to: 70 }); },
  water: () => { noise(0.3, { filter: 'bandpass', freq: 1800, vol: 0.35 }); noise(0.2, { filter: 'bandpass', freq: 2600, vol: 0.2, at: 0.08 }); },
  plant: () => { tone(520, 0.07, { vol: 0.12 }); tone(700, 0.08, { vol: 0.12, at: 0.06 }); },
  harvest: () => { tone(660, 0.08, { vol: 0.15 }); tone(880, 0.08, { vol: 0.15, at: 0.07 }); tone(1320, 0.12, { vol: 0.12, at: 0.14 }); },
  pickup: () => tone(880, 0.1, { type: 'triangle', vol: 0.35, to: 1500 }),
  coin: () => { tone(988, 0.07, { vol: 0.15 }); tone(1319, 0.2, { vol: 0.15, at: 0.07 }); },
  swing: () => noise(0.12, { filter: 'highpass', freq: 2200, vol: 0.3 }),
  slimeHit: () => tone(320, 0.14, { type: 'sine', vol: 0.5, to: 120 }),
  slimeDie: () => { tone(420, 0.3, { type: 'sine', vol: 0.5, to: 60 }); noise(0.2, { freq: 700, vol: 0.25, at: 0.05 }); },
  hurt: () => { tone(240, 0.22, { vol: 0.2, to: 90 }); noise(0.12, { freq: 900, vol: 0.3 }); },
  error: () => { tone(160, 0.12, { vol: 0.12 }); tone(130, 0.16, { vol: 0.12, at: 0.1 }); },
  milk: () => { noise(0.12, { filter: 'bandpass', freq: 900, vol: 0.4 }); noise(0.12, { filter: 'bandpass', freq: 1000, vol: 0.4, at: 0.16 }); },
  place: () => { tone(330, 0.08, { type: 'triangle', vol: 0.4 }); tone(440, 0.12, { type: 'triangle', vol: 0.4, at: 0.07 }); },
  select: () => tone(1200, 0.03, { type: 'triangle', vol: 0.15 }),
};

/** Plays a sound effect. Does nothing until the player has interacted with the page. */
export function sfx(name: Sfx): void {
  if (!ctx || ctx.state !== 'running' || muted) return;
  SFX[name]();
}

// ---------------------------------------------------------------- music

/** A gentle four-chord loop (C, Am, F, G) with a bass note and a picked arpeggio over it. */
const CHORDS = [
  [48, 60, 64, 67, 72], // C
  [45, 57, 60, 64, 69], // Am
  [41, 53, 57, 60, 65], // F
  [43, 55, 59, 62, 67], // G
];
const PATTERNS = [[1, 2, 3, 4, 3, 2, 3, 2], [1, 3, 2, 4, 2, 3, 1, 3], [1, 2, 3, 2, 4, 3, 2, 3]];
const BPM = 84;
const EIGHTH = 60 / BPM / 2;
let musicTimer = 0;
let nextNoteAt = 0;
let step = 0;
let pattern = PATTERNS[0];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function startMusic(): void {
  if (musicTimer || !ctx) return;
  nextNoteAt = ctx.currentTime + 0.1;
  // Schedule notes a little ahead, so timer hiccups don't make the music stutter.
  musicTimer = window.setInterval(scheduleMusic, 100);
}

function scheduleMusic(): void {
  if (!ctx || ctx.state !== 'running') return;
  if (nextNoteAt < ctx.currentTime) nextNoteAt = ctx.currentTime + 0.05;
  while (nextNoteAt < ctx.currentTime + 0.4) {
    const bar = Math.floor(step / 8) % CHORDS.length, beat = step % 8;
    if (beat === 0 && bar === 0) pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
    const chord = CHORDS[bar];
    const at = nextNoteAt - ctx.currentTime;
    // Nights are an octave lower and sparser; rain thins the melody out.
    const shift = mood.night ? -12 : 0;
    const vol = mood.indoor ? 0.5 : 0.7;
    if (beat === 0 || beat === 4) tone(midi(chord[0] + shift), EIGHTH * 3.5, { type: 'triangle', vol: vol * 0.9, at, out: musicBus });
    const skip = (mood.night && beat % 2 === 1) || (mood.rain && Math.random() < 0.35);
    if (!skip) tone(midi(chord[pattern[beat]] + shift), EIGHTH * 1.8, { type: 'triangle', vol: vol * 0.5, at, out: musicBus });
    nextNoteAt += EIGHTH;
    step++;
  }
}
