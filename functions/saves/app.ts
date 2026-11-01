import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Pool } from 'pg';

/** Browser origins allowed to call the API. CORS is not authentication; the JWT check is. */
export const ALLOWED_ORIGINS = [
  'https://gonereng.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];

/** Saves are small JSON (a few KB); this stops anyone storing junk. */
export const MAX_SAVE_BYTES = 256 * 1024;

/** Checks a bearer token and returns the user id, or null if it isn't valid. */
export type VerifyToken = (token: string) => Promise<string | null>;

type Env = { Variables: { userId: string } };

/**
 * The cloud-save API. Every /save route needs a valid Neon Auth token, and only ever
 * touches the row for that token's user, so one player can never read or change another's save.
 *   GET    /save  -> { save, updatedAt } or 404
 *   PUT    /save  -> body is the save object; stores it, returns { updatedAt }
 *   DELETE /save  -> removes it
 */
export function createApp(pool: Pool, verify: VerifyToken) {
  const app = new Hono<Env>();

  app.use('*', cors({
    origin: origin => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    allowMethods: ['GET', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }));

  app.get('/health', c => c.json({ ok: true }));

  app.use('/save', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    if (!header.toLowerCase().startsWith('bearer ')) return c.json({ error: 'Sign in required' }, 401);
    const userId = await verify(header.slice(7).trim());
    if (!userId) return c.json({ error: 'Sign in required' }, 401);
    c.set('userId', userId);
    await next();
  });

  app.get('/save', async c => {
    const { rows } = await pool.query<{ data: unknown; updated_at: Date }>(
      'SELECT data, updated_at FROM saves WHERE user_id = $1', [c.get('userId')]);
    if (!rows.length) return c.json({ error: 'No cloud save yet' }, 404);
    return c.json({ save: rows[0].data, updatedAt: rows[0].updated_at.toISOString() });
  });

  app.put('/save', async c => {
    const text = await c.req.text();
    if (text.length > MAX_SAVE_BYTES) return c.json({ error: 'Save is too large' }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return c.json({ error: 'Save must be JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || (body as { version?: unknown }).version !== 1) {
      return c.json({ error: 'Not a Hollowbrook save' }, 400);
    }
    const { rows } = await pool.query<{ updated_at: Date }>(
      `INSERT INTO saves (user_id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
       RETURNING updated_at`,
      [c.get('userId'), text]);
    return c.json({ updatedAt: rows[0].updated_at.toISOString() });
  });

  app.delete('/save', async c => {
    await pool.query('DELETE FROM saves WHERE user_id = $1', [c.get('userId')]);
    return c.body(null, 204);
  });

  app.onError((err, c) => {
    console.error('saves api error', err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return app;
}
