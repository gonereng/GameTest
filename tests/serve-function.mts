// Serves the real cloud-save Function (functions/saves/index.ts) over HTTP for local testing.
// Needs DATABASE_URL, NEON_AUTH_JWKS_URL and NEON_AUTH_BASE_URL, exactly like the deployed Function.
//   PORT=7002 tsx tests/serve-function.mts
import http from 'node:http';

const app = (await import('../functions/saves/index.ts')).default as { fetch: (r: Request) => Promise<Response> };
const PORT = Number(process.env.PORT ?? 7002);

http.createServer(async (req, res) => {
  const body = await new Promise<Buffer>(r => { const b: Buffer[] = []; req.on('data', c => b.push(c)); req.on('end', () => r(Buffer.concat(b))); });
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const response = await app.fetch(new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : new Uint8Array(body),
  }));
  const out: Record<string, string> = {};
  response.headers.forEach((v, k) => { out[k] = v; });
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => console.log(`saves function on http://localhost:${PORT}`));
