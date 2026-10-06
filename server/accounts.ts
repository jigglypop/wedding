import { z } from 'zod';
import { randomInt } from 'node:crypto';
import type { AdminUser, Member, Side, SessionUser, WorkspaceInfo } from '../src/types';
import { ConflictError, HttpError, deleteItem, getItem, mutateItem, putItem, queryItems, type Item } from './db';
import { hashPassword, keyedHash, randomToken, readSession, sha256, type Session } from './auth';
import { MAIN_WORKSPACE, deleteState, uploadedMaterials, removeMaterial } from './store';
import { deleteUpload } from './files';

export type Role = 'admin'|'member';
export type Status = 'pending'|'active'|'suspended';
// accountId is random per account so a cookie never outlives a deleted account whose username is reused.
// adminApproved marks accounts the administrator approved; invite-only accounts lose access when they leave the note.
export type UserRecord = Item & { username:string; name:string; side:Side; role:Role; status:Status; passwordHash:string; sessionVersion:number; accountId:string; workspaceId:string; createdAt:string; approvedAt?:string; adminApproved?:boolean; lastLoginAt?:string; invitedBy?:string; seed?:string; rev?:number };
type InviteInfo = { code:string; side:Side; expiresAt:number; createdAt:string; invitedBy:string };
export type WorkspaceRecord = Item & { id:string; owner:string; members:string[]; createdAt:string; invite?:InviteInfo|null; closing?:boolean; archivedAt?:string; archivedBy?:string; rev?:number };
type InviteRecord = Item & { workspaceId:string; invitedBy:string; inviterName:string; side:Side; createdAt:string; expiresAt:number };

