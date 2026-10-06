import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, verifyPassword, sessionCookie, readSession } from '../server/auth';

process.env.SESSION_SECRET = 'test-secret-only-for-tests-0123456789';
process.env.ADMIN_USERNAME = 'boss01';
process.env.ADMIN_PASSWORD = 'adminpass1';
delete process.env.DYNAMODB_TABLE; delete process.env.MATERIALS_BUCKET; delete process.env.OPENAI_API_KEY;

type Handler = typeof import('../server/index').handler;
let handler:Handler; let dir = '';
before(async () => { dir = await mkdtemp(join(tmpdir(), 'wedding-test-')); process.env.LOCAL_DATA_DIR = dir; handler = (await import('../server/index')).handler; });
after(async () => { await rm(dir, { recursive:true, force:true }); });

// Each scenario uses its own client IP so per-IP limits do not leak between tests.
function client(ip:string) {
  let cookie = '';
  const call = async (method:string, path:string, body?:unknown, jar = true) => {
    const [rawPath, rawQueryString = ''] = path.split('?');
    const result = await handler({ rawPath, rawQueryString, headers:{ cookie:jar ? cookie : '', 'content-type':'application/json' }, body:body === undefined ? undefined : JSON.stringify(body), requestContext:{ http:{ method, sourceIp:ip } } });
    const set = result.cookies?.[0]?.split(';')[0];
    if (jar && set !== undefined) cookie = set;
    const isJson = result.headers['content-type']?.startsWith('application/json');
    return { status:result.statusCode, data:isJson && result.body ? JSON.parse(result.body) : result.body, cookie:set || '' };
  };
  return { call, get cookie() { return cookie; }, set cookie(value:string) { cookie = value; } };
}
async function approvedMember(admin:ReturnType<typeof client>, ip:string, username:string, side:'groom'|'bride' = 'groom') {
  const person = client(ip);
  assert.equal((await person.call('POST', '/api/signup', { username, password:'password12', name:username, side })).status, 201);
  assert.equal((await admin.call('POST', '/api/admin/users/action', { username, action:'approve' })).status, 200);
  assert.equal((await person.call('POST', '/api/login', { username, password:'password12' })).status, 200);
  return person;
}

test('passwords are salted and sessions reject tampering', async () => {
  const hash = await hashPassword('correct horse 1');
  assert.notEqual(hash, await hashPassword('correct horse 1'));
  assert.equal(await verifyPassword('correct horse 1', hash), true);
  assert.equal(await verifyPassword('wrong horse 1', hash), false);
  assert.equal(await verifyPassword('anything', undefined), false);
  const cookie = sessionCookie({ username:'alice', accountId:'acc1', sessionVersion:2 }).split(';')[0];
  assert.deepEqual({ ...readSession(cookie), e:0 }, { u:'alice', a:'acc1', v:2, e:0 });
  assert.equal(readSession(cookie.replace('wedding_session=', 'wedding_session=x')), null);
  assert.equal(readSession(sessionCookie(null)), null);
});

