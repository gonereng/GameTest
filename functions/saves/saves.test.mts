// End-to-end test of the real Function entry (index.ts) against a real Postgres, with tokens signed by a
// local key served as a JWKS (standing in for Neon Auth). Needs DATABASE_URL and the migrations applied.
import http from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const results: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!ok) failed++;
};

const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
const { privateKey: otherKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'EdDSA', use: 'sig' };
const server = http.createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); });
await new Promise<void>(res => server.listen(0, res));
const port = (server.address() as { port: number }).port;
const ISSUER = 'http://127.0.0.1:' + port;
process.env.NEON_AUTH_JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
process.env.NEON_AUTH_BASE_URL = `${ISSUER}/neondb/auth`;

const token = (sub: string, opts: { key?: typeof privateKey; issuer?: string; exp?: string } = {}) =>
  new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: 'test' }).setSubject(sub)
    .setIssuer(opts.issuer ?? ISSUER).setIssuedAt().setExpirationTime(opts.exp ?? '15m').sign(opts.key ?? privateKey);

const app = (await import('./index.ts')).default as { fetch: (r: Request) => Promise<Response> };
const pool = new (await import('pg')).default.Pool({ connectionString: process.env.DATABASE_URL });
const call = (method: string, path: string, init: { token?: string; body?: string; origin?: string; headers?: Record<string, string> } = {}) =>
  app.fetch(new Request('http://fn' + path, {
    method,
    body: init.body,
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.origin ? { origin: init.origin } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  }));

const alice = await token('user-alice'), bob = await token('user-bob');
const aliceSave = { version: 1, playerName: 'Alice', day: 3, gold: 456, inventory: [{ id: 'egg', qty: 2 }] };

// Start clean, so leftovers from an earlier run can't affect the results.
await call('DELETE', '/save', { token: alice });
await call('DELETE', '/save', { token: bob });

check('health is public', (await call('GET', '/health')).status === 200);
check('GET /save without a token -> 401', (await call('GET', '/save')).status === 401);
check('garbage token -> 401', (await call('GET', '/save', { token: 'not.a.jwt' })).status === 401);
check('token signed by another key -> 401', (await call('GET', '/save', { token: await token('user-alice', { key: otherKey }) })).status === 401);
check('token from another issuer -> 401', (await call('GET', '/save', { token: await token('user-alice', { issuer: 'https://evil.example' }) })).status === 401);
check('expired token -> 401', (await call('GET', '/save', { token: await token('user-alice', { exp: '-1m' }) })).status === 401);
check('Alice has no save yet -> 404', (await call('GET', '/save', { token: alice })).status === 404);

const put = await call('PUT', '/save', { token: alice, body: JSON.stringify(aliceSave) });
const putBody = await put.json() as { updatedAt?: string };
check('Alice saves -> 200 with updatedAt', put.status === 200 && !!putBody.updatedAt, `status ${put.status}`);
const got = await call('GET', '/save', { token: alice });
const gotBody = await got.json() as { save: typeof aliceSave };
// jsonb stores keys in its own order, so compare the data, not the text.
check('Alice loads her save back unchanged', got.status === 200 && isDeepStrictEqual(gotBody.save, aliceSave));
check("Bob can't see Alice's save -> 404", (await call('GET', '/save', { token: bob })).status === 404);
await call('PUT', '/save', { token: bob, body: JSON.stringify({ ...aliceSave, playerName: 'Bob', gold: 1 }) });
const again = await (await call('GET', '/save', { token: alice })).json() as { save: typeof aliceSave };
check("Bob saving doesn't touch Alice's save", again.save.playerName === 'Alice' && again.save.gold === 456);
check('a user id in the body grants nothing',
  (await (await call('GET', '/save', { token: bob })).json() as { save: { playerName: string } }).save.playerName === 'Bob');

check('invalid JSON -> 400', (await call('PUT', '/save', { token: alice, body: '{nope' })).status === 400);
check('JSON that is not a save -> 400', (await call('PUT', '/save', { token: alice, body: '{"hello":1}' })).status === 400);
check('array -> 400', (await call('PUT', '/save', { token: alice, body: '[1,2]' })).status === 400);
check('oversized save -> 413', (await call('PUT', '/save', { token: alice, body: JSON.stringify({ version: 1, junk: 'x'.repeat(300 * 1024) }) })).status === 413);
check('PUT without a token -> 401', (await call('PUT', '/save', { body: JSON.stringify(aliceSave) })).status === 401);