export const MAX_MEMBERS = 2;
const INVITE_DAYS = 7;
const reserved = new Set(['admin', 'administrator', 'root', 'system', 'support', 'manager', 'official', 'wedding']);
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_]{3,19}$/, '아이디는 영문 소문자·숫자·밑줄(_)로 4~20자 입력해 주세요.');
export const passwordSchema = z.string().min(8, '비밀번호는 8자 이상 입력해 주세요.').max(128, '비밀번호는 128자 이내로 입력해 주세요.').refine(v => /[A-Za-z]/.test(v) && /[0-9]/.test(v), '비밀번호에 영문과 숫자를 함께 넣어 주세요.');
export const nameSchema = z.string().trim().min(1, '이름을 입력해 주세요.').max(20, '이름은 20자 이내로 입력해 주세요.');
export const sideSchema = z.enum(['groom', 'bride', 'other']);
export const adminUsername = () => (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const taken = () => new HttpError(409, '이미 사용 중인 아이디예요. 다른 아이디를 입력해 주세요.');
const busy = () => new HttpError(409, '노트를 정리하는 중이에요. 잠시 후 다시 시도해 주세요.');

const userKey = (username:string) => ['USERS', username] as const;
const workspaceKey = (id:string) => [`WS#${id}`, 'META'] as const;
const inviteKey = (code:string) => [`INVITE#${sha256(code)}`, 'INVITE'] as const;
export const getUser = (username:string) => getItem<UserRecord>(...userKey(username));
export const getWorkspace = (id:string) => getItem<WorkspaceRecord>(...workspaceKey(id));
export const publicUser = (user:UserRecord):SessionUser => ({ username:user.username, name:user.name, side:user.side, role:user.role, workspaceId:user.workspaceId });
export const oppositeSide = (side:Side):Side => side === 'bride' ? 'groom' : 'bride';
const isMember = (workspace:WorkspaceRecord|null, username:string) => !!workspace && !workspace.archivedAt && workspace.members.includes(username);

export async function updateUser(username:string, change:(user:UserRecord) => UserRecord|void) {
  const result = await mutateItem<UserRecord>(...userKey(username), current => { if (!current) throw new HttpError(404, '회원을 찾을 수 없어요.'); return change(current) || current; });
  return result!;
}

export async function createWorkspace(owner:string, id = `ws_${randomToken(9)}`) {
  await putItem({ pk:`WS#${id}`, sk:'META', id, owner, members:[owner], createdAt:new Date().toISOString(), rev:1 }, { absent:true });
  return id;
}

// Moves a member out of a note into a fresh personal note and signs them out everywhere.
// Accounts that only ever joined through an invite need administrator approval for a note of their own.
async function moveToFreshNote(username:string) {
  const fresh = await createWorkspace(username);
  return updateUser(username, u => ({ ...u, workspaceId:fresh, sessionVersion:u.sessionVersion + 1, status:u.adminApproved ? 'active' : 'pending' }));
}

// Seeds or repairs the administrator from deployment settings. A changed ADMIN_PASSWORD resets the stored password once,
// and a renamed administrator replaces the previous one in the main note.
export async function ensureAdmin() {
  const username = adminUsername(); const password = process.env.ADMIN_PASSWORD || '';
  if (!username || !password) return;
  const seed = keyedHash(`admin-seed:${username}:${password}`);
  const existing = await getUser(username);
  const main = await getWorkspace(MAIN_WORKSPACE);
  if (existing && existing.seed === seed && existing.role === 'admin' && existing.status === 'active' && existing.workspaceId === MAIN_WORKSPACE && existing.accountId && main?.owner === username && main.members.includes(username)) return;
  const passwordHash = existing?.seed === seed ? existing.passwordHash : await hashPassword(password);
  const now = new Date().toISOString();
  await mutateItem<UserRecord>(...userKey(username), current => {
    const keep = current?.seed === seed;
    return {
      ...(current || { username, name:username, side:'groom' as Side, createdAt:now, sessionVersion:0 }), pk:'USERS', sk:username,
      role:'admin', status:'active', adminApproved:true, workspaceId:MAIN_WORKSPACE, approvedAt:current?.approvedAt || now, accountId:current?.accountId || randomToken(12),
      passwordHash:keep ? current!.passwordHash : passwordHash, seed, sessionVersion:current && !keep ? current.sessionVersion + 1 : current?.sessionVersion ?? 0
    } as UserRecord;
  });
  let previousOwner:string|undefined;
  await mutateItem<WorkspaceRecord>(...workspaceKey(MAIN_WORKSPACE), current => {
    if (!current) return { pk:`WS#${MAIN_WORKSPACE}`, sk:'META', id:MAIN_WORKSPACE, owner:username, members:[username], createdAt:now } as WorkspaceRecord;
    if (current.owner === username && current.members.includes(username)) return null;
    previousOwner = current.owner !== username ? current.owner : undefined;
    const partners = current.members.filter(m => m !== username && m !== current.owner);
    return { ...current, owner:username, members:[username, ...partners].slice(0, MAX_MEMBERS), archivedAt:undefined, closing:false };
  });
  for (const other of (await queryItems<UserRecord>('USERS')).filter(u => u.role === 'admin' && u.username !== username)) {
    await updateUser(other.username, u => ({ ...u, role:'member', sessionVersion:u.sessionVersion + 1 }));
    if (other.username === previousOwner || other.workspaceId === MAIN_WORKSPACE) await moveToFreshNote(other.username);
  }
}

// A session is valid only for an active account that still belongs to its note.
export async function sessionUser(cookies:string):Promise<{ user:UserRecord; session:Session; workspace:WorkspaceRecord }|null> {
  const session = readSession(cookies);
  if (!session) return null;
  const user = await getUser(session.u);
  if (!user || user.status !== 'active' || user.sessionVersion !== session.v || !user.accountId || user.accountId !== session.a) return null;
  const workspace = await getWorkspace(user.workspaceId);
  if (!isMember(workspace, user.username)) return null;
  return { user, session, workspace:workspace! };
}

// Repairs accounts left outside any note by an interrupted change; invite-only accounts then wait for approval.
export async function ensureMembership(user:UserRecord):Promise<UserRecord> {
  if (user.role === 'admin' || isMember(await getWorkspace(user.workspaceId), user.username)) return user;
  return moveToFreshNote(user.username);
}

export async function signUp(input:{ username:string; password:string; name:string; side:Side }, options:{ workspaceId?:string; invitedBy?:string } = {}) {
  if (reserved.has(input.username) || input.username === adminUsername()) throw taken();
  const workspaceId = options.workspaceId || `ws_${randomToken(9)}`;
  const now = new Date().toISOString();
  const user:UserRecord = { pk:'USERS', sk:input.username, username:input.username, name:input.name, side:input.side, role:'member', status:options.workspaceId ? 'active' : 'pending', passwordHash:await hashPassword(input.password), sessionVersion:0, accountId:randomToken(12), workspaceId, createdAt:now, ...(options.workspaceId ? { approvedAt:now } : {}), ...(options.invitedBy ? { invitedBy:options.invitedBy } : {}), rev:1 };
  try { await putItem(user, { absent:true }); }
  catch (e) { if (e instanceof ConflictError) throw taken(); throw e; }
  if (!options.workspaceId) await createWorkspace(input.username, workspaceId);
  return user;
}

export async function workspaceInfo(id:string):Promise<WorkspaceInfo> {
  const workspace = await getWorkspace(id);
  const users = await Promise.all((workspace?.members || []).map(getUser));
  const members:Member[] = users.filter((u):u is UserRecord => !!u).map(u => ({ username:u.username, name:u.name, side:u.side, owner:u.username === workspace?.owner }));
  const invite = workspace?.invite && workspace.invite.expiresAt * 1000 > Date.now() ? { code:workspace.invite.code, side:workspace.invite.side, expiresAt:new Date(workspace.invite.expiresAt * 1000).toISOString() } : null;
  return { id, members, maxMembers:MAX_MEMBERS, invite };
}

export async function createInvite(user:UserRecord, side:Side) {
  const code = randomToken(18); const expiresAt = Math.floor(Date.now() / 1000) + INVITE_DAYS * 86400; let previous:string|undefined;
  await mutateItem<WorkspaceRecord>(...workspaceKey(user.workspaceId), current => {
    if (!isMember(current, user.username)) throw new HttpError(404, '노트 정보를 찾을 수 없어요.');
    if (current!.closing) throw busy();
    if (current!.members.length >= MAX_MEMBERS) throw new HttpError(409, '이미 두 사람이 함께 쓰고 있는 노트예요.');
    previous = current!.invite?.code;
    return { ...current!, invite:{ code, side, expiresAt, createdAt:new Date().toISOString(), invitedBy:user.username } };
  });
  await putItem({ pk:inviteKey(code)[0], sk:'INVITE', workspaceId:user.workspaceId, invitedBy:user.username, inviterName:user.name, side, createdAt:new Date().toISOString(), expiresAt });
  if (previous) await deleteItem(...inviteKey(previous));
  return workspaceInfo(user.workspaceId);
}

export async function revokeInvite(workspaceId:string, onlyBy?:string) {
  let previous:string|undefined;
  await mutateItem<WorkspaceRecord>(...workspaceKey(workspaceId), current => { if (!current?.invite || (onlyBy && current.invite.invitedBy !== onlyBy)) return null; previous = current.invite.code; return { ...current, invite:null }; });
  if (previous) await deleteItem(...inviteKey(previous));
  return workspaceInfo(workspaceId);
}

const expired = () => new HttpError(410, '초대 링크가 만료되었거나 이미 사용되었어요. 초대한 분께 새 링크를 요청해 주세요.', 'invite-expired');
export async function resolveInvite(code:string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(code)) throw expired();
  const invite = await getItem<InviteRecord>(...inviteKey(code));
  if (!invite || invite.expiresAt * 1000 <= Date.now()) throw expired();
  const workspace = await getWorkspace(invite.workspaceId);
  if (!workspace || workspace.archivedAt || workspace.invite?.code !== code || workspace.members.length >= MAX_MEMBERS) throw expired();
  return { invite, workspace };
}