test('sign-up approval, admin, invite and shared notes work end to end', async () => {
  const anon = client('10.0.0.1'); const admin = client('10.0.0.1'); const groom = client('10.0.0.1'); const bride = client('10.0.0.1');
  assert.equal((await anon.call('GET', '/api/bootstrap')).status, 401);
  assert.equal((await anon.call('POST', '/api/signup', { username:'Groom_01', password:'short', name:'신랑', side:'groom' })).status, 400);
  const adminName = await anon.call('POST', '/api/signup', { username:'boss01', password:'password12', name:'가짜', side:'groom' });
  const takenName = await anon.call('POST', '/api/signup', { username:'Groom_01', password:'password12', name:'신랑', side:'groom' });
  assert.equal(takenName.status, 201);
  const duplicate = await anon.call('POST', '/api/signup', { username:'groom_01', password:'password12', name:'중복', side:'groom' });
  assert.equal(adminName.status, 409); assert.equal(duplicate.status, 409); assert.equal(adminName.data.error, duplicate.data.error);
  const pending = await anon.call('POST', '/api/login', { username:'groom_01', password:'password12' });
  assert.equal(pending.status, 403); assert.equal(pending.data.code, 'pending');
  assert.equal((await anon.call('POST', '/api/login', { username:'boss01', password:'password12' }, false)).status, 401);
  assert.equal((await admin.call('POST', '/api/login', { username:'BOSS01', password:'adminpass1' })).data.user.role, 'admin');
  const adminBoot = (await admin.call('GET', '/api/bootstrap')).data;
  assert.equal(adminBoot.privateLibrary, true); assert.ok(adminBoot.materials.length >= 20); assert.ok(adminBoot.state.tasks.length >= 40); assert.equal(adminBoot.pendingUsers, 1);
  assert.equal((await admin.call('POST', '/api/admin/users/action', { username:'groom_01', action:'approve' })).status, 200);

  assert.equal((await groom.call('POST', '/api/login', { username:'groom_01', password:'password12' })).status, 200);
  assert.equal((await groom.call('GET', '/api/admin/users')).status, 403);
  const groomBoot = (await groom.call('GET', '/api/bootstrap')).data;
  assert.equal(groomBoot.privateLibrary, false); assert.equal(groomBoot.materials.length, 0); assert.ok(groomBoot.state.tasks.length >= 25);
  assert.equal((await groom.call('GET', `/api/materials/${adminBoot.materials[0].id}`)).status, 404);
  assert.equal((await groom.call('GET', '/api/materials/%E0')).status, 404);

  const code = (await groom.call('POST', '/api/invite', {})).data.workspace.invite.code as string;
  const preview = await anon.call('GET', `/api/invites/${code}`);
  assert.equal(preview.data.invite.inviterName, '신랑'); assert.equal(preview.data.invite.mine, false);
  assert.equal((await groom.call('GET', `/api/invites/${code}`)).data.invite.mine, true);
  const page = await anon.call('GET', `/invite/${code}`);
  assert.equal(page.status, 200); assert.match(String(page.data), /신랑님이 우리의 웨딩 노트에 초대했어요/);
  assert.equal((await anon.call('GET', '/invite/%E0')).status, 404);
  const accepted = await bride.call('POST', `/api/invites/${code}/accept`, { mode:'signup', username:'bride_01', password:'password34', name:'신부' });
  assert.equal(accepted.status, 200); assert.equal(accepted.data.user.side, 'bride');
  assert.equal((await anon.call('GET', `/api/invites/${code}`)).status, 410);

  const task = { id:'shared-1', title:'함께 고른 웨딩홀 방문', category:'예식장', dueDate:'', status:'todo', notes:'' };
  assert.equal((await bride.call('POST', '/api/items', { collection:'tasks', item:task, expected:null })).status, 200);
  const groomView = (await groom.call('GET', `/api/state?since=${groomBoot.state.version}`)).data;
  assert.ok(groomView.state.tasks.some((t:{ id:string }) => t.id === 'shared-1')); assert.equal(groomView.state.activity[0].by, '신부'); assert.equal(groomView.memberCount, 2);
  assert.equal((await bride.call('POST', '/api/items', { collection:'tasks', item:{ ...task, notes:'신부 메모' }, expected:task })).status, 200);
  const stale = await groom.call('POST', '/api/items', { collection:'tasks', item:{ ...task, status:'done' }, expected:task });
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'conflict');
  assert.equal((await groom.call('POST', '/api/items/delete', { collection:'tasks', id:'shared-1', expected:task })).status, 409);
  const settings = (await groom.call('PUT', '/api/settings', { settings:{ venue:'신랑이 고른 홀' }, expected:{ venue:'' } })).data.state.settings;
  assert.equal(settings.venue, '신랑이 고른 홀');
  assert.equal((await bride.call('PUT', '/api/settings', { settings:{ venue:'신부가 고른 홀' }, expected:{ venue:'' } })).status, 409);
  assert.equal((await bride.call('PUT', '/api/settings', { settings:{ totalBudget:30000000 }, expected:{ totalBudget:0 } })).data.state.settings.venue, '신랑이 고른 홀');
  assert.equal((await groom.call('PUT', '/api/state', { state:groomBoot.state, version:groomBoot.state.version })).status, 409);

  const beforeChange = groom.cookie;
  assert.equal((await groom.call('POST', '/api/account/password', { current:'password12', next:'newpass123' })).status, 200);
  const afterChange = groom.cookie;
  assert.equal((await groom.call('GET', '/api/bootstrap')).status, 200);
  groom.cookie = beforeChange;
  assert.equal((await groom.call('GET', '/api/bootstrap')).status, 401);
  groom.cookie = afterChange.replace(/\.[^.]+$/, '.tampered');
  assert.equal((await groom.call('GET', '/api/bootstrap')).status, 401);
  assert.equal((await admin.call('POST', '/api/admin/users/action', { username:'bride_01', action:'suspend' })).status, 200);
  assert.equal((await bride.call('GET', '/api/bootstrap')).status, 401);
  for (const username of ['bride_01', 'groom_01']) assert.equal((await admin.call('POST', '/api/admin/users/action', { username, action:'delete' })).status, 200);
  assert.equal((await admin.call('GET', '/api/admin/users')).data.users.length, 1);
  assert.equal((await admin.call('POST', '/api/admin/users/action', { username:'boss01', action:'delete' })).status, 400);
});

