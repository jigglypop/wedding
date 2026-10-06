import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import type { PlanState } from '../src/types';

// End-to-end check of a running API: npm run verify [-- --live] [-- --ai]
const live = process.argv.includes('--live'); const ai = process.argv.includes('--ai');
const base:string = live ? JSON.parse(await readFile('.deployment/outputs.json', 'utf8')).WebsiteUrl : 'http://127.0.0.1:8787';
const devAccess = live ? {} : JSON.parse(await readFile('.local/dev-access.json', 'utf8').catch(() => '{}'));
const admin = { username:process.env.WEDDING_ADMIN_USERNAME || devAccess.adminUsername, password:process.env.WEDDING_ADMIN_PASSWORD || devAccess.adminPassword };
assert.ok(admin.username && admin.password, 'Set WEDDING_ADMIN_USERNAME and WEDDING_ADMIN_PASSWORD in .env');
let checks = 0;

class Client {
  cookie = '';
  async raw(path:string, method = 'GET', body?:unknown, expected = 200, redirect:RequestRedirect = 'follow') {
    const result = await fetch(`${base}${path}`, { method, redirect, headers:{ ...(this.cookie ? { cookie:this.cookie } : {}), ...(body === undefined ? {} : { 'content-type':'application/json' }) }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
    if (result.status !== expected) assert.fail(`${method} ${path}: expected ${expected}, got ${result.status} ${await result.text()}`);
    const setCookie = result.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    checks++;
    return result;
  }
  async json<T = any>(path:string, method = 'GET', body?:unknown, expected = 200):Promise<T> { return (await this.raw(path, method, body, expected)).json() as Promise<T>; }
}

const anonymous = new Client(); const owner = new Client(); const groom = new Client(); const bride = new Client();
const suffix = randomBytes(3).toString('hex'); const groomName = `qa_g${suffix}`; const brideName = `qa_b${suffix}`; const password = `Qa${randomBytes(6).toString('hex')}9`;
const marker = `검증 ${randomUUID()}`; let aiMessageId = '';
await anonymous.json('/api/health');
await anonymous.raw('/api/bootstrap', 'GET', undefined, 401);
await anonymous.raw('/api/login', 'POST', { username:admin.username, password:'wrong-password-1' }, 401);
await owner.json('/api/login', 'POST', admin);
const boot = await owner.json('/api/bootstrap');
assert.equal(boot.user.role, 'admin'); assert.equal(boot.privateLibrary, true);
assert.ok(boot.materials.length >= 20); assert.ok(boot.state.tasks.length >= 40);
try {
  const image = boot.materials.find((m:{ kind:string; thumbnail?:string }) => m.kind === 'image' && m.thumbnail);
  if (image) {
    const response = await owner.raw(`/api/materials/${image.id}?thumb=1`, 'GET', undefined, live ? 302 : 200, live ? 'manual' : 'follow');
    if (live) { const file = await fetch(response.headers.get('location')!); assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'image/webp'); checks++; }
    else assert.equal(response.headers.get('content-type'), 'image/webp');
  }
  let state:PlanState = (await owner.json('/api/items', 'POST', { collection:'notes', item:{ id:randomUUID(), title:marker, content:'저장 및 충돌 검증', category:'검증' } })).state;
  assert.ok(state.notes.some(n => n.title === marker));
  await owner.raw('/api/state', 'PUT', { state:boot.state, version:boot.state.version }, 409);

  await anonymous.raw('/api/signup', 'POST', { username:groomName, password, name:'검증 신랑', side:'groom' }, 201);
  assert.equal((await anonymous.json('/api/login', 'POST', { username:groomName, password }, 403)).code, 'pending');
  await owner.json('/api/admin/users/action', 'POST', { username:groomName, action:'approve' });
  await groom.json('/api/login', 'POST', { username:groomName, password });
  const groomBoot = await groom.json('/api/bootstrap');
  assert.equal(groomBoot.privateLibrary, false); assert.equal(groomBoot.materials.length, 0); assert.ok(groomBoot.state.tasks.length >= 25);
  await groom.raw('/api/admin/users', 'GET', undefined, 403);

  const code:string = (await groom.json('/api/invite', 'POST', {})).workspace.invite.code;
  assert.equal((await anonymous.json(`/api/invites/${code}`)).invite.inviterName, '검증 신랑');
  if (live) { const page = await (await anonymous.raw(`/invite/${code}`)).text(); assert.match(page, /검증 신랑님이 우리의 웨딩 노트에 초대했어요/); assert.match(page, /og-image\.png/); }
  const accepted = await bride.json(`/api/invites/${code}/accept`, 'POST', { mode:'signup', username:brideName, password, name:'검증 신부' });
  assert.equal(accepted.user.workspaceId, groomBoot.user.workspaceId); assert.equal(accepted.user.side, 'bride');
  await anonymous.raw(`/api/invites/${code}`, 'GET', undefined, 410);
  await bride.json('/api/items', 'POST', { collection:'tasks', item:{ id:randomUUID(), title:marker, category:'검증', dueDate:'', status:'todo', notes:'' } });
  const shared = await groom.json(`/api/state?since=${groomBoot.state.version}`);
  assert.ok(shared.state.tasks.some((t:{ title:string }) => t.title === marker)); assert.equal(shared.state.activity[0].by, '검증 신부');
  assert.equal((await groom.json('/api/workspace')).workspace.members.length, 2);

  if (ai) {
    const requestId = randomUUID();
    const reply = await owner.json('/api/chat', 'POST', { message:`자료를 참고해 본식 전날 체크할 가장 중요한 것 3가지를 설명하고, 할 일 하나만 '${marker}' 이름으로 추가 제안해 주세요. 날짜는 미정으로 유지해 주세요.`, requestId });
    aiMessageId = reply.message.id; state = reply.state;
    assert.ok(reply.message.content.length > 10);
    assert.ok(reply.message.proposals?.some((p:{ type:string; collection:string }) => p.type === 'upsert' && p.collection === 'tasks'));
    assert.equal(state.tasks.some(t => t.title === marker), false);
    assert.equal((await owner.json('/api/chat', 'POST', { message:'중복 요청은 실행되지 않아야 함', requestId })).state.version, state.version);
    state = (await owner.json('/api/chat/apply', 'POST', { messageId:aiMessageId })).state;
    assert.ok(state.tasks.some(t => t.title === marker));
  }
} finally {
  const latest:PlanState = (await owner.json('/api/bootstrap')).state;
  for (const note of latest.notes.filter(n => n.title === marker)) await owner.json('/api/items/delete', 'POST', { collection:'notes', id:note.id });
  for (const task of latest.tasks.filter(t => t.title === marker)) await owner.json('/api/items/delete', 'POST', { collection:'tasks', id:task.id });
  if (aiMessageId) await owner.json('/api/chat/remove', 'POST', { messageId:aiMessageId });
  const users = (await owner.json('/api/admin/users')).users as { username:string }[];
  for (const username of [brideName, groomName]) if (users.some(u => u.username === username)) await owner.json('/api/admin/users/action', 'POST', { username, action:'delete' });
}
await owner.json('/api/logout', 'POST', {});
await owner.raw('/api/bootstrap', 'GET', undefined, 401);
console.log(JSON.stringify({ ok:true, base, checks, ai, sourceCount:boot.materials.length, taskCount:boot.state.tasks.length, storage:live ? 'dynamodb' : 'local' }));