// Claims the single-use invite and adds the member in one conditional write. A note that is being closed cannot take members.
async function claimInvite(code:string, workspaceId:string, username:string) {
  await mutateItem<WorkspaceRecord>(...workspaceKey(workspaceId), current => {
    if (!current || current.archivedAt || current.invite?.code !== code || current.invite.expiresAt * 1000 <= Date.now() || current.members.length >= MAX_MEMBERS) throw expired();
    if (current.closing) throw busy();
    return { ...current, members:[...current.members, username], invite:null };
  });
  await deleteItem(...inviteKey(code));
}

export async function acceptInviteWithSignup(code:string, input:{ username:string; password:string; name:string }) {
  const { invite } = await resolveInvite(code);
  const user = await signUp({ ...input, side:invite.side }, { workspaceId:invite.workspaceId, invitedBy:invite.invitedBy });
  try { await claimInvite(code, invite.workspaceId, user.username); }
  catch (e) { await deleteItem(...userKey(user.username)); throw e; }
  return user;
}

// Joining with an existing account first closes the account's own solo note atomically, so two people accepting
// each other's invites at the same moment cannot both lose their notes. The old note is archived, not deleted.
export async function acceptInviteAsUser(code:string, user:UserRecord) {
  const { invite } = await resolveInvite(code);
  if (user.role === 'admin') throw new HttpError(409, '관리자 계정은 다른 노트에 참여할 수 없어요.');
  if (user.workspaceId === invite.workspaceId) throw new HttpError(409, '이미 이 노트를 함께 쓰고 있어요.', 'already-member');
  const ownId = user.workspaceId; let closed = false; let ownInvite:string|undefined;
  await mutateItem<WorkspaceRecord>(...workspaceKey(ownId), current => {
    if (!current || current.archivedAt) return null;
    if (current.members.some(m => m !== user.username)) throw new HttpError(409, '이미 다른 분과 함께 쓰는 노트가 있어요. 설정 → 함께하는 사람에서 노트를 나온 뒤 다시 수락해 주세요.');
    if (current.closing) throw busy();
    closed = true; ownInvite = current.invite?.code;
    return { ...current, closing:true, invite:null };
  });
  if (ownInvite) await deleteItem(...inviteKey(ownInvite));
  try { await claimInvite(code, invite.workspaceId, user.username); }
  catch (e) { if (closed) await mutateItem<WorkspaceRecord>(...workspaceKey(ownId), current => current ? { ...current, closing:false } : null); throw e; }
  const updated = await updateUser(user.username, u => ({ ...u, workspaceId:invite.workspaceId, status:'active', approvedAt:u.approvedAt || new Date().toISOString(), invitedBy:u.invitedBy || invite.invitedBy, accountId:u.accountId || randomToken(12) }));
  if (closed) await mutateItem<WorkspaceRecord>(...workspaceKey(ownId), current => current ? { ...current, members:[], closing:false, archivedAt:new Date().toISOString(), archivedBy:user.username } : null);
  return updated;
}

