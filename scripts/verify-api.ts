import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import type { Bootstrap, PlanState, Venue, VenueChecklist } from '../src/types';
import { scopeVenueChecklist } from '../src/lib/venue-checklist';

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
const ownerVenueIds = new Set<string>(); const sharedVenueIds = new Set<string>(); let sharedSignedIn = false;
const sourceVenueTemplate = JSON.parse(await readFile('data/venue-checklist.json', 'utf8')) as VenueChecklist & { venues:string[] };
async function verifyVenuePair(writer:Client, reader:Client, template:VenueChecklist, tracked:Set<string>) {
  const field = template.fields.find(f => f.kind === 'comparison' && f.scope === 'hall'); const onsite = template.fields.find(f => f.kind === 'onsite' && f.scope === 'hall'); const common = template.fields.find(f => f.scope === 'venue');
  assert.ok(field && onsite && common, 'Hall-specific and common checklist fields must be available');
  const make = (label:string, value:string, checked:boolean, rating:'만족'|'보통'|'아쉬움'):Venue => {
    const id = randomUUID(); tracked.add(id);
    return { id, name:`${marker} ${label}`, status:'researching', visitDate:'', contact:'', url:'', notes:'자동 검증 후 삭제', answers:{ [common.id]:{ value:'웨딩홀 공통 기록', checked:true, rating:'' } }, halls:[{ id:randomUUID(), name:'그랜드홀', answers:{ [field.id]:{ value, checked, rating:'' }, [onsite.id]:{ value:`${label} 방문 메모`, checked:!checked, rating } } }] };
  };
  const first = make('웨딩홀 A', '250만원', true, '만족'); const second = make('웨딩홀 B', '350만원', false, '아쉬움');
  first.halls.push({ id:randomUUID(), name:'루미에르홀', answers:{ [field.id]:{ value:'400만원', checked:false, rating:'' }, [onsite.id]:{ value:'별도의 홀 방문 메모', checked:true, rating:'아쉬움' } } });
  await writer.json('/api/items', 'POST', { collection:'venues', item:first, expected:null });
  await reader.json('/api/items', 'POST', { collection:'venues', item:second, expected:null });
  const initial:PlanState = (await reader.json('/api/bootstrap')).state;
  assert.deepEqual(initial.venues.find(v => v.id === first.id), first);
  assert.deepEqual(initial.venues.find(v => v.id === second.id), second);
  const edited:Venue = { ...first, visitDate:'2027-01-15', halls:[{ ...first.halls[0], answers:{ [field.id]:{ value:'240만원', checked:false, rating:'' }, [onsite.id]:{ value:'홀 A 수정 메모', checked:true, rating:'보통' } } }, first.halls[1]] };
  await reader.json('/api/items', 'POST', { collection:'venues', item:edited, expected:first });
  const stale = await writer.json('/api/items', 'POST', { collection:'venues', item:{ ...first, notes:'이전 화면' }, expected:first }, 409);
  assert.equal(stale.code, 'conflict');
  await writer.raw('/api/items/delete', 'POST', { collection:'venues', id:first.id, expected:first }, 409);
  // Reload using a separate request to the persistent API, rather than the write response.
  const reloaded:PlanState = (await writer.json('/api/bootstrap')).state;
  assert.deepEqual(reloaded.venues.find(v => v.id === first.id), edited);
  assert.deepEqual(reloaded.venues.find(v => v.id === second.id), second);
  assert.deepEqual(edited.halls[1], first.halls[1]); assert.deepEqual(edited.answers, first.answers);
  const sharedEdit:Venue = { ...edited, answers:{ ...edited.answers, [common.id]:{ value:'파트너가 수정한 공통 기록', checked:false, rating:'보통' } }, halls:[edited.halls[0], { ...edited.halls[1], name:'루미에르홀 2층', answers:{ ...edited.halls[1].answers, [field.id]:{ value:'390만원', checked:true, rating:'' } } }] };
  await reader.json('/api/items', 'POST', { collection:'venues', item:sharedEdit, expected:edited });
  await writer.raw('/api/items', 'POST', { collection:'venues', item:edited, expected:edited }, 409);
  const { halls:_halls, ...flat } = first;
  const flatLegacy = { ...flat, answers:{ ...first.answers, ...first.halls[0].answers } };
  await writer.raw('/api/items', 'POST', { collection:'venues', item:flatLegacy, expected:flatLegacy }, 409);
  await writer.raw('/api/items', 'POST', { collection:'venues', item:flatLegacy, expected:sharedEdit }, 409);
  await writer.raw('/api/items', 'POST', { collection:'venues', item:{ ...sharedEdit, halls:[sharedEdit.halls[0], sharedEdit.halls[0]] }, expected:sharedEdit }, 400);
  const afterShared:PlanState = (await writer.json('/api/bootstrap')).state;
  assert.deepEqual(afterShared.venues.find(v => v.id === first.id), sharedEdit);
  const oneHall:Venue = { ...sharedEdit, halls:[sharedEdit.halls[0]] };
  await reader.json('/api/items', 'POST', { collection:'venues', item:oneHall, expected:sharedEdit });
  const removed:PlanState = (await reader.json('/api/items/delete', 'POST', { collection:'venues', id:second.id, expected:second })).state;
  assert.equal(removed.venues.some(v => v.id === second.id), false);
  assert.deepEqual(removed.venues.find(v => v.id === first.id), oneHall);
}
async function cleanupVenues(client:Client, ids:Set<string>) {
  if (!ids.size) return;
  const state:PlanState = (await client.json('/api/bootstrap')).state;
  for (const venue of state.venues.filter(v => ids.has(v.id))) await client.json('/api/items/delete', 'POST', { collection:'venues', id:venue.id, expected:venue });
}
await anonymous.json('/api/health');
await anonymous.raw('/api/bootstrap', 'GET', undefined, 401);
await anonymous.raw('/api/login', 'POST', { username:admin.username, password:'wrong-password-1' }, 401);
await owner.json('/api/login', 'POST', admin);
const boot = await owner.json<Bootstrap>('/api/bootstrap');
assert.equal(boot.user.role, 'admin'); assert.equal(boot.privateLibrary, true);
assert.ok(boot.materials.length >= 20); assert.ok(boot.state.tasks.length >= 40);
assert.equal(boot.venueChecklist.fields.length, 69);
assert.deepEqual(boot.venueChecklist.fields, scopeVenueChecklist(sourceVenueTemplate).fields);
assert.equal(boot.venueChecklist.sourceName, sourceVenueTemplate.sourceName);
assert.equal(sourceVenueTemplate.venues.length, 10);
try {
  await verifyVenuePair(owner, owner, boot.venueChecklist, ownerVenueIds);
  const image = boot.materials.find(m => m.kind === 'image' && m.thumbnail);
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
  sharedSignedIn = true;
  const groomBoot = await groom.json('/api/bootstrap');
  assert.equal(groomBoot.privateLibrary, false); assert.equal(groomBoot.materials.length, 0); assert.ok(groomBoot.state.tasks.length >= 25);
  assert.deepEqual(groomBoot.state.venues, []);
  assert.equal(groomBoot.venueChecklist.sourceName, undefined);
  assert.ok(!JSON.stringify(groomBoot).includes(sourceVenueTemplate.sourceName!));
  assert.ok(groomBoot.venueChecklist.fields.length > 0 && groomBoot.venueChecklist.fields.length < 69);
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
  await verifyVenuePair(groom, bride, groomBoot.venueChecklist, sharedVenueIds);

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
  await cleanupVenues(owner, ownerVenueIds);
  if (sharedSignedIn) await cleanupVenues(groom, sharedVenueIds);
  const latest:PlanState = (await owner.json('/api/bootstrap')).state;
  for (const note of latest.notes.filter(n => n.title === marker)) await owner.json('/api/items/delete', 'POST', { collection:'notes', id:note.id });
  for (const task of latest.tasks.filter(t => t.title === marker)) await owner.json('/api/items/delete', 'POST', { collection:'tasks', id:task.id });
  if (aiMessageId) await owner.json('/api/chat/remove', 'POST', { messageId:aiMessageId });
  const users = (await owner.json('/api/admin/users')).users as { username:string }[];
  for (const username of [brideName, groomName]) if (users.some(u => u.username === username)) await owner.json('/api/admin/users/action', 'POST', { username, action:'delete' });
  const afterCleanup:PlanState = (await owner.json('/api/bootstrap')).state;
  assert.deepEqual(afterCleanup.venues, boot.state.venues, 'Verification must preserve every pre-existing venue');
  assert.deepEqual(afterCleanup.tasks, boot.state.tasks, 'Verification must preserve existing checklist records');
}
await owner.json('/api/logout', 'POST', {});
await owner.raw('/api/bootstrap', 'GET', undefined, 401);
console.log(JSON.stringify({ ok:true, base, checks, ai, sourceCount:boot.materials.length, taskCount:boot.state.tasks.length, venueCount:boot.state.venues.length, venueFieldCount:boot.venueChecklist.fields.length, storage:live ? 'dynamodb' : 'local' }));
