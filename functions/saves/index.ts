// Neon Function entry point: wires the cloud-save API to the branch's Postgres and Neon Auth.
// DATABASE_URL, NEON_AUTH_JWKS_URL and NEON_AUTH_BASE_URL are injected by Neon.
import { attachDatabasePool } from '@neon/functions';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Pool } from 'pg';
import { createApp } from './app';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

const jwks = createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL!));
const issuer = new URL(process.env.NEON_AUTH_BASE_URL!).origin;

export default createApp(pool, async token => {
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
});
