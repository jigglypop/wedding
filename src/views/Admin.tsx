import { useEffect, useState } from 'react';
import { Ban, Check, Copy, KeyRound, RefreshCw, RotateCcw, ShieldCheck, Trash2, UserCheck, Users } from 'lucide-react';
import { usePlanner } from '../planner';
import { api } from '../lib/api';
import { ago, copyText, sideLabel } from '../lib/format';
import type { AdminUser } from '../types';
import { Avatar, Badge, Button, Empty, Modal, Segmented, Spinner } from '../components/ui';

type Action = 'approve'|'suspend'|'activate'|'reset'|'delete';
type Filter = 'all'|AdminUser['status'];
const statusLabel:Record<AdminUser['status'], string> = { pending:'승인 대기', active:'이용 중', suspended:'이용 중지' };
const statusTone = { pending:'gold', active:'mint', suspended:'danger' } as const;
const confirmCopy:Partial<Record<Action, [string, string, string]>> = {
  suspend:['이용 중지', '이 회원은 바로 로그아웃되고 로그인할 수 없게 돼요. 언제든 다시 풀 수 있어요.', '이용 중지하기'],
  reset:['비밀번호 초기화', '임시 비밀번호를 새로 만들어요. 회원은 바로 로그아웃되고, 임시 비밀번호로 로그인한 뒤 설정에서 비밀번호를 바꿀 수 있어요.', '초기화하기'],
  delete:['회원 삭제', '계정을 삭제해요. 혼자 쓰던 노트와 올린 자료도 함께 삭제되고 되돌릴 수 없어요. 함께 쓰던 노트라면 남은 분의 노트는 그대로예요.', '삭제하기']
};