async function dropWorkspace(id:string) {
  if (id === MAIN_WORKSPACE) return;
  const workspace = await getWorkspace(id);
  if (workspace?.invite) await deleteItem(...inviteKey(workspace.invite.code));
  for (const material of await uploadedMaterials(id)) { if (material.filename) await deleteUpload(material.filename); await removeMaterial(id, material.id); }
  await deleteItem(...workspaceKey(id));
  await deleteState(id);
}

// Removes a member from a shared note (owner removing the partner, or a member leaving). The note stays with the other person.
export async function detachMember(workspaceId:string, username:string) {
  if (workspaceId === MAIN_WORKSPACE && username === adminUsername()) throw new HttpError(400, '관리자는 기본 노트를 떠날 수 없어요.');
  await mutateItem<WorkspaceRecord>(...workspaceKey(workspaceId), current => {
    if (!current || !current.members.includes(username)) throw new HttpError(404, '함께하는 사람을 찾을 수 없어요.');
    const members = current.members.filter(m => m !== username);
    if (!members.length) throw new HttpError(400, '혼자 쓰는 노트에서는 나갈 수 없어요.');
    return { ...current, members, owner:current.owner === username ? members[0] : current.owner };
  });
  return moveToFreshNote(username);
}

export async function listUsers():Promise<AdminUser[]> {
  const users = await queryItems<UserRecord>('USERS');
  return users.map(u => ({ username:u.username, name:u.name, side:u.side, role:u.role, status:u.status, workspaceId:u.workspaceId, createdAt:u.createdAt, approvedAt:u.approvedAt, lastLoginAt:u.lastLoginAt, invitedBy:u.invitedBy, partners:users.filter(o => o.workspaceId === u.workspaceId && o.username !== u.username).map(o => o.name) }))
    .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt));
}
export async function pendingCount() { return (await queryItems<UserRecord>('USERS')).filter(u => u.status === 'pending').length; }

export async function adminAction(actor:UserRecord, username:string, action:'approve'|'suspend'|'activate'|'reset'|'delete') {
  const target = await getUser(username);
  if (!target) throw new HttpError(404, '회원을 찾을 수 없어요.');
  if (target.role === 'admin' || target.username === actor.username) throw new HttpError(400, '관리자 계정은 이 화면에서 변경할 수 없어요.');
  const now = new Date().toISOString();
  if (action === 'approve' || action === 'activate') { await updateUser(username, u => ({ ...u, status:'active', adminApproved:true, approvedAt:u.approvedAt || now })); return {}; }
  if (action === 'suspend') { await updateUser(username, u => ({ ...u, status:'suspended', sessionVersion:u.sessionVersion + 1 })); await revokeInvite(target.workspaceId, username); return {}; }
  if (action === 'reset') {
    const temporaryPassword = `${randomToken(6).replace(/[-_]/g, 'x')}${randomInt(10, 100)}`;
    const passwordHash = await hashPassword(temporaryPassword);
    await updateUser(username, u => ({ ...u, passwordHash, sessionVersion:u.sessionVersion + 1 }));
    return { temporaryPassword };
  }
  await revokeInvite(target.workspaceId, username);
  const workspace = await getWorkspace(target.workspaceId);
  const remaining = (workspace?.members || []).filter(m => m !== username);
  if (workspace && remaining.length) await mutateItem<WorkspaceRecord>(...workspaceKey(workspace.id), current => current ? { ...current, members:current.members.filter(m => m !== username), owner:current.owner === username ? remaining[0] : current.owner } : null);
  else if (workspace) await dropWorkspace(workspace.id);
  await deleteItem(...userKey(username));
  return {};
}
