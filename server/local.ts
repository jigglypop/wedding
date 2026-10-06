import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

// Local development settings live in .local/dev-access.json; the admin can also come from WEDDING_ADMIN_* in .env.
type DevAccess = { secret:string; adminUsername?:string; adminPassword?:string };
let access:DevAccess;
try { access = JSON.parse(await readFile('.local/dev-access.json', 'utf8')); } catch { access = { secret:randomBytes(32).toString('hex') }; }
if (!access.secret || access.secret.length < 24) access.secret = randomBytes(32).toString('hex');
if (!process.env.WEDDING_ADMIN_USERNAME && !access.adminUsername) { access.adminUsername = 'devadmin'; access.adminPassword = `dev${randomBytes(6).toString('hex')}7`; }
await mkdir('.local', { recursive:true });
await writeFile('.local/dev-access.json', JSON.stringify({ secret:access.secret, adminUsername:access.adminUsername, adminPassword:access.adminPassword }, null, 2));
process.env.SESSION_SECRET ||= access.secret;
process.env.ADMIN_USERNAME ||= process.env.WEDDING_ADMIN_USERNAME || access.adminUsername || '';
process.env.ADMIN_PASSWORD ||= process.env.WEDDING_ADMIN_PASSWORD || access.adminPassword || '';

const { handler } = await import('./index');
createServer(async (req, res) => {
  try {
    const chunks:Buffer[] = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 4500000) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    const url = new URL(req.url || '/', 'http://localhost');
    const output = await handler({ rawPath:url.pathname, rawQueryString:url.searchParams.toString(), headers:req.headers as Record<string, string>, body:Buffer.concat(chunks).toString(), requestContext:{ http:{ method:req.method || 'GET', sourceIp:req.socket.remoteAddress } } });
    res.writeHead(output.statusCode, { ...output.headers, ...(output.cookies ? { 'set-cookie':output.cookies } : {}) });
    res.end(req.method === 'HEAD' ? undefined : output.isBase64Encoded ? Buffer.from(output.body, 'base64') : output.body);
  } catch { res.writeHead(500); res.end(); }
}).listen(8787, '127.0.0.1', () => console.log(`Wedding API http://127.0.0.1:8787 · 관리자 아이디: ${process.env.ADMIN_USERNAME} (비밀번호는 .env 또는 .local/dev-access.json)`));
