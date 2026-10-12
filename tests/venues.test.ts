import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlanState, Proposal, Venue, VenueAnswer } from '../src/types';
import { applyProposals, itemSchemas, validateState } from '../server/model';
import { genericVenueChecklist, starterState } from '../server/starter';
import { normalizeVenue, scopeVenueChecklist } from '../src/lib/venue-checklist';

process.env.SESSION_SECRET = 'venue-test-secret-only-0123456789';
process.env.ADMIN_USERNAME = 'venue_admin';
process.env.ADMIN_PASSWORD = 'adminpass1';
delete process.env.DYNAMODB_TABLE; delete process.env.MATERIALS_BUCKET; delete process.env.OPENAI_API_KEY;

const privateTemplate = { title:'개인 투어 체크리스트', sourceName:'개인자료.xlsx', fields:[
  { id:'comparison-1', category:'비용', label:'개인 비교 항목', kind:'comparison' },
  { id:'onsite-1', category:'방문', label:'개인 방문 항목', question:'개인 질문', kind:'onsite' }
], venues:Array.from({ length:10 }, (_, index) => `원본 후보 ${index + 1}`) };
const venue = (id:string, name:string):Venue => normalizeVenue({ id, name, status:'researching', visitDate:'', contact:'', url:'', notes:'', answers:{} });
const answer = (value:string, checked = false, rating:VenueAnswer['rating'] = ''):VenueAnswer => ({ value, checked, rating });
const legacy = (version = 17) => {
  const { venues:_venues, ...old } = starterState();
  return { ...old, version, tasks:[{ ...old.tasks[0], status:'done' as const, notes:'기존 체크리스트 기록 보존' }], budgets:[{ ...old.budgets[0], actual:12000 }], activity:[{ id:'a1', at:old.updatedAt, text:'기존 기록' }], conversations:[{ id:'m1', role:'user' as const, content:'기존 상담', at:old.updatedAt }] };
};
let dir = '';
let handler:typeof import('../server/index').handler;
let db:typeof import('../server/db');
let store:typeof import('../server/store');
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wedding-venues-'));
  process.env.LOCAL_DATA_DIR = join(dir, 'local'); process.env.DATA_DIR = join(dir, 'data');
  await mkdir(process.env.DATA_DIR, { recursive:true });
  await writeFile(join(process.env.DATA_DIR, 'venue-checklist.json'), JSON.stringify(privateTemplate));
  await writeFile(join(process.env.DATA_DIR, 'initial-state.json'), JSON.stringify(legacy(1)));
  await writeFile(join(process.env.DATA_DIR, 'materials.json'), '[]');
  db = await import('../server/db'); store = await import('../server/store'); handler = (await import('../server/index')).handler;
});
after(async () => { await rm(dir, { recursive:true, force:true }); });

function client(ip:string) {
  let cookie = '';
  return { call:async (method:string, path:string, body?:unknown) => {
    const [rawPath, rawQueryString = ''] = path.split('?');
    const result = await handler({ rawPath, rawQueryString, headers:{ cookie, 'content-type':'application/json' }, body:body === undefined ? undefined : JSON.stringify(body), requestContext:{ http:{ method, sourceIp:ip } } });
    if (result.cookies?.[0]) cookie = result.cookies[0].split(';')[0];
    return { status:result.statusCode, data:JSON.parse(result.body) };
  } };
}

