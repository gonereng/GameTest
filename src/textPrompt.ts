/**
 * A small HTML text box laid over the game (same look as the name box), for typing things like farm codes.
 * Resolves with the cleaned text, or null if the player backed out.
 */
export function askText(
  keyboard: { enabled: boolean } | null,
  opts: { label: string; hint: string; ok: string; maxLength: number; clean: (raw: string) => string | null },
): Promise<string | null> {
  return new Promise(resolve => {
    if (keyboard) keyboard.enabled = false;
    const overlay = document.createElement('div');
    overlay.className = 'name-overlay';
    overlay.innerHTML = `
      <form class="name-box" autocomplete="off">
        <label for="prompt-text"></label>
        <input id="prompt-text" type="text" spellcheck="false" autocapitalize="characters" enterkeyhint="go" />
        <p class="name-hint"></p>
        <div class="name-buttons">
          <button type="button" class="name-back">Back</button>
          <button type="submit" class="name-ok"></button>
        </div>
      </form>`;
    // Set with textContent, never as HTML.
    overlay.querySelector('label')!.textContent = opts.label;
    overlay.querySelector('.name-hint')!.textContent = opts.hint;
    const ok = overlay.querySelector<HTMLButtonElement>('.name-ok')!;
    ok.textContent = opts.ok;
    const input = overlay.querySelector('input')!;
    input.maxLength = opts.maxLength;
    document.body.appendChild(overlay);
    const sync = () => { ok.disabled = !opts.clean(input.value); };
    sync();
    input.addEventListener('input', sync);
    setTimeout(() => input.focus(), 50);

    const done = (value: string | null) => {
      overlay.remove();
      if (keyboard) keyboard.enabled = true;
      resolve(value);
    };
    overlay.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
    });
    overlay.querySelector('form')!.addEventListener('submit', e => {
      e.preventDefault();
      const value = opts.clean(input.value);
      if (value) done(value);
    });
    overlay.querySelector('.name-back')!.addEventListener('click', () => done(null));
  });
}

/** "abcd-efgh", "ABCD EFGH" -> "ABCDEFGH", or null if it can't be a farm code. */
export function cleanCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : null;
}
