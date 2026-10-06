import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { z } from 'zod';
import type { ChatMessage, Collection, Material, PlanState } from '../src/types';
import { HttpError, limit, storageKind } from './db';
import { hashPassword, safeEqual, sessionCookie, sessionNeedsRefresh, sha256, verifyPassword } from './auth';
import { acceptInviteAsUser, acceptInviteWithSignup, adminAction, createInvite, createWorkspace, detachMember, ensureAdmin, getUser, getWorkspace, listUsers, nameSchema, oppositeSide, passwordSchema, publicUser, resolveInvite, revokeInvite, sessionUser, sideSchema, signUp, updateUser, usernameSchema, workspaceInfo, type UserRecord } from './accounts';
import { MAIN_WORKSPACE, addMaterial, getMaterials, getState, mutateState, removeMaterial, saveState, uploadedMaterials } from './store';
import { ValidationError, addActivity, applyProposals, collectionLabels, collections, itemLabel, itemSchemas, settingsSchema, validateState } from './model';
import { runAgent } from './agent';
import { deleteUpload, matchesSignature, mimeByExtension, mimeOf, readLocalFile, remoteFiles, saveUpload, signedUrl } from './files';

type Event = { rawPath:string; rawQueryString?:string; headers:Record<string, string|undefined>; cookies?:string[]; body?:string; isBase64Encoded?:boolean; requestContext:{ http:{ method:string; sourceIp?:string } } };
type Result = { statusCode:number; headers:Record<string, string>; body:string; cookies?:string[]; isBase64Encoded?:boolean };
const baseHeaders = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'same-origin', 'x-frame-options':'DENY' };
const json = (statusCode:number, data:unknown, cookies?:string[]):Result => ({ statusCode, headers:baseHeaders, body:JSON.stringify(data), ...(cookies?.length ? { cookies } : {}) });
const redirect = (location:string, cache = 'no-store'):Result => ({ statusCode:302, headers:{ ...baseHeaders, 'cache-control':cache, location }, body:'' });
const materialSummary = ({ content:_content, ...rest }:Material):Material => rest;
const collectionSchema = z.enum(collections as [Collection, ...Collection[]]);
const loginSchema = z.object({ username:z.string().trim().toLowerCase().max(100), password:z.string().min(1, '비밀번호를 입력해 주세요.').max(200) });
const tooMany = '로그인 시도가 많아요. 15분 뒤 다시 시도해 주세요.';

function parseBody(event:Event):unknown {
  if (!event.body) return {};
  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
  if (Buffer.byteLength(body) > 4500000) throw new HttpError(413, '파일은 3MB 이하로 올려 주세요.');
  try { return JSON.parse(body); } catch { throw new HttpError(400, '요청 내용을 확인해 주세요.'); }
}
// CloudFront appends the viewer address to X-Forwarded-For, so values a client sends itself are ignored.
function clientIp(headers:Record<string, string|undefined>, sourceIp?:string) {
  const viewer = headers['cloudfront-viewer-address'];
  if (viewer) return viewer.replace(/:\d+$/, '');
  const chain = (headers['x-forwarded-for'] || '').split(',').map(v => v.trim()).filter(Boolean);
  while (chain.length > 1 && chain[chain.length - 1] === sourceIp) chain.pop();
  return chain[chain.length - 1] || sourceIp || 'unknown';
}
async function checkCredentials(input:{ username:string; password:string }, ip:string) {
  await limit(`login-ip:${sha256(ip)}`, 20, 900, tooMany);
  await limit(`login-user:${sha256(input.username)}`, 10, 900, tooMany);
  if (input.username && input.username === (process.env.ADMIN_USERNAME || '').trim().toLowerCase()) await ensureAdmin();
  const user = /^[a-z0-9_]{1,40}$/.test(input.username) ? await getUser(input.username) : null;
  if (!(await verifyPassword(input.password, user?.passwordHash)) || !user) throw new HttpError(401, '아이디 또는 비밀번호를 확인해 주세요.');
  if (user.status === 'suspended') throw new HttpError(403, '이용이 잠시 중지된 계정이에요. 관리자에게 문의해 주세요.', 'suspended');
  return user;
}
const escapeHtml = (value:string) => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));

