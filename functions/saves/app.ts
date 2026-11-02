import { randomInt } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
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

/** Items players may send each other. Tools, the Slime Suit and story items can't be gifted. */
export const GIFTABLE = new Set([
  'seed_strawberry', 'seed_onion', 'seed_potato', 'seed_leek', 'seed_moonmelon',
  'strawberry', 'onion', 'potato', 'leek', 'moonmelon', 'egg', 'golden_egg', 'milk',
  'gel', 'core', 'berry', 'mushroom', 'bread', 'sprinkler',
  'soup', 'omelette', 'tart', 'stew', 'pie',
]);
export const MAX_GIFT_QTY = 10;
/** Gifts one player can send in 24 hours, and gifts that can wait in one mailbox. */
export const GIFTS_PER_DAY = 10;
export const MAILBOX_SIZE = 50;

/** Share codes: 8 characters with no look-alikes (no 0/O, 1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newShareCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
/** Accepts "abcd-efgh", "ABCD EFGH" or "ABCDEFGH". Returns null if it can't be a code. */
export function normalizeCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return code.length === 8 && [...code].every(ch => CODE_ALPHABET.includes(ch)) ? code : null;
}

/** The parts of a save a visitor needs to draw someone's farm. Nothing else leaves the server. */
const FARM_FIELDS = ['version', 'playerName', 'day', 'soil', 'sprinklers', 'weather', 'quest', 'shipped', 'slimes'];

/** Leaderboards. Values come from players' saves; only numbers count, so a malformed save can't break the query. */
const num = (path: string) => `CASE WHEN jsonb_typeof(s.data #> '{${path}}') = 'number' THEN (s.data #>> '{${path}}')::numeric END`;
export const BOARDS: Record<string, { title: string; value: string; order: 'ASC' | 'DESC' }> = {
  shipped: { title: 'Most gold earned', value: num('shipped'), order: 'DESC' },
  slimes: { title: 'Most slimes defeated', value: num('slimes'), order: 'DESC' },
  // Days from the moon falling to Gerald going home. Fewer is better.
  moon: { title: 'Fastest moon rescue (days)', value: `(${num('quest,launchDay')} - ${num('quest,crashDay')})`, order: 'ASC' },
};

/** Checks a bearer token and returns the user id, or null if it isn't valid. */
export type VerifyToken = (token: string) => Promise<string | null>;

type Env = { Variables: { userId: string } };

/**
 * The cloud API. /save, /me and /gifts need a valid Neon Auth token and only ever act as that token's
 * user, so one player can never read or change another's save. /farm and /leaderboard are public.
 *   GET    /save                -> { save, updatedAt } or 404
 *   PUT    /save                -> body is the save object; stores it, returns { updatedAt }
 *   DELETE /save                -> removes it
 *   GET    /me, PUT /me         -> your share code and leaderboard opt-in
 *   GET    /farm/:code          -> the farm part of a save, for visiting
 *   GET    /leaderboard/:board  -> top 10 opted-in players (shipped, slimes, moon)
 *   POST   /gifts               -> send a gift to a share code
 *   GET    /gifts               -> gifts waiting for you
 *   POST   /gifts/:id/claim     -> collect one
 */
