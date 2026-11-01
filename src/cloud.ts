import { createAuthClient } from '@neon/auth';
import type { GameState } from './state';

/**
 * Accounts and cloud saves. Sign-in is Neon Auth; saves go to the "saves" Neon Function, which checks the
 * login token and stores one save per player in Postgres. The database itself is never reachable from here.
 * Everything here is optional: without the two URLs (or offline) the game keeps saving on this device.
 */

const AUTH_URL = import.meta.env.VITE_NEON_AUTH_URL;
const SAVES_URL = import.meta.env.VITE_SAVES_URL?.replace(/\/$/, '');

export const cloudEnabled = !!(AUTH_URL && SAVES_URL);
const auth = cloudEnabled ? createAuthClient(AUTH_URL!) : null;

export interface CloudUser { id: string; email: string; name: string }
let user: CloudUser | null = null;

export const currentUser = () => user;

function message(error: unknown, fallback: string): string {
  const m = (error as { message?: string } | null)?.message;
  return m && m.length < 160 ? m : fallback;
}

/** Restores the signed-in player from the browser's session, if there is one. */
export async function refreshSession(): Promise<CloudUser | null> {
  if (!auth) return null;
  try {
    const { data } = await auth.getSession();
    const u = data?.user;
    user = u ? { id: u.id, email: u.email, name: u.name } : null;
  } catch {
    user = null;
  }
  return user;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!auth) return 'Cloud saves are not set up.';
  try {
    const { error } = await auth.signIn.email({ email, password });
    if (error) return message(error, 'Wrong email or password.');
    await refreshSession();
    return user ? null : 'Signed in, but the session could not be read.';
  } catch (e) {
    return message(e, 'Could not reach the sign-in service. Check your connection.');
  }
}

export async function signUp(email: string, password: string, name: string): Promise<string | null> {
  if (!auth) return 'Cloud saves are not set up.';
  try {
    const { error } = await auth.signUp.email({ email, password, name });
    if (error) return message(error, 'Could not create the account.');
    await refreshSession();
    return user ? null : 'Account created. Please sign in.';
  } catch (e) {
    return message(e, 'Could not reach the sign-in service. Check your connection.');
  }
}

export async function signOut(): Promise<void> {
  try { await auth?.signOut(); } catch { /* signed out locally anyway */ }
  user = null;
}

/** A short-lived token proving who the player is, for the saves API. */
async function bearer(): Promise<string | null> {
  if (!auth || !user) return null;
  try {
    // Neon's guidance: `.token()` (from Better Auth's JWT plugin, which @neon/auth loads, though its
    // types don't declare it). Fall back to the session's token, which is what @neon/auth's own
    // getJWTToken() reads.
    const withToken = auth as unknown as { token?: () => Promise<{ data?: { token?: string } | null }> };
    if (typeof withToken.token === 'function') {
      const { data } = await withToken.token();
      if (data?.token) return data.token;
    }
    const { data } = await auth.getSession();
    return (data?.session as { token?: string } | undefined)?.token ?? null;
  } catch {
    return null;
  }
}

/** Uploads the save. Returns true when the cloud has it. */
export async function uploadSave(save: GameState): Promise<boolean> {
  const token = await bearer();
  if (!token) return false;
  try {
    const res = await fetch(`${SAVES_URL}/save`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(save),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The player's cloud save, null if there is none, or undefined if it couldn't be checked. */
export async function downloadSave(): Promise<Partial<GameState> | null | undefined> {
  const token = await bearer();
  if (!token) return undefined;
  try {
    const res = await fetch(`${SAVES_URL}/save`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    return ((await res.json()) as { save: Partial<GameState> }).save;
  } catch {
    return undefined;
  }
}
