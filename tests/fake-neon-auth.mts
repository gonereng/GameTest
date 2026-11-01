// TEST STAND-IN for Neon Auth, used only to exercise the game's sign-in and cloud-save flow locally.
// It speaks the subset of the Better Auth HTTP API that @neon/auth calls, sets a session cookie, sends the
// JWT in a `set-auth-jwt` header like Neon does, and serves its public keys at /.well-known/jwks.json.
//   PORT=7001 tsx tests/fake-neon-auth.mts
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const PORT = Number(process.env.PORT ?? 7001);
const ORIGIN = `http://localhost:${PORT}`;
const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
const jwk = { ...(await exportJWK(publicKey)), kid: 'fake', alg: 'EdDSA', use: 'sig' };

type User = { id: string; email: string; name: string; password: string; createdAt: string; updatedAt: string; emailVerified: boolean };
const users = new Map<string, User>();          // by email
const sessions = new Map<string, string>();     // session id -> email

const jwt = (u: User) => new SignJWT({ email: u.email }).setProtectedHeader({ alg: 'EdDSA', kid: 'fake' })
  .setSubject(u.id).setIssuer(ORIGIN).setIssuedAt().setExpirationTime('15m').sign(privateKey);
const publicUser = ({ password: _p, ...u }: User) => u;

http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? '';
  res.setHeader('access-control-allow-origin', origin || '*');
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-expose-headers', 'set-auth-jwt');
  res.setHeader('vary', 'origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'] ?? '*');
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url ?? '/', ORIGIN);
  const path = url.pathname.replace(/^\/neondb\/auth/, '');
  const body = await new Promise<string>(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b)); });
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(data));
  };
  const sid = /(?:^|;\s*)fake_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const me = sid && sessions.has(sid) ? users.get(sessions.get(sid)!) : undefined;
  const startSession = async (u: User) => {
    const id = randomUUID();
    sessions.set(id, u.email);
    const token = await jwt(u);
    json(200, { token, user: publicUser(u) }, { 'set-cookie': `fake_session=${id}; Path=/; HttpOnly; SameSite=Lax`, 'set-auth-jwt': token });
  };

  if (path === '/.well-known/jwks.json') return json(200, { keys: [jwk] });
  if (path === '/sign-up/email' && req.method === 'POST') {
    const { email, password, name } = JSON.parse(body || '{}');
    if (!email || !password || password.length < 8) return json(400, { code: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 8 characters' });
    if (users.has(email)) return json(422, { code: 'USER_ALREADY_EXISTS', message: 'User already exists' });
    const now = new Date().toISOString();
    const u = { id: randomUUID(), email, name, password, createdAt: now, updatedAt: now, emailVerified: false };
    users.set(email, u);
    return startSession(u);
  }
  if (path === '/sign-in/email' && req.method === 'POST') {
    const { email, password } = JSON.parse(body || '{}');
    const u = users.get(email);
    if (!u || u.password !== password) return json(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' });
    return startSession(u);
  }
  if (path === '/get-session') {
    if (!me) return json(200, null);
    const token = await jwt(me);
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    return json(200, { session: { id: sid, token, userId: me.id, expiresAt, createdAt: me.createdAt, updatedAt: me.updatedAt }, user: publicUser(me) }, { 'set-auth-jwt': token });
  }
  if (path === '/token') return me ? json(200, { token: await jwt(me) }) : json(401, { message: 'Unauthorized' });
  if (path === '/sign-out' && req.method === 'POST') {
    if (sid) sessions.delete(sid);
    return json(200, { success: true }, { 'set-cookie': 'fake_session=; Path=/; Max-Age=0' });
  }
  json(404, { message: `fake auth: no route ${req.method} ${path}` });
}).listen(PORT, () => console.log(`fake Neon Auth on ${ORIGIN}/neondb/auth`));