test('legacy migration seeds only absent venues, increments atomically and preserves existing records', async () => {
  const old = legacy();
  await db.putItem({ pk:'WS#main', sk:'STATE', version:old.version, payload:JSON.stringify(old) });
  const [first, concurrent] = await Promise.all([store.getState('main'), store.getState('main')]);
  assert.equal(first.version, 18); assert.equal(concurrent.version, 18);
  assert.deepEqual(first.venues.map(v => v.name), privateTemplate.venues);
  assert.ok(first.venues.every(v => Object.keys(v.answers).length === 0));
  assert.ok(first.venues.every(v => v.halls.length === 1 && v.halls[0].name === '홀 1'));
  for (const key of ['tasks', 'budgets', 'vendors', 'guests', 'timeline', 'notes', 'activity', 'conversations'] as const) assert.deepEqual(first[key], old[key]);
  const persisted = await db.getItem<import('../server/db').Item & { version:number; payload:string }>('WS#main', 'STATE');
  assert.equal(persisted?.version, 18); assert.deepEqual(JSON.parse(persisted!.payload), first);
  await assert.rejects(store.saveState('main', first, old.version), error => error instanceof db.HttpError && error.status === 409);

  const empty = { ...first, version:23, venues:[] };
  await db.putItem({ pk:'WS#main', sk:'STATE', version:23, payload:JSON.stringify(empty) });
  const preserved = await store.getState('main');
  assert.equal(preserved.version, 23); assert.deepEqual(preserved.venues, []);
  db.resetLocalStore();
  assert.deepEqual((await store.getState('main')).venues, []);
});

test('other workspaces migrate to empty venues and receive an independently authored template', async () => {
  const old = legacy(9);
  await db.putItem({ pk:'WS#another', sk:'STATE', version:old.version, payload:JSON.stringify(old) });
  const next = await store.getState('another');
  assert.equal(next.version, 10); assert.deepEqual(next.venues, []); assert.deepEqual(next.tasks, old.tasks);
  const template = await store.getVenueChecklist('another');
  assert.deepEqual(template, genericVenueChecklist); assert.equal(template.sourceName, undefined);
  assert.ok(!JSON.stringify(template).includes('개인'));
  assert.deepEqual(await store.getVenueChecklist('main'), scopeVenueChecklist({ title:privateTemplate.title, sourceName:privateTemplate.sourceName, fields:privateTemplate.fields as import('../src/types').VenueChecklistField[] }));
});

test('flat hall migration preserves every answer, is persisted once, and survives concurrent edits', async () => {
  const { halls:_halls, ...flat } = venue('legacy-tour', '기존 투어');
  const flatVenue = { ...flat, answers:{ rental:answer('대관료 원본', true, '만족'), location:answer('공통 교통 기록'), 'custom-private':answer('알 수 없는 기록', true, '보통') } };
  const original = { ...starterState(), version:40, venues:[flatVenue], notes:[{ id:'existing-note', title:'기존 메모', content:'보존', category:'메모' }] };
  await db.putItem({ pk:'WS#flat-migration', sk:'STATE', version:40, payload:JSON.stringify(original) });
  const [first, concurrent] = await Promise.all([store.getState('flat-migration'), store.getState('flat-migration')]);
  assert.equal(first.version, 41); assert.deepEqual(concurrent, first);
  assert.deepEqual(first.venues[0].halls, [{ id:'legacy-tour-hall-1', name:'홀 1', answers:{ rental:flatVenue.answers.rental } }]);
  assert.deepEqual(first.venues[0].answers, { location:flatVenue.answers.location, 'custom-private':flatVenue.answers['custom-private'] });
  assert.deepEqual(first.notes, original.notes);
  assert.equal((await store.getState('flat-migration')).version, 41);
  const persisted = await db.getItem<import('../server/db').Item & { payload:string; version:number }>('WS#flat-migration', 'STATE');
  assert.deepEqual(JSON.parse(persisted!.payload), first);

  await db.putItem({ pk:'WS#flat-race', sk:'STATE', version:40, payload:JSON.stringify(original) });
  await Promise.all([store.getState('flat-race'), store.mutateState('flat-race', draft => { draft.notes[0].content = '동시에 저장한 파트너 메모'; })]);
  const raced = await store.getState('flat-race');
  assert.equal(raced.version, 42); assert.equal(raced.notes[0].content, '동시에 저장한 파트너 메모');
  assert.deepEqual(raced.venues, first.venues);
  await assert.rejects(store.saveState('flat-race', first, 40), error => error instanceof db.HttpError && error.status === 409);
});