export function createApp(pool: Pool, verify: VerifyToken) {
  const app = new Hono<Env>();

  app.use('*', cors({
    origin: origin => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    allowMethods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }));

  app.get('/health', c => c.json({ ok: true }));

  const signedIn: MiddlewareHandler<Env> = async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    if (!header.toLowerCase().startsWith('bearer ')) return c.json({ error: 'Sign in required' }, 401);
    const userId = await verify(header.slice(7).trim());
    if (!userId) return c.json({ error: 'Sign in required' }, 401);
    c.set('userId', userId);
    await next();
  };
  app.use('/save', signedIn);
  app.use('/me', signedIn);
  app.use('/gifts', signedIn);
  app.use('/gifts/*', signedIn);

  /** The player's profile, created with a fresh share code the first time. */
  async function profile(userId: string): Promise<{ share_code: string; on_boards: boolean }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { rows } = await pool.query<{ share_code: string; on_boards: boolean }>(
        `WITH made AS (
           INSERT INTO profiles (user_id, share_code) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING share_code, on_boards
         )
         SELECT share_code, on_boards FROM made UNION ALL SELECT share_code, on_boards FROM profiles WHERE user_id = $1`,
        [userId, newShareCode()]);
      if (rows.length) return rows[0];
      // The random code was already taken by someone else (very unlikely): try another.
    }
    throw new Error('could not make a share code');
  }

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

  // ------------------------------------------------------------------ profile

  /** GET /me -> { code, onBoards } */
  app.get('/me', async c => {
    const p = await profile(c.get('userId'));
    return c.json({ code: p.share_code, onBoards: p.on_boards });
  });

  /** PUT /me { onBoards } -> { code, onBoards } */
  app.put('/me', async c => {
    const body = await c.req.json().catch(() => null) as { onBoards?: unknown } | null;
    if (typeof body?.onBoards !== 'boolean') return c.json({ error: 'onBoards must be true or false' }, 400);
    const p = await profile(c.get('userId'));
    await pool.query('UPDATE profiles SET on_boards = $2 WHERE user_id = $1', [c.get('userId'), body.onBoards]);
    return c.json({ code: p.share_code, onBoards: body.onBoards });
  });

  // ------------------------------------------------------------------ visiting (public, by code)

  /** GET /farm/:code -> { farm } with only the fields needed to draw it, or 404. */
  app.get('/farm/:code', async c => {
    const code = normalizeCode(c.req.param('code'));
    if (!code) return c.json({ error: 'No farm with that code' }, 404);
    const { rows } = await pool.query<{ data: Record<string, unknown> }>(
      'SELECT s.data FROM profiles p JOIN saves s ON s.user_id = p.user_id WHERE p.share_code = $1', [code]);
    if (!rows.length) return c.json({ error: 'No farm with that code' }, 404);
    const farm = Object.fromEntries(FARM_FIELDS.filter(k => k in rows[0].data).map(k => [k, rows[0].data[k]]));
    return c.json({ farm });
  });

  // ------------------------------------------------------------------ leaderboards (public)

  /** GET /leaderboard/:board -> { title, rows: [{ name, value }] }, top 10 of the players who opted in. */
  app.get('/leaderboard/:board', async c => {
    const board = BOARDS[c.req.param('board')];
    if (!board) return c.json({ error: 'No such leaderboard' }, 404);
    const { rows } = await pool.query<{ name: string | null; value: string }>(
      `SELECT left(s.data ->> 'playerName', 16) AS name, v.value::text AS value
         FROM profiles p JOIN saves s ON s.user_id = p.user_id, LATERAL (SELECT ${board.value} AS value) v
        WHERE p.on_boards AND v.value IS NOT NULL AND v.value >= 0
        ORDER BY v.value ${board.order}, s.updated_at ASC
        LIMIT 10`);
    return c.json({ title: board.title, rows: rows.map(r => ({ name: r.name || 'Farmer', value: Number(r.value) })) });
  });

  // ------------------------------------------------------------------ gifts

  /** POST /gifts { to, item, qty, note? } -> 201. The sender takes the items out of their own bag. */
  app.post('/gifts', async c => {
    const body = await c.req.json().catch(() => null) as { to?: unknown; item?: unknown; qty?: unknown; note?: unknown } | null;
    const to = typeof body?.to === 'string' ? normalizeCode(body.to) : null;
    if (!to) return c.json({ error: "That isn't a farm code" }, 400);
    if (typeof body?.item !== 'string' || !GIFTABLE.has(body.item)) return c.json({ error: "That can't be sent as a gift" }, 400);
    const qty = body.qty;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_GIFT_QTY) {
      return c.json({ error: `You can send 1 to ${MAX_GIFT_QTY} at a time` }, 400);
    }
    const note = typeof body.note === 'string' ? body.note.slice(0, 80) : '';
    const from = c.get('userId');
    const { rows: target } = await pool.query<{ user_id: string }>('SELECT user_id FROM profiles WHERE share_code = $1', [to]);
    if (!target.length) return c.json({ error: 'No farm with that code' }, 404);
    if (target[0].user_id === from) return c.json({ error: "That's your own farm" }, 400);
    const { rows: [counts] } = await pool.query<{ sent: string; waiting: string }>(
      `SELECT (SELECT count(*) FROM gifts WHERE from_user = $1 AND created_at > now() - interval '1 day') AS sent,
              (SELECT count(*) FROM gifts WHERE to_user = $2 AND claimed_at IS NULL) AS waiting`,
      [from, target[0].user_id]);
    if (Number(counts.sent) >= GIFTS_PER_DAY) return c.json({ error: `You can send ${GIFTS_PER_DAY} gifts a day. Try again tomorrow.` }, 429);
    if (Number(counts.waiting) >= MAILBOX_SIZE) return c.json({ error: 'Their mailbox is full' }, 409);
    await pool.query('INSERT INTO gifts (from_user, to_user, item, qty, note) VALUES ($1, $2, $3, $4, $5)',
      [from, target[0].user_id, body.item, qty, note]);
    return c.json({ ok: true }, 201);
  });

  /** GET /gifts -> { gifts: [{ id, from, item, qty, note }] } waiting for you, oldest first. */
  app.get('/gifts', async c => {
    const { rows } = await pool.query<{ id: string; from_name: string | null; item: string; qty: number; note: string }>(
      `SELECT g.id::text, left(s.data ->> 'playerName', 16) AS from_name, g.item, g.qty, g.note
         FROM gifts g LEFT JOIN saves s ON s.user_id = g.from_user
        WHERE g.to_user = $1 AND g.claimed_at IS NULL
        ORDER BY g.id LIMIT ${MAILBOX_SIZE}`, [c.get('userId')]);
    return c.json({ gifts: rows.map(r => ({ id: r.id, from: r.from_name || 'A farmer', item: r.item, qty: r.qty, note: r.note })) });
  });

  /** POST /gifts/:id/claim -> 200 once; 404 if it isn't yours or was already collected. */
  app.post('/gifts/:id/claim', async c => {
    const id = c.req.param('id');
    if (!/^\d{1,18}$/.test(id)) return c.json({ error: 'No such gift' }, 404);
    const { rowCount } = await pool.query(
      'UPDATE gifts SET claimed_at = now() WHERE id = $1 AND to_user = $2 AND claimed_at IS NULL', [id, c.get('userId')]);
    return rowCount ? c.json({ ok: true }) : c.json({ error: 'No such gift' }, 404);
  });

  app.onError((err, c) => {
    console.error('saves api error', err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return app;
}