const pre = await call('OPTIONS', '/save', { origin: 'https://gonereng.github.io', headers: { 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' } });
check('CORS preflight from the game site is allowed', pre.headers.get('access-control-allow-origin') === 'https://gonereng.github.io', `status ${pre.status}`);
const evil = await call('OPTIONS', '/save', { origin: 'https://evil.example', headers: { 'access-control-request-method': 'PUT' } });
check('CORS preflight from another site gets no allow-origin', !evil.headers.get('access-control-allow-origin'));
const unauth = await call('GET', '/save', { origin: 'https://gonereng.github.io' });
check('401 responses still carry CORS headers', unauth.status === 401 && unauth.headers.get('access-control-allow-origin') === 'https://gonereng.github.io');

check('Alice deletes her save -> 204', (await call('DELETE', '/save', { token: alice })).status === 204);
check('then Alice has no save -> 404', (await call('GET', '/save', { token: alice })).status === 404);
check("and Bob's save is still there", (await call('GET', '/save', { token: bob })).status === 200);

// ------------------------------------------------------------------ profiles, visiting, leaderboards, gifts
const carol = await token('user-carol');
await pool.query("DELETE FROM gifts WHERE from_user LIKE 'user-%' OR to_user LIKE 'user-%'");
await pool.query("DELETE FROM profiles WHERE user_id LIKE 'user-%'");
const json = async (r: Response) => ({ status: r.status, body: await r.json() as Record<string, any> });

check('GET /me without a token -> 401', (await call('GET', '/me')).status === 401);
const meA = await json(await call('GET', '/me', { token: alice }));
check('GET /me makes an 8-letter share code', meA.status === 200 && /^[A-HJ-NP-Z2-9]{8}$/.test(meA.body.code), meA.body.code);
check('leaderboards are opt-in (off by default)', meA.body.onBoards === false);
check('the same code comes back next time', (await json(await call('GET', '/me', { token: alice }))).body.code === meA.body.code);
const meB = await json(await call('GET', '/me', { token: bob }));
check('Bob gets a different code', meB.body.code !== meA.body.code);
check('PUT /me rejects a non-boolean', (await call('PUT', '/me', { token: alice, body: '{"onBoards":"yes"}' })).status === 400);
check('PUT /me opts in', (await json(await call('PUT', '/me', { token: alice, body: '{"onBoards":true}' }))).body.onBoards === true);

// Alice saves a farm with private things in it.
await call('PUT', '/save', { token: alice, body: JSON.stringify({ ...aliceSave, shipped: 900, slimes: 12, soil: { '9,17': { watered: true } }, friends: { pip: { points: 99 } }, quest: { crashDay: 1, launchDay: 3, step: 9, flags: {} } }) });
const dashed = meA.body.code.slice(0, 4).toLowerCase() + '-' + meA.body.code.slice(4).toLowerCase();
const farm = await json(await call('GET', `/farm/${dashed}`));
check('anyone can visit by code (any case, with a dash)', farm.status === 200 && farm.body.farm.playerName === 'Alice' && !!farm.body.farm.soil['9,17']);
check('a visit only shows the farm, not the bag, gold or friendships',
  !('inventory' in farm.body.farm) && !('gold' in farm.body.farm) && !('friends' in farm.body.farm));
check('unknown code -> 404', (await call('GET', '/farm/ZZZZZZZZ')).status === 404);
check('malformed code -> 404', (await call('GET', '/farm/hello')).status === 404);

// Bob saves too but stays off the boards; Carol opts in with a broken save that must not break the query.
await call('PUT', '/save', { token: bob, body: JSON.stringify({ ...aliceSave, playerName: 'Bob', shipped: 5000, slimes: 99 }) });
await call('GET', '/me', { token: carol });
await call('PUT', '/me', { token: carol, body: '{"onBoards":true}' });
await call('PUT', '/save', { token: carol, body: JSON.stringify({ version: 1, playerName: 'Carol', shipped: 'lots', slimes: 40, quest: { crashDay: 2, launchDay: 3 } }) });
const shipped = await json(await call('GET', '/leaderboard/shipped'));
check('leaderboard lists opted-in players only', shipped.status === 200 && !shipped.body.rows.some((r: { name: string }) => r.name === 'Bob'), JSON.stringify(shipped.body.rows));
check('a non-number value is skipped, not an error', shipped.body.rows.length === 1 && shipped.body.rows[0].value === 900);
const slimes = await json(await call('GET', '/leaderboard/slimes'));
check('slimes board is sorted, most first', slimes.body.rows.map((r: { name: string }) => r.name).join() === 'Carol,Alice');
const moon = await json(await call('GET', '/leaderboard/moon'));
check('moon board is sorted, fewest days first', moon.body.rows.map((r: { name: string; value: number }) => `${r.name}:${r.value}`).join() === 'Carol:1,Alice:2', JSON.stringify(moon.body.rows));
check('unknown board -> 404', (await call('GET', '/leaderboard/gold; DROP TABLE saves')).status === 404);

// Gifts
const gift = (tok: string, b: Record<string, unknown>) => call('POST', '/gifts', { token: tok, body: JSON.stringify(b) });
check('POST /gifts without a token -> 401', (await call('POST', '/gifts', { body: '{}' })).status === 401);
check('gift to a bad code -> 400', (await gift(bob, { to: 'nope', item: 'egg', qty: 1 })).status === 400);
check('gift to an unknown code -> 404', (await gift(bob, { to: 'ZZZZZZZZ', item: 'egg', qty: 1 })).status === 404);
check("tools can't be gifted -> 400", (await gift(bob, { to: meA.body.code, item: 'sword', qty: 1 })).status === 400);
check('made-up items -> 400', (await gift(bob, { to: meA.body.code, item: 'diamond', qty: 1 })).status === 400);
check('more than 10 -> 400', (await gift(bob, { to: meA.body.code, item: 'egg', qty: 11 })).status === 400);
check('fractions -> 400', (await gift(bob, { to: meA.body.code, item: 'egg', qty: 1.5 })).status === 400);
check("can't gift yourself -> 400", (await gift(alice, { to: meA.body.code, item: 'egg', qty: 1 })).status === 400);
check('Bob sends Alice 3 eggs -> 201', (await gift(bob, { to: meA.body.code, item: 'egg', qty: 3, note: 'For your omelettes!' })).status === 201);
const inbox = await json(await call('GET', '/gifts', { token: alice }));
const g0 = inbox.body.gifts[0];
check("Alice's mailbox has it, from Bob, with the note", inbox.body.gifts.length === 1 && g0.from === 'Bob' && g0.item === 'egg' && g0.qty === 3 && g0.note === 'For your omelettes!');
check("Bob's mailbox is empty", (await json(await call('GET', '/gifts', { token: bob }))).body.gifts.length === 0);
check("Bob can't claim Alice's gift -> 404", (await call('POST', `/gifts/${g0.id}/claim`, { token: bob })).status === 404);
check('Alice claims it -> 200', (await call('POST', `/gifts/${g0.id}/claim`, { token: alice })).status === 200);
check('claiming twice -> 404 (no duplicate items)', (await call('POST', `/gifts/${g0.id}/claim`, { token: alice })).status === 404);
check('then the mailbox is empty', (await json(await call('GET', '/gifts', { token: alice }))).body.gifts.length === 0);
check('a junk gift id -> 404', (await call('POST', '/gifts/1;2/claim', { token: alice })).status === 404);
let lastStatus = 0;
for (let i = 0; i < 10; i++) lastStatus = (await gift(bob, { to: meA.body.code, item: 'gel', qty: 1 })).status;
check('the 11th gift in a day -> 429', lastStatus === 429);
const corsPost = await call('OPTIONS', '/gifts', { origin: 'https://gonereng.github.io', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
check('CORS allows POST from the game site', (corsPost.headers.get('access-control-allow-methods') ?? '').includes('POST'));
await pool.query("DELETE FROM gifts WHERE from_user LIKE 'user-%' OR to_user LIKE 'user-%'");
await pool.query("DELETE FROM profiles WHERE user_id LIKE 'user-%'");
for (const t of [alice, bob, carol]) await call('DELETE', '/save', { token: t });
await pool.end();

console.log(results.join('\n'));
console.log(failed ? `\n${failed} FAILED` : `\nall ${results.length} checks passed`);
server.close();
process.exit(failed ? 1 : 0);
