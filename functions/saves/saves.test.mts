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

console.log(results.join('\n'));
console.log(failed ? `\n${failed} FAILED` : `\nall ${results.length} checks passed`);
server.close();
process.exit(failed ? 1 : 0);