// Serves the app shell for invite links with link-preview text naming the inviter (KakaoTalk, messengers).
let indexTemplate:string|null|undefined;
async function invitePage(code:string):Promise<Result> {
  if (indexTemplate === undefined) { try { indexTemplate = await readFile(resolve(process.cwd(), 'index.html'), 'utf8'); } catch { indexTemplate = null; } }
  if (!indexTemplate) return redirect(`/?invite=${encodeURIComponent(code)}`);
  let title = '우리의 웨딩 노트 초대장';
  let description = '결혼 준비를 함께 기록해요. 링크를 눌러 가입하면 같은 노트를 바로 함께 쓸 수 있어요.';
  try {
    const { invite } = await resolveInvite(code);
    const who = invite.side === 'bride' ? '신부님, ' : invite.side === 'groom' ? '신랑님, ' : '';
    title = `${invite.inviterName}님이 우리의 웨딩 노트에 초대했어요`;
    description = `${who}결혼 준비를 함께 기록해요. 링크를 눌러 가입하면 같은 노트를 바로 함께 쓸 수 있어요.`;
  } catch {}
  const html = indexTemplate
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
    .replace(/(<meta (?:property|name)="(?:og:title|twitter:title)" content=")[^"]*(")/g, (_, start:string, end:string) => start + escapeHtml(title) + end)
    .replace(/(<meta (?:property|name)="(?:og:description|twitter:description|description)" content=")[^"]*(")/g, (_, start:string, end:string) => start + escapeHtml(description) + end)
    .replace(/(<meta property="og:url" content=")([^"]*)(")/, (_, start:string, url:string, end:string) => `${start}${escapeHtml(url.replace(/\/$/, ''))}/invite/${encodeURIComponent(code)}${end}`);
  return { statusCode:200, headers:{ 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer' }, body:html };
}

export async function handler(event:Event):Promise<Result> {
  try {
    const path = event.rawPath || '/'; const method = event.requestContext.http.method;
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (process.env.NODE_ENV === 'production' && (!process.env.ORIGIN_VERIFY_TOKEN || !safeEqual(headers['x-wedding-origin-token'] || '', process.env.ORIGIN_VERIFY_TOKEN))) throw new HttpError(403, '허용되지 않는 접근입니다.');
    if (method === 'OPTIONS') return json(403, { error:'다른 사이트에서는 접근할 수 없습니다.' });
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '다른 사이트에서는 변경할 수 없습니다.');
    const cookies = [...(event.cookies || []), headers.cookie || ''].join(';');
    const ip = clientIp(headers, event.requestContext.http.sourceIp);
    const query = new URLSearchParams(event.rawQueryString || '');

    if ((method === 'GET' || method === 'HEAD') && path.startsWith('/invite/')) return invitePage(decodeURIComponent(path.slice('/invite/'.length).split('/')[0]));
    if (path === '/api/health' && method === 'GET') return json(200, { ok:true, service:'wedding-planner', version:process.env.RELEASE_ID || 'local', storage:storageKind, agentReady:!!process.env.OPENAI_API_KEY });

    // Public account endpoints
    if (path === '/api/session' && method === 'GET') { const auth = await sessionUser(cookies); return json(200, { authenticated:!!auth, user:auth ? publicUser(auth.user) : null }); }
    if (path === '/api/logout' && method === 'POST') return json(200, { ok:true }, [sessionCookie(null)]);
    if (path === '/api/login' && method === 'POST') {
      const user = await checkCredentials(loginSchema.parse(parseBody(event)), ip);
      if (user.status === 'pending') throw new HttpError(403, '가입 신청을 확인하고 있어요. 관리자 승인 후 로그인할 수 있어요.', 'pending');
      const updated = await updateUser(user.username, u => ({ ...u, lastLoginAt:new Date().toISOString() }));
      return json(200, { user:publicUser(updated) }, [sessionCookie(updated)]);
    }
    if (path === '/api/signup' && method === 'POST') {
      await limit(`signup-ip:${sha256(ip)}`, 10, 3600, '가입 신청이 많아요. 잠시 후 다시 시도해 주세요.');
      const input = z.object({ username:usernameSchema, password:passwordSchema, name:nameSchema, side:z.enum(['groom', 'bride']) }).parse(parseBody(event));
      await limit('signup-all', 100, 86400, '오늘은 가입 신청이 많아요. 내일 다시 시도해 주세요.');
      await signUp(input);
      return json(201, { status:'pending' });
    }
    const invitePath = path.match(/^\/api\/invites\/([A-Za-z0-9_-]{1,64})(\/accept)?$/);
    if (invitePath && method === 'GET' && !invitePath[2]) {
      await limit(`invite-view:${sha256(ip)}`, 60, 900);
      const { invite } = await resolveInvite(invitePath[1]);
      return json(200, { invite:{ inviterName:invite.inviterName, side:invite.side, expiresAt:new Date(invite.expiresAt * 1000).toISOString() } });
    }
    if (invitePath && method === 'POST' && invitePath[2]) {
      await limit(`invite-accept:${sha256(ip)}`, 15, 3600, '요청이 많아요. 잠시 후 다시 시도해 주세요.');
      const body = parseBody(event); const code = invitePath[1];
      const { mode } = z.object({ mode:z.enum(['signup', 'login', 'session']) }).parse(body);
      let user:UserRecord;
      if (mode === 'signup') user = await acceptInviteWithSignup(code, z.object({ username:usernameSchema, password:passwordSchema, name:nameSchema }).parse(body));
      else if (mode === 'login') user = await acceptInviteAsUser(code, await checkCredentials(loginSchema.parse(body), ip));
      else { const auth = await sessionUser(cookies); if (!auth) throw new HttpError(401, '로그인이 필요해요.', 'unauthorized'); user = await acceptInviteAsUser(code, auth.user); }
      return json(200, { user:publicUser(user) }, [sessionCookie(user)]);
    }

    const auth = await sessionUser(cookies);
    if (!auth) throw new HttpError(401, '로그인이 필요해요.', 'unauthorized');
    const { user, session } = auth; const ws = user.workspaceId;
    const refreshed = sessionNeedsRefresh(session) ? [sessionCookie(user)] : undefined;

    if (path === '/api/bootstrap' && method === 'GET') {
      if (!(await getWorkspace(ws))) await createWorkspace(user.username, ws).catch(() => undefined);
      const [state, materials, workspace] = await Promise.all([getState(ws), getMaterials(ws), workspaceInfo(ws)]);
      return json(200, { user:publicUser(user), workspace, state, materials:materials.map(materialSummary), agentReady:!!process.env.OPENAI_API_KEY, model:process.env.OPENAI_MODEL || 'gpt-6.1-sol', privateLibrary:ws === MAIN_WORKSPACE }, refreshed);
    }
    if (path === '/api/state' && method === 'GET') {
      const state = await getState(ws);
      return json(200, Number(query.get('since')) === state.version ? { unchanged:true, version:state.version } : { state }, refreshed);
    }
    if (path === '/api/workspace' && method === 'GET') return json(200, { workspace:await workspaceInfo(ws) });
    if (path === '/api/state' && method === 'PUT') {
      const { state:incoming, version } = z.object({ state:z.record(z.string(), z.unknown()), version:z.number().int().positive() }).parse(parseBody(event));
      const current = await getState(ws);
      if (current.version !== version) throw new HttpError(409, '다른 화면에서 먼저 변경되었어요. 최신 내용을 불러온 뒤 다시 시도해 주세요.', 'conflict');
      let next:PlanState;
      try { next = validateState({ ...incoming, version:current.version, updatedAt:current.updatedAt, activity:current.activity, conversations:current.conversations }); }
      catch (e) { if (e instanceof z.ZodError) throw new HttpError(400, '백업 파일 형식이 올바르지 않아요. 이 앱에서 내보낸 JSON 파일인지 확인해 주세요.'); throw e; }
      addActivity(next, '백업 파일로 노트를 복원했어요', user.name);
      return json(200, { state:await saveState(ws, next, version) });
    }
    if (path === '/api/items' && method === 'POST') {
      const { collection, item } = z.object({ collection:collectionSchema, item:z.record(z.string(), z.unknown()) }).parse(parseBody(event));
      const parsed = itemSchemas[collection].parse(item) as unknown as Record<string, unknown>;
      const state = await mutateState(ws, draft => {
        const rows = draft[collection] as unknown as Record<string, unknown>[];
        const index = rows.findIndex(row => row.id === parsed.id); const previous = rows[index];
        if (index >= 0) rows[index] = parsed; else rows.push(parsed);
        const verb = !previous ? '추가' : collection === 'tasks' && previous.status !== parsed.status && parsed.status === 'done' ? '완료' : '수정';
        addActivity(draft, `${collectionLabels[collection]} ${verb} · ${itemLabel(parsed)}`, user.name);
      });
      return json(200, { state });
    }
    if (path === '/api/items/delete' && method === 'POST') {
      const { collection, id } = z.object({ collection:collectionSchema, id:z.string().min(1).max(100) }).parse(parseBody(event));
      const state = await mutateState(ws, draft => {
        const rows = draft[collection] as unknown as Record<string, unknown>[];
        const index = rows.findIndex(row => row.id === id);
        if (index < 0) return null;
        const [removed] = rows.splice(index, 1);
        addActivity(draft, `${collectionLabels[collection]} 삭제 · ${itemLabel(removed)}`, user.name);
      });
      return json(200, { state });
    }
    if (path === '/api/settings' && method === 'PUT') {
      const { settings } = z.object({ settings:settingsSchema }).parse(parseBody(event));
      const state = await mutateState(ws, draft => { draft.settings = settings; addActivity(draft, '웨딩 기본 정보 수정', user.name); });
      return json(200, { state });
    }

    if (path === '/api/chat' && method === 'POST') {
      const { message, requestId } = z.object({ message:z.string().trim().min(1).max(4000), requestId:z.string().uuid() }).parse(parseBody(event));
      const state = await getState(ws); const duplicate = state.conversations.find(m => m.id === requestId);
      if (duplicate) return json(200, { state, message:duplicate });
      await limit(`chat-minute:${ws}`, 6, 60, 'AI 상담 요청이 많아요. 1분 뒤 다시 시도해 주세요.');
      await limit(`chat-day:${ws}`, ws === MAIN_WORKSPACE ? 100 : 30, 86400, '오늘의 AI 상담 횟수를 모두 사용했어요. 내일 다시 이용해 주세요.');
      await limit('chat-day-all', 300, 86400, '오늘은 AI 상담 요청이 많아 잠시 쉬어요. 내일 다시 이용해 주세요.');
      const askedAt = new Date().toISOString(); const materials = await getMaterials(ws);
      let reply:ChatMessage;
      try { reply = await runAgent(state, materials, message, user.name); }
      catch (e) {
        if (e instanceof HttpError) throw e;
        const status = (e as { status?:number }).status;
        throw new HttpError(status === 429 ? 429 : 502, status === 429 ? 'OpenAI 사용 한도에 도달했어요. API 결제와 사용 한도를 확인해 주세요.' : 'AI 상담에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      reply.id = requestId;
      const saved = await mutateState(ws, draft => {
        if (draft.conversations.some(m => m.id === requestId)) return null;
        draft.conversations.push({ id:`${requestId}-user`, role:'user', content:message, at:askedAt, by:user.name }, reply);
        draft.conversations = draft.conversations.slice(-24);
        while (JSON.stringify(draft.conversations).length > 65000 && draft.conversations.length > 2) draft.conversations.splice(0, 2);
      });
      return json(200, { state:saved, message:reply });
    }
    if (path === '/api/chat/apply' && method === 'POST') {
      const { messageId } = z.object({ messageId:z.string().min(1).max(100), version:z.number().int().positive().optional() }).parse(parseBody(event));
      const state = await mutateState(ws, draft => {
        const message = draft.conversations.find(m => m.id === messageId && m.role === 'assistant');
        if (!message) throw new HttpError(404, '변경안을 찾을 수 없어요.');
        if (message.applied) return null;
        if (!message.proposals?.length) throw new HttpError(400, '반영할 변경안이 없어요.');
        const next = applyProposals(draft, message.proposals, user.name);
        next.conversations.find(m => m.id === messageId)!.applied = true;
        return next;
      });
      return json(200, { state });
    }
    if (path === '/api/chat/remove' && method === 'POST') {
      const { messageId } = z.object({ messageId:z.string().min(1).max(100), version:z.number().int().positive().optional() }).parse(parseBody(event));
      const state = await mutateState(ws, draft => {
        const kept = draft.conversations.filter(m => m.id !== messageId && m.id !== `${messageId}-user`);
        if (kept.length === draft.conversations.length) return null;
        draft.conversations = kept;
      });
      return json(200, { state });
    }

    if (path === '/api/materials' && method === 'GET') return json(200, { materials:(await getMaterials(ws)).map(materialSummary) });
    if (path === '/api/materials/upload' && method === 'POST') {
      const body = z.object({ filename:z.string().min(1).max(200), data:z.string().min(1), title:z.string().trim().min(1).max(200), category:z.string().trim().max(100).optional() }).parse(parseBody(event));
      const extension = extname(body.filename).toLowerCase(); const mimeType = mimeByExtension[extension];
      if (!mimeType) throw new HttpError(400, '이미지·PDF·엑셀·CSV·텍스트 파일을 올려 주세요.');
      const data = Buffer.from(body.data, 'base64');
      if (!data.length || data.length > 3 * 1024 * 1024) throw new HttpError(413, '파일은 3MB 이하로 올려 주세요.');
      if (!matchesSignature(extension, data)) throw new HttpError(400, '파일 내용이 확장자와 맞지 않아요. 원본 파일을 다시 선택해 주세요.');
      if ((await uploadedMaterials(ws)).length >= 200) throw new HttpError(400, '자료는 노트당 200개까지 올릴 수 있어요. 필요 없는 자료를 정리해 주세요.');
      await limit(`uploads:${ws}`, 50, 86400, '오늘 올릴 수 있는 자료 수(50개)를 모두 사용했어요.');
      const id = randomUUID(); const filename = `uploads/${ws}/${id}${extension}`;
      await saveUpload(filename, data, mimeType);
      const material:Material = { id, title:body.title, category:body.category || '업로드 자료', kind:mimeType.startsWith('image/') ? 'image' : 'file', filename, originalFilename:body.filename, mimeType, sourceType:'upload', summary:`${user.name}님이 올린 자료`, ...(extension === '.txt' || extension === '.csv' ? { content:data.toString('utf8').slice(0, 20000) } : {}) };
      await addMaterial(ws, material);
      return json(200, { material:materialSummary(material) });
    }
    if (path.startsWith('/api/materials/') && method === 'DELETE') {
      const id = decodeURIComponent(path.slice('/api/materials/'.length));
      const material = (await uploadedMaterials(ws)).find(m => m.id === id);
      if (!material) throw new HttpError(404, '직접 올린 자료만 삭제할 수 있어요.');
      if (material.filename) await deleteUpload(material.filename);
      await removeMaterial(ws, id);
      return json(200, { ok:true });
    }
    if (path.startsWith('/api/materials/') && method === 'GET') {
      const id = decodeURIComponent(path.slice('/api/materials/'.length));
      const material = (await getMaterials(ws)).find(m => m.id === id);
      if (!material) throw new HttpError(404, '자료를 찾을 수 없어요.');
      if (query.get('format') === 'json') return json(200, { material:{ ...material, content:material.content?.slice(0, 60000) } });
      if (!material.filename) {
        if (material.sourceUrl && /^https?:\/\//.test(material.sourceUrl)) return redirect(material.sourceUrl);
        return json(200, material);
      }
      const thumbnail = query.get('thumb') === '1' && material.thumbnail ? material.thumbnail : null;
      const key = thumbnail || material.filename; const mime = thumbnail ? 'image/webp' : mimeOf(material);
      if (remoteFiles) return redirect(await signedUrl(key, mime, 300, thumbnail ? undefined : material.originalFilename || material.title), 'private, max-age=240');
      return { statusCode:200, headers:{ ...baseHeaders, 'content-type':mime, 'cache-control':'private, max-age=300' }, body:(await readLocalFile(key, material.sourceType === 'upload')).toString('base64'), isBase64Encoded:true };
    }

    if (path === '/api/invite' && method === 'POST') {
      const { side } = z.object({ side:z.enum(['groom', 'bride']).optional() }).parse(parseBody(event));
      return json(200, { workspace:await createInvite(user, side || oppositeSide(user.side)) });
    }
    if (path === '/api/invite' && method === 'DELETE') return json(200, { workspace:await revokeInvite(user) });
    if (path === '/api/members/remove' && method === 'POST') {
      const { username } = z.object({ username:z.string().min(1).max(40) }).parse(parseBody(event));
      const workspace = await getWorkspace(ws);
      if (!workspace || workspace.owner !== user.username) throw new HttpError(403, '노트를 만든 분만 함께하는 사람을 내보낼 수 있어요.');
      if (username === user.username) throw new HttpError(400, '본인은 내보낼 수 없어요.');
      await detachMember(ws, username);
      return json(200, { workspace:await workspaceInfo(ws) });
    }
    if (path === '/api/account/profile' && method === 'POST') {
      const input = z.object({ name:nameSchema, side:sideSchema }).parse(parseBody(event));
      return json(200, { user:publicUser(await updateUser(user.username, u => ({ ...u, name:input.name, side:input.side }))) });
    }
    if (path === '/api/account/password' && method === 'POST') {
      const input = z.object({ current:z.string().min(1, '현재 비밀번호를 입력해 주세요.').max(200), next:passwordSchema }).parse(parseBody(event));
      await limit(`password:${sha256(user.username)}`, 10, 3600, tooMany);
      if (!(await verifyPassword(input.current, user.passwordHash))) throw new HttpError(400, '현재 비밀번호가 맞지 않아요.');
      const passwordHash = await hashPassword(input.next);
      const updated = await updateUser(user.username, u => ({ ...u, passwordHash, sessionVersion:u.sessionVersion + 1 }));
      return json(200, { ok:true }, [sessionCookie(updated)]);
    }

    if (path.startsWith('/api/admin/')) {
      if (user.role !== 'admin') throw new HttpError(403, '관리자만 볼 수 있어요.');
      if (path === '/api/admin/users' && method === 'GET') return json(200, { users:await listUsers() });
      if (path === '/api/admin/users/action' && method === 'POST') {
        const { username, action } = z.object({ username:z.string().min(1).max(40), action:z.enum(['approve', 'suspend', 'activate', 'reset', 'delete']) }).parse(parseBody(event));
        const result = await adminAction(user, username, action);
        return json(200, { ...result, users:await listUsers() });
      }
    }
    throw new HttpError(404, '요청한 기능을 찾을 수 없어요.');
  } catch (e) {
    if (e instanceof z.ZodError) { const message = e.issues[0]?.message || ''; return json(400, { error:/[가-힣]/.test(message) ? message : '입력 내용을 확인해 주세요.' }); }
    if (e instanceof HttpError) return json(e.status, { error:e.message, ...(e.code ? { code:e.code } : {}) });
    if (e instanceof ValidationError) return json(400, { error:e.message });
    console.error('request_failure', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
    return json(500, { error:'처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
  }
}
