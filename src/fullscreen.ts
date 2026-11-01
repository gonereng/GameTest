/**
 * Fullscreen helpers. Browsers only allow fullscreen in direct response to a tap, click or key press,
 * so the game goes fullscreen on the player's first input rather than the instant the page loads.
 */

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };

export function isFullscreen(): boolean {
  const d = document as FsDocument;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Installed to the home screen as an app, which is already fullscreen. */
function runningAsApp(): boolean {
  return window.matchMedia('(display-mode: fullscreen)').matches || window.matchMedia('(display-mode: standalone)').matches;
}

export async function enterFullscreen(): Promise<void> {
  if (isFullscreen() || runningAsApp()) return;
  const el = document.documentElement as FsElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return; // e.g. iPhone Safari: no fullscreen for web pages
  } catch {
    return; // the browser said no; the game still works in the window
  }
  // On phones, also keep the game sideways. Not every browser supports this.
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* ignore */
  }
}

export function exitFullscreen(): void {
  const d = document as FsDocument;
  if (d.exitFullscreen) void d.exitFullscreen().catch(() => {});
  else void d.webkitExitFullscreen?.();
}

export function toggleFullscreen(): void {
  if (isFullscreen()) exitFullscreen();
  else void enterFullscreen();
}

/** Go fullscreen on the first tap, click or key press. Only once: if the player leaves fullscreen, respect that. */
export function fullscreenOnFirstInput(): void {
  const events = ['pointerup', 'touchend', 'keydown'] as const;
  const handler = (e: Event) => {
    if (e instanceof KeyboardEvent && (e.key === 'Escape' || e.key === 'F11')) return;
    for (const t of events) window.removeEventListener(t, handler, true);
    void enterFullscreen();
  };
  for (const t of events) window.addEventListener(t, handler, true);
}
