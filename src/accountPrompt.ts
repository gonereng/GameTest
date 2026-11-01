import { signIn, signUp } from './cloud';

/**
 * The sign-in / create-account box on the title screen. Real HTML fields over the game, so password
 * managers and phone keyboards work. Resolves true once signed in, false if the player closed it.
 */
export function askAccount(keyboard: { enabled: boolean } | null, suggestedName = ''): Promise<boolean> {
  return new Promise(resolve => {
    if (keyboard) keyboard.enabled = false;
    let mode: 'in' | 'up' = 'in';

    const overlay = document.createElement('div');
    overlay.className = 'name-overlay';
    overlay.innerHTML = `
      <form class="name-box" autocomplete="on">
        <label class="acct-title">Sign in for cloud saves</label>
        <p class="name-hint acct-sub">Your farm is saved to your account, so you can carry on from any device.</p>
        <input name="email" type="email" placeholder="Email" autocomplete="email" required />
        <input name="password" type="password" placeholder="Password (8+ characters)" autocomplete="current-password" minlength="8" required />
        <input name="name" type="text" placeholder="Display name" autocomplete="nickname" maxlength="32" hidden />
        <p class="acct-error" role="alert" hidden></p>
        <div class="name-buttons">
          <button type="button" class="name-back acct-switch">Create an account</button>
          <button type="button" class="name-back acct-close">Close</button>
          <button type="submit" class="name-ok">Sign in</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const q = <T extends Element>(s: string) => overlay.querySelector(s) as T;
    const form = q<HTMLFormElement>('form');
    const email = q<HTMLInputElement>('[name=email]');
    const password = q<HTMLInputElement>('[name=password]');
    const name = q<HTMLInputElement>('[name=name]');
    const error = q<HTMLParagraphElement>('.acct-error');
    const submit = q<HTMLButtonElement>('.name-ok');
    const switcher = q<HTMLButtonElement>('.acct-switch');
    name.value = suggestedName;

    const render = () => {
      q<HTMLLabelElement>('.acct-title').textContent = mode === 'in' ? 'Sign in for cloud saves' : 'Create an account';
      submit.textContent = mode === 'in' ? 'Sign in' : 'Create account';
      switcher.textContent = mode === 'in' ? 'Create an account' : 'I have an account';
      name.hidden = mode === 'in';
      password.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
      error.hidden = true;
    };
    render();
    setTimeout(() => email.focus(), 50);

    const done = (ok: boolean) => {
      overlay.remove();
      if (keyboard) keyboard.enabled = true;
      resolve(ok);
    };
    overlay.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') done(false);
    });
    switcher.addEventListener('click', () => { mode = mode === 'in' ? 'up' : 'in'; render(); });
    q<HTMLButtonElement>('.acct-close').addEventListener('click', () => done(false));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      submit.disabled = true;
      const label = submit.textContent;
      submit.textContent = 'Please wait...';
      const err = mode === 'in'
        ? await signIn(email.value.trim(), password.value)
        : await signUp(email.value.trim(), password.value, name.value.trim() || email.value.split('@')[0]);
      submit.disabled = false;
      submit.textContent = label;
      if (!err) { done(true); return; }
      error.textContent = err;
      error.hidden = false;
    });
  });
}
