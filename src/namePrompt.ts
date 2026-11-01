/**
 * The "What's your name?" box shown when starting a new game. It's a real HTML text field laid over the
 * game, so typing works normally everywhere, including the on-screen keyboard on phones.
 */

export const NAME_MAX = 16;

/** Keeps letters (any language), digits, spaces and a little punctuation. */
export function cleanName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} '.\-_]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

/** Resolves with the chosen name, or null if the player backed out. */
export function askName(keyboard: { enabled: boolean } | null, suggestion = ''): Promise<string | null> {
  return new Promise(resolve => {
    // Let the browser have the keys while the box is open, not the game.
    if (keyboard) keyboard.enabled = false;

    const overlay = document.createElement('div');
    overlay.className = 'name-overlay';
    overlay.innerHTML = `
      <form class="name-box" autocomplete="off">
        <label for="player-name">What's your name, farmer?</label>
        <input id="player-name" type="text" maxlength="${NAME_MAX}" spellcheck="false" autocapitalize="words" enterkeyhint="go" />
        <p class="name-hint">Up to ${NAME_MAX} letters. The people of Hollowbrook will call you this.</p>
        <div class="name-buttons">
          <button type="button" class="name-back">Back</button>
          <button type="submit" class="name-ok">Start farming</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form')!;
    const input = overlay.querySelector('input')!;
    const ok = overlay.querySelector<HTMLButtonElement>('.name-ok')!;
    input.value = cleanName(suggestion);
    const sync = () => { ok.disabled = !cleanName(input.value); };
    sync();
    input.addEventListener('input', sync);
    setTimeout(() => input.focus(), 50);

    const done = (name: string | null) => {
      overlay.remove();
      if (keyboard) keyboard.enabled = true;
      resolve(name);
    };
    // Keep key presses inside the box from reaching the game or the browser's page shortcuts.
    overlay.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = cleanName(input.value);
      if (name) done(name);
    });
    overlay.querySelector('.name-back')!.addEventListener('click', () => done(null));
  });
}
