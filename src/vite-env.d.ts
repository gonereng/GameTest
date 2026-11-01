/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Neon Auth URL for the branch (public). Cloud saves are off when it's missing. */
  readonly VITE_NEON_AUTH_URL?: string;
  /** The "saves" Neon Function's invocation URL (public). */
  readonly VITE_SAVES_URL?: string;
}