test('venue validation rejects excess entries, invalid ratings, dates and unsafe answer keys', () => {
  const original = starterState();
  const valid = { ...venue('v1', '웨딩홀 하나'), answers:{ cost:answer('300만원', true, '만족') } };
  assert.deepEqual(validateState({ ...original, venues:[valid] }).venues, [valid]);
  assert.throws(() => itemSchemas.venues.parse({ ...valid, visitDate:'2027-02-31' }));
  assert.throws(() => itemSchemas.venues.parse({ ...valid, answers:{ cost:{ value:'', checked:false, rating:'매우 만족' } } }));
  assert.throws(() => itemSchemas.venues.parse({ ...valid, answers:{ 'bad.key':{ value:'', checked:false, rating:'' } } }));
  assert.throws(() => itemSchemas.venues.parse({ ...valid, answers:Object.fromEntries(Array.from({ length:121 }, (_, i) => [`field-${i}`, { value:'', checked:false, rating:'' }])) }));
  assert.throws(() => validateState({ ...original, venues:Array.from({ length:101 }, (_, i) => venue(`v${i}`, `홀 ${i}`)) }));
  assert.throws(() => validateState({ ...original, venues:[valid, valid] }));
  assert.throws(() => itemSchemas.venues.parse({ ...valid, halls:[valid.halls[0], valid.halls[0]] }));
  assert.throws(() => itemSchemas.venues.parse({ ...valid, halls:[] }));
  assert.throws(() => itemSchemas.venues.parse({ ...valid, halls:Array.from({ length:21 }, (_, i) => ({ ...valid.halls[0], id:`hall-${i}` })) }));
  assert.throws(() => itemSchemas.venues.parse({ ...valid, halls:[{ ...valid.halls[0], name:'   ' }] }));
  assert.throws(() => itemSchemas.venues.parse({ ...valid, halls:[{ ...valid.halls[0], answers:{ 'bad.key':answer('') } }] }));
  const { halls:_halls, ...flat } = venue('x'.repeat(100), '긴 ID');
  const migrated = itemSchemas.venues.parse({ ...flat, answers:{ rental:answer('250만원'), location:answer('교통') } });
  assert.ok(migrated.halls[0].id.length <= 100); assert.equal(migrated.halls[0].answers.rental.value, '250만원'); assert.equal(migrated.answers.location.value, '교통');
  const { venues:_venues, ...oldBackup } = original;
  assert.deepEqual(validateState(oldBackup).venues, []);
});

test('venue AI proposals remain staged and reject partner changes when applied', () => {
  const original:PlanState = { ...starterState(), venues:[venue('v1', '웨딩홀 하나')] };
  const proposal:Proposal = { id:'proposal-venue', type:'upsert', collection:'venues', item:{ ...original.venues[0], halls:[{ ...original.venues[0].halls[0], answers:{ rental:answer('200만원', true, '보통') } }] }, expectedItem:original.venues[0] as unknown as Record<string, unknown>, description:'대관료 기록' };
  const applied = applyProposals(original, [proposal]);
  assert.deepEqual(original.venues[0].halls[0].answers, {}); assert.equal(applied.venues[0].halls[0].answers.rental.value, '200만원');
  const newer = structuredClone(original); newer.venues[0].notes = '파트너가 기록';
  assert.throws(() => applyProposals(newer, [proposal]), /변경/);
  const hallAdded = structuredClone(original); hallAdded.venues[0].halls.push({ id:'new-hall', name:'추가 홀', answers:{} });
  assert.throws(() => applyProposals(hallAdded, [proposal]), /변경/);
  const { halls:_halls, ...legacyItem } = original.venues[0];
  assert.throws(() => applyProposals(original, [{ ...proposal, item:legacyItem }]), /홀 정보/);
});