export function Admin() {
  const { run, blocked, notify, data, setData } = usePlanner();
  const [users, setUsers] = useState<AdminUser[]|null>(null); const [filter, setFilter] = useState<Filter>('all');
  const [pending, setPending] = useState<{ user:AdminUser; action:Action }|null>(null); const [temporary, setTemporary] = useState<{ username:string; password:string }|null>(null);
  const show = (list:AdminUser[]) => { setUsers(list); setData(d => ({ ...d, pendingUsers:list.filter(u => u.status === 'pending').length })); };
  const load = () => run(async () => show((await api<{ users:AdminUser[] }>('/api/admin/users')).users));
  useEffect(() => { void load(); }, []);
  const act = async (user:AdminUser, action:Action) => {
    const result = await run(async () => api<{ users:AdminUser[]; temporaryPassword?:string }>('/api/admin/users/action', { username:user.username, action }), { approve:'가입을 승인했어요.', activate:'이용을 다시 열었어요.', suspend:'이용을 중지했어요.', reset:'비밀번호를 초기화했어요.', delete:'회원을 삭제했어요.' }[action]);
    if (!result) return;
    show(result.users); setPending(null);
    if (result.temporaryPassword) setTemporary({ username:user.username, password:result.temporaryPassword });
  };
  const request = (user:AdminUser, action:Action) => confirmCopy[action] ? setPending({ user, action }) : void act(user, action);
  if (!users) return <section className="card"><div className="loading-block"><Spinner label="회원 목록을 불러오는 중이에요"/></div></section>;
  const count = (status:AdminUser['status']) => users.filter(u => u.status === status).length;
  const rows = users.filter(u => filter === 'all' || u.status === filter);
  return <>
    <div className="stats-grid four">
      <div className="stat-card static"><span className="stat-icon lilac"><Users size={19}/></span><span className="stat-text"><span>전체 회원</span><strong>{users.length}<em>명</em></strong><small>노트 {new Set(users.map(u => u.workspaceId)).size}개</small></span></div>
      <div className="stat-card static"><span className="stat-icon gold"><UserCheck size={19}/></span><span className="stat-text"><span>승인 대기</span><strong>{count('pending')}<em>명</em></strong><small>확인 후 승인해 주세요</small></span></div>
      <div className="stat-card static"><span className="stat-icon mint"><Check size={19}/></span><span className="stat-text"><span>이용 중</span><strong>{count('active')}<em>명</em></strong><small>초대로 가입 {users.filter(u => u.invitedBy).length}명</small></span></div>
      <div className="stat-card static"><span className="stat-icon rose"><Ban size={19}/></span><span className="stat-text"><span>이용 중지</span><strong>{count('suspended')}<em>명</em></strong><small>로그인이 막힌 계정</small></span></div>
    </div>
    <div className="toolbar"><Segmented label="회원 상태" value={filter} onChange={setFilter} options={[['all', '전체', users.length], ['pending', '승인 대기', count('pending')], ['active', '이용 중', count('active')], ['suspended', '중지', count('suspended')]]}/><div className="toolbar-actions"><Button kind="secondary" size="small" onClick={() => void load()} disabled={blocked}><RefreshCw size={15}/>새로고침</Button></div></div>
    <section className="card list-card">{rows.length ? <ul className="admin-list">{rows.map(u => <li key={u.username} className={u.status}>
      <Avatar name={u.name} side={u.side}/>
      <div className="admin-user"><strong>{u.name}<small>@{u.username}</small>{u.role === 'admin' && <Badge tone="lilac"><ShieldCheck size={12}/>관리자</Badge>}</strong>
        <span>{sideLabel[u.side]} · 가입 {new Date(u.createdAt).toLocaleDateString('ko-KR')}{u.lastLoginAt && ` · 최근 접속 ${ago(u.lastLoginAt)}`}</span>
        <span>{u.partners.length ? `함께 쓰는 사람: ${u.partners.join(', ')}` : '혼자 쓰는 노트'}{u.invitedBy && ` · ${u.invitedBy}님의 초대`}</span>
      </div>
      <Badge tone={statusTone[u.status]}>{statusLabel[u.status]}</Badge>
      {u.role !== 'admin' && u.username !== data.user.username ? <div className="admin-actions">
        {u.status === 'pending' && <Button size="small" disabled={blocked} onClick={() => request(u, 'approve')}><Check size={15}/>승인</Button>}
        {u.status === 'suspended' && <Button size="small" kind="secondary" disabled={blocked} onClick={() => request(u, 'activate')}><RotateCcw size={15}/>다시 열기</Button>}
        {u.status === 'active' && <Button size="small" kind="secondary" disabled={blocked} onClick={() => request(u, 'suspend')}><Ban size={15}/>중지</Button>}
        {u.status !== 'pending' && <Button size="small" kind="ghost" disabled={blocked} onClick={() => request(u, 'reset')}><KeyRound size={15}/>비밀번호</Button>}
        <Button size="small" kind="ghost" disabled={blocked} onClick={() => request(u, 'delete')}><Trash2 size={15}/>{u.status === 'pending' ? '거절' : '삭제'}</Button>
      </div> : <span className="admin-actions muted-text">나</span>}
    </li>)}</ul> : <Empty icon={Users} title="해당하는 회원이 없어요" description="다른 상태를 선택해 보세요."/>}</section>
    {pending && <Modal title={confirmCopy[pending.action]![0]} onClose={() => setPending(null)} busy={blocked}><div className="confirm-body"><p><strong>{pending.user.name}</strong>(@{pending.user.username}) 회원</p><span>{confirmCopy[pending.action]![1]}</span></div><div className="modal-actions"><Button kind="secondary" onClick={() => setPending(null)} disabled={blocked}>취소</Button><Button kind={pending.action === 'reset' ? 'primary' : 'danger'} busy={blocked} onClick={() => void act(pending.user, pending.action)}>{confirmCopy[pending.action]![2]}</Button></div></Modal>}
    {temporary && <Modal title="임시 비밀번호" onClose={() => setTemporary(null)}><div className="confirm-body"><p>@{temporary.username} 회원의 임시 비밀번호예요.</p><div className="temp-password"><code>{temporary.password}</code><Button kind="secondary" size="small" onClick={async () => notify(await copyText(temporary.password) ? '임시 비밀번호를 복사했어요.' : '복사하지 못했어요.')}><Copy size={14}/>복사</Button></div><span>이 창을 닫으면 다시 볼 수 없어요. 회원에게 안전하게 전달하고, 로그인 후 바로 바꾸도록 안내해 주세요.</span></div><div className="modal-actions"><Button onClick={() => setTemporary(null)}>확인</Button></div></Modal>}
  </>;
}
