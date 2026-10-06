import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, verifyPassword, sessionCookie, readSession } from '../server/auth';

process.env.SESSION_SECRET = 'test-secret-only-for-tests-0123456789';
process.env.ADMIN_USERNAME = 'boss01';
process.env.ADMIN_PASSWORD = 'adminpass1';
delete process.env.DYNAMODB_TABLE; delete process.env.MATERIALS_BUCKET; delete process.env.OPENAI_API_KEY;

test('passwords are salted and sessions reject tampering', async () => {
  const hash = await hashPassword('correct horse 1');
  assert.notEqual(hash, await hashPassword('correct horse 1'));
  assert.equal(await verifyPassword('correct horse 1', hash), true);
  assert.equal(await verifyPassword('wrong horse 1', hash), false);
  assert.equal(await verifyPassword('anything', undefined), false);
  const cookie = sessionCookie({ username:'alice', sessionVersion:2 }).split(';')[0];
  assert.deepEqual({ ...readSession(cookie), e:0 }, { u:'alice', v:2, e:0 });
  assert.equal(readSession(cookie.replace('wedding_session=', 'wedding_session=x')), null);
  assert.equal(readSession(sessionCookie(null)), null);
});

test('sign-up approval, admin, invite and shared notes work end to end', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wedding-test-'));
  process.env.LOCAL_DATA_DIR = dir;
  const { handler } = await import('../server/index');
  const call = async (method:string, path:string, body?:unknown, cookie = '') => {
    const [rawPath, rawQueryString = ''] = path.split('?');
    const result = await handler({ rawPath, rawQueryString, headers:{ cookie, 'content-type':'application/json' }, body:body === undefined ? undefined : JSON.stringify(body), requestContext:{ http:{ method, sourceIp:'127.0.0.1' } } });
    const isJson = result.headers['content-type']?.startsWith('application/json');
    return { status:result.statusCode, data:isJson && result.body ? JSON.parse(result.body) : result.body, cookie:result.cookies?.[0]?.split(';')[0] || '' };
  };
  try {
    assert.equal((await call('GET', '/api/bootstrap')).status, 401);
    assert.equal((await call('POST', '/api/signup', { username:'Groom_01', password:'short', name:'신랑', side:'groom' })).status, 400);
    assert.equal((await call('POST', '/api/signup', { username:'boss01', password:'password12', name:'가짜', side:'groom' })).status, 409);
    assert.equal((await call('POST', '/api/signup', { username:'Groom_01', password:'password12', name:'신랑', side:'groom' })).status, 201);
    assert.equal((await call('POST', '/api/signup', { username:'groom_01', password:'password12', name:'중복', side:'groom' })).status, 409);
    const pending = await call('POST', '/api/login', { username:'groom_01', password:'password12' });
    assert.equal(pending.status, 403); assert.equal(pending.data.code, 'pending');

    assert.equal((await call('POST', '/api/login', { username:'boss01', password:'wrong-pass1' })).status, 401);
    const admin = await call('POST', '/api/login', { username:'BOSS01', password:'adminpass1' });
    assert.equal(admin.status, 200); assert.equal(admin.data.user.role, 'admin');
    const adminBoot = await call('GET', '/api/bootstrap', undefined, admin.cookie);
    assert.equal(adminBoot.data.privateLibrary, true); assert.ok(adminBoot.data.materials.length >= 20); assert.ok(adminBoot.data.state.tasks.length >= 40);
    const users = await call('GET', '/api/admin/users', undefined, admin.cookie);
    assert.equal(users.data.users.find((u:{ username:string }) => u.username === 'groom_01').status, 'pending');
    assert.equal((await call('POST', '/api/admin/users/action', { username:'groom_01', action:'approve' }, admin.cookie)).status, 200);

    const groom = await call('POST', '/api/login', { username:'groom_01', password:'password12' });
    assert.equal(groom.status, 200);
    assert.equal((await call('GET', '/api/admin/users', undefined, groom.cookie)).status, 403);
    const groomBoot = await call('GET', '/api/bootstrap', undefined, groom.cookie);
    assert.equal(groomBoot.data.privateLibrary, false); assert.equal(groomBoot.data.materials.length, 0);
    assert.equal((await call('GET', `/api/materials/${adminBoot.data.materials[0].id}`, undefined, groom.cookie)).status, 404);
    assert.ok(groomBoot.data.state.tasks.length >= 25);

    const invited = await call('POST', '/api/invite', {}, groom.cookie);
    assert.equal(invited.data.workspace.invite.side, 'bride');
    const code = invited.data.workspace.invite.code as string;
    const preview = await call('GET', `/api/invites/${code}`);
    assert.equal(preview.data.invite.inviterName, '신랑');
    const page = await call('GET', `/invite/${code}`);
    assert.equal(page.status, 200); assert.match(String(page.data), /신랑님이 우리의 웨딩 노트에 초대했어요/);
    const bride = await call('POST', `/api/invites/${code}/accept`, { mode:'signup', username:'bride_01', password:'password34', name:'신부' });
    assert.equal(bride.status, 200); assert.equal(bride.data.user.side, 'bride');
    assert.equal((await call('GET', `/api/invites/${code}`)).status, 410);
    assert.equal((await call('POST', `/api/invites/${code}/accept`, { mode:'signup', username:'bride_02', password:'password34', name:'다른 사람' })).status, 410);

    const task = { id:'shared-1', title:'함께 고른 웨딩홀 방문', category:'예식장', dueDate:'', status:'todo', notes:'' };
    const added = await call('POST', '/api/items', { collection:'tasks', item:task }, bride.cookie);
    assert.equal(added.status, 200);
    const groomView = await call('GET', `/api/state?since=${groomBoot.data.state.version}`, undefined, groom.cookie);
    assert.ok(groomView.data.state.tasks.some((t:{ id:string }) => t.id === 'shared-1'));
    assert.equal(groomView.data.state.activity[0].by, '신부');
    const members = (await call('GET', '/api/workspace', undefined, groom.cookie)).data.workspace.members;
    assert.deepEqual(members.map((m:{ username:string }) => m.username).sort(), ['bride_01', 'groom_01']);
    assert.equal((await call('PUT', '/api/state', { state:groomBoot.data.state, version:groomBoot.data.state.version }, groom.cookie)).status, 409);
    assert.equal((await call('POST', '/api/items/delete', { collection:'tasks', id:'shared-1' }, groom.cookie)).status, 200);
    assert.equal((await call('POST', '/api/items/delete', { collection:'tasks', id:'shared-1' }, groom.cookie)).status, 200);

    assert.equal((await call('POST', '/api/account/password', { current:'password12', next:'newpass123' }, groom.cookie)).status, 200);
    assert.equal((await call('GET', '/api/bootstrap', undefined, groom.cookie)).status, 401);
    assert.equal((await call('POST', '/api/admin/users/action', { username:'bride_01', action:'suspend' }, admin.cookie)).status, 200);
    assert.equal((await call('GET', '/api/bootstrap', undefined, bride.cookie)).status, 401);
    for (const username of ['bride_01', 'groom_01']) assert.equal((await call('POST', '/api/admin/users/action', { username, action:'delete' }, admin.cookie)).status, 200);
    assert.equal((await call('GET', '/api/admin/users', undefined, admin.cookie)).data.users.length, 1);
    assert.equal((await call('POST', '/api/admin/users/action', { username:'boss01', action:'delete' }, admin.cookie)).status, 400);
  } finally { await rm(dir, { recursive:true, force:true }); }
});