test('authenticated API stores independent hall records through partner edits, reload, delete and backups', async () => {
  const admin = client('10.41.0.1'); const owner = client('10.41.0.2'); const partner = client('10.41.0.3');
  assert.equal((await admin.call('POST', '/api/login', { username:'venue_admin', password:'adminpass1' })).status, 200);
  const privateBoot = await admin.call('GET', '/api/bootstrap');
  assert.equal(privateBoot.data.venueChecklist.sourceName, privateTemplate.sourceName);
  assert.deepEqual(privateBoot.data.venueChecklist.fields, scopeVenueChecklist({ title:privateTemplate.title, fields:privateTemplate.fields as import('../src/types').VenueChecklistField[] }).fields);
  assert.equal((await owner.call('POST', '/api/signup', { username:'venue_owner', password:'password12', name:'신랑', side:'groom' })).status, 201);
  assert.equal((await admin.call('POST', '/api/admin/users/action', { username:'venue_owner', action:'approve' })).status, 200);
  assert.equal((await owner.call('POST', '/api/login', { username:'venue_owner', password:'password12' })).status, 200);
  const publicBoot = await owner.call('GET', '/api/bootstrap');
  assert.deepEqual(publicBoot.data.venueChecklist, genericVenueChecklist);
  assert.deepEqual(publicBoot.data.state.venues, []);
  assert.ok(!JSON.stringify(publicBoot.data).includes(privateTemplate.sourceName));
  const code = (await owner.call('POST', '/api/invite', {})).data.workspace.invite.code;
  assert.equal((await partner.call('POST', `/api/invites/${code}/accept`, { mode:'signup', username:'venue_partner', password:'password12', name:'신부' })).status, 200);

  const one:Venue = { ...venue('one', '첫 번째 웨딩홀'), answers:{ parking:answer('공통 주차장 300대', true, '만족') }, halls:[
    { id:'one-grand', name:'그랜드홀', answers:{ rental:answer('250만원', true, '만족'), hall:answer('첫 번째 홀 방문 기록', true, '만족') } },
    { id:'one-lumiere', name:'루미에르홀', answers:{ rental:answer('350만원', false, '아쉬움'), hall:answer('두 번째 홀 방문 기록', false, '보통') } }
  ] };
  const two:Venue = { ...venue('two', '두 번째 웨딩홀'), halls:[{ id:'two-hall', name:'단독홀', answers:{ rental:answer('450만원', false, '보통') } }] };
  assert.equal((await owner.call('POST', '/api/items', { collection:'venues', item:one, expected:null })).status, 200);
  assert.equal((await partner.call('POST', '/api/items', { collection:'venues', item:two, expected:null })).status, 200);
  const shared = await partner.call('GET', '/api/bootstrap');
  assert.deepEqual(shared.data.state.venues, [one, two]);
  const changed = { ...one, visitDate:'2027-01-15', halls:[{ ...one.halls[0], answers:{ ...one.halls[0].answers, rental:answer('240만원', false, '보통') } }, one.halls[1]] };
  // Key ordering inside nested answers is not a conflicting edit.
  const reordered = { ...one, answers:{ parking:{ rating:'만족', checked:true, value:'공통 주차장 300대' } } };
  const edited = await partner.call('POST', '/api/items', { collection:'venues', item:changed, expected:reordered });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.data.state.venues[0].halls[1], one.halls[1]); assert.deepEqual(edited.data.state.venues[0].answers, one.answers);
  assert.equal((await owner.call('POST', '/api/items', { collection:'venues', item:{ ...one, notes:'오래된 화면' }, expected:one })).status, 409);
  assert.equal((await owner.call('POST', '/api/items/delete', { collection:'venues', id:'one', expected:one })).status, 409);
  assert.equal((await owner.call('POST', '/api/items', { collection:'venues', item:{ ...two, answers:{ rental:{ value:'', checked:true, rating:'오류' } } }, expected:two })).status, 400);
  db.resetLocalStore();
  const reloaded = (await owner.call('GET', '/api/bootstrap')).data.state as PlanState;
  assert.deepEqual(reloaded.venues, [changed, two]); assert.deepEqual(reloaded.tasks, publicBoot.data.state.tasks);
  const deleted = await partner.call('POST', '/api/items/delete', { collection:'venues', id:'one', expected:changed });
  assert.equal(deleted.status, 200); assert.deepEqual(deleted.data.state.venues, [two]);
  const restore = await owner.call('PUT', '/api/state', { state:reloaded, version:deleted.data.state.version });
  assert.equal(restore.status, 200); assert.deepEqual(restore.data.state.venues, [changed, two]);
  const { venues:_venues, ...oldBackup } = reloaded;
  const legacyRestore = await owner.call('PUT', '/api/state', { state:oldBackup, version:restore.data.state.version });
  assert.equal(legacyRestore.status, 200); assert.deepEqual(legacyRestore.data.state.venues, [changed, two]);
  assert.deepEqual((await partner.call('GET', '/api/bootstrap')).data.state.venues, [changed, two]);
  const emptyRestore = await owner.call('PUT', '/api/state', { state:{ ...reloaded, venues:[] }, version:legacyRestore.data.state.version });
  assert.equal(emptyRestore.status, 200); assert.deepEqual(emptyRestore.data.state.venues, []);
  assert.deepEqual((await partner.call('GET', '/api/bootstrap')).data.state.venues, []);
});