test('a deleted account cookie does not work for a new owner of the same username', async () => {
  const admin = client('10.0.1.1'); const host = client('10.0.1.2'); const victim = client('10.0.1.3'); const newcomer = client('10.0.1.4');
  await admin.call('POST', '/api/login', { username:'boss01', password:'adminpass1' });
  const owner = await approvedMember(admin, '10.0.1.2', 'host_01');
  host.cookie = owner.cookie;
  const first = (await host.call('POST', '/api/invite', {})).data.workspace.invite.code;
  assert.equal((await victim.call('POST', `/api/invites/${first}/accept`, { mode:'signup', username:'reused_01', password:'password12', name:'처음 사람' })).status, 200);
  const staleCookie = victim.cookie;
  assert.equal((await admin.call('POST', '/api/admin/users/action', { username:'reused_01', action:'delete' })).status, 200);
  const second = (await host.call('POST', '/api/invite', {})).data.workspace.invite.code;
  assert.equal((await newcomer.call('POST', `/api/invites/${second}/accept`, { mode:'signup', username:'reused_01', password:'password34', name:'새 사람' })).status, 200);
  victim.cookie = staleCookie;
  assert.equal((await victim.call('GET', '/api/bootstrap')).status, 401);
  assert.equal((await newcomer.call('GET', '/api/bootstrap')).status, 200);
});

test('accepting each other\'s invites at the same moment never deletes a note', async () => {
  const admin = client('10.0.2.1');
  await admin.call('POST', '/api/login', { username:'boss01', password:'adminpass1' });
  const a = await approvedMember(admin, '10.0.2.2', 'cross_a'); const b = await approvedMember(admin, '10.0.2.3', 'cross_b', 'bride');
  await a.call('POST', '/api/items', { collection:'notes', item:{ id:'note-a', title:'A의 메모', content:'보존', category:'' } });
  await b.call('POST', '/api/items', { collection:'notes', item:{ id:'note-b', title:'B의 메모', content:'보존', category:'' } });
  const codeA = (await a.call('POST', '/api/invite', {})).data.workspace.invite.code; const codeB = (await b.call('POST', '/api/invite', {})).data.workspace.invite.code;
  const [ra, rb] = await Promise.all([a.call('POST', `/api/invites/${codeB}/accept`, { mode:'session' }), b.call('POST', `/api/invites/${codeA}/accept`, { mode:'session' })]);
  assert.ok([ra.status, rb.status].filter(s => s === 200).length <= 1);
  for (const person of [a, b]) {
    const login = await person.call('POST', '/api/login', { username:person === a ? 'cross_a' : 'cross_b', password:'password12' });
    assert.equal(login.status, 200);
    const boot = (await person.call('GET', '/api/bootstrap')).data;
    assert.ok(boot.state.notes.some((n:{ id:string }) => n.id === 'note-a' || n.id === 'note-b'), 'each person still has a note with data');
  }
});

test('leaving a shared note keeps it with the partner; invite-only accounts then need approval', async () => {
  const admin = client('10.0.3.1'); const joiner = client('10.0.3.3');
  await admin.call('POST', '/api/login', { username:'boss01', password:'adminpass1' });
  const host = await approvedMember(admin, '10.0.3.2', 'leave_host');
  const code = (await host.call('POST', '/api/invite', {})).data.workspace.invite.code;
  await joiner.call('POST', `/api/invites/${code}/accept`, { mode:'signup', username:'leave_join', password:'password12', name:'함께' });
  await joiner.call('POST', '/api/items', { collection:'notes', item:{ id:'kept', title:'남는 메모', content:'', category:'' } });
  const left = await joiner.call('POST', '/api/members/leave', {});
  assert.equal(left.status, 200); assert.equal(left.data.status, 'pending');
  assert.equal((await joiner.call('POST', '/api/login', { username:'leave_join', password:'password12' })).data.code, 'pending');
  const hostBoot = (await host.call('GET', '/api/bootstrap')).data;
  assert.equal(hostBoot.workspace.members.length, 1); assert.ok(hostBoot.state.notes.some((n:{ id:string }) => n.id === 'kept'));
  assert.equal((await host.call('POST', '/api/members/leave', {})).status, 400);
});

test('only failed logins count toward the per-account lock', async () => {
  const admin = client('10.0.4.1'); const owner = client('10.0.4.9');
  await admin.call('POST', '/api/login', { username:'boss01', password:'adminpass1' });
  await approvedMember(admin, '10.0.4.2', 'lock_test');
  for (let i = 0; i < 5; i++) assert.equal((await owner.call('POST', '/api/login', { username:'lock_test', password:'password12' })).status, 200);
  for (let i = 0; i < 9; i++) assert.equal((await client(`10.0.5.${i}`).call('POST', '/api/login', { username:'lock_test', password:'wrong-pass1' })).status, 401);
  assert.equal((await owner.call('POST', '/api/login', { username:'lock_test', password:'password12' })).status, 200);
  assert.equal((await client('10.0.6.1').call('POST', '/api/login', { username:'lock_test', password:'wrong-pass1' })).status, 401);
  assert.equal((await owner.call('POST', '/api/login', { username:'lock_test', password:'password12' })).status, 429);
});
