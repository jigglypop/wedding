import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { HttpError } from './db';

export const cookieName = 'wedding_session';
const sessionDays = 30;
const scryptParams = { N:16384, r:8, p:1 };
const dummySalt = randomBytes(16);

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 24) throw new HttpError(503, '서버 로그인 설정이 필요합니다.');
  return value;
}
const sign = (input:string) => createHmac('sha256', secret()).update(input).digest('base64url');
export const keyedHash = (input:string) => createHmac('sha256', secret()).update(input).digest('base64url');
export const sha256 = (input:string) => createHash('sha256').update(input).digest('base64url');
export function safeEqual(a:string, b:string) { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }

function derive(password:string, salt:Buffer, length:number, params = scryptParams) {
  return new Promise<Buffer>((done, fail) => scrypt(password.normalize('NFKC'), salt, length, { ...params, maxmem:64 * 1024 * 1024 }, (error, key) => error ? fail(error) : done(key)));
}
export async function hashPassword(password:string) {
  const salt = randomBytes(16); const key = await derive(password, salt, 32);
  return `scrypt$${scryptParams.N}$${scryptParams.r}$${scryptParams.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
// Always spends one scrypt derivation so unknown accounts take as long as wrong passwords.
export async function verifyPassword(password:string, stored?:string) {
  const [scheme, N, r, p, salt, hash] = (stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) { await derive(password, dummySalt, 32); return false; }
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(password, Buffer.from(salt, 'base64url'), expected.length, { N:Number(N), r:Number(r), p:Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export type Session = { u:string; a:string; v:number; e:number };
const cookieFlags = (maxAge:number) => `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
export function sessionCookie(user:{ username:string; accountId:string; sessionVersion:number }|null) {
  if (!user) return `${cookieName}=; ${cookieFlags(0)}`;
  const body = Buffer.from(JSON.stringify({ u:user.username, a:user.accountId, v:user.sessionVersion, e:Date.now() + sessionDays * 86400000 } satisfies Session)).toString('base64url');
  return `${cookieName}=${body}.${sign(body)}; ${cookieFlags(sessionDays * 86400)}`;
}
export function readSession(cookies:string):Session|null {
  try {
    const token = cookies.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
    const [body, sig] = token.split('.');
    if (!body || !sig || !safeEqual(sig, sign(body))) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as Partial<Session>;
    return typeof data.u === 'string' && typeof data.a === 'string' && typeof data.v === 'number' && typeof data.e === 'number' && data.e > Date.now() ? data as Session : null;
  } catch { return null; }
}
export const sessionNeedsRefresh = (session:Session) => session.e - Date.now() < (sessionDays - 7) * 86400000;
export const randomToken = (bytes = 18) => randomBytes(bytes).toString('base64url');