test('legacy API snapshots remain editable until a modern multi-hall edit and flat backups normalize safely', async () => {
  const owner = client('10.41.0.4'); const partner = client('10.41.0.5');
  assert.equal((await owner.call('POST', '/api/login', { username:'venue_owner', password:'password12' })).status, 200);
  assert.equal((await partner.call('POST', '/api/login', { username:'venue_partner', password:'password12' })).status, 200);
  const { halls:_halls, ...flat } = venue('old-client-venue', '기존 앱 기록');
  const legacyItem = { ...flat, answers:{ rental:answer('250만원', true, '만족'), parking:answer('공통 주차장'), 'unknown-original':answer('기존 알 수 없는 항목', true, '보통') } };
  const created = await owner.call('POST', '/api/items', { collection:'venues', item:legacyItem, expected:null });
  assert.equal(created.status, 200); assert.deepEqual(created.data.state.venues, [normalizeVenue(legacyItem)]);
  const flatEdited = { ...legacyItem, answers:{ ...legacyItem.answers, rental:answer('230만원', true, '보통') } };
  const edited = await owner.call('POST', '/api/items', { collection:'venues', item:flatEdited, expected:legacyItem });
  assert.equal(edited.status, 200);
  const normalized = edited.data.state.venues[0] as Venue;
  const modern:Venue = { ...normalized, halls:[{ ...normalized.halls[0], name:'그랜드홀' }, { id:'second-modern-hall', name:'루미에르홀', answers:{ rental:answer('350만원') } }] };
  const added = await partner.call('POST', '/api/items', { collection:'venues', item:modern, expected:normalized });
  assert.equal(added.status, 200);
  assert.equal((await owner.call('POST', '/api/items', { collection:'venues', item:flatEdited, expected:flatEdited })).status, 409);
  assert.equal((await owner.call('POST', '/api/items', { collection:'venues', item:flatEdited })).status, 409);
  assert.equal((await owner.call('POST', '/api/items', { collection:'venues', item:flatEdited, expected:modern })).status, 409);
  assert.equal((await owner.call('POST', '/api/items/delete', { collection:'venues', id:modern.id, expected:flatEdited })).status, 409);
  assert.deepEqual((await partner.call('GET', '/api/bootstrap')).data.state.venues, [modern]);
  const flatBackup = { ...added.data.state, venues:[flatEdited] };
  const restored = await owner.call('PUT', '/api/state', { state:flatBackup, version:added.data.state.version });
  assert.equal(restored.status, 200); assert.deepEqual(restored.data.state.venues, [normalizeVenue(flatEdited)]);
  db.resetLocalStore();
  assert.deepEqual((await partner.call('GET', '/api/bootstrap')).data.state.venues, [normalizeVenue(flatEdited)]);
});
