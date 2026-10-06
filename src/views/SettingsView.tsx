import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, Crown, Download, Heart, KeyRound, Link as LinkIcon, LogOut, Share2, Upload, UserMinus, UserPlus, UserRound } from 'lucide-react';
import { usePlanner } from '../planner';
import { api } from '../lib/api';
import { copyText, download, num, sideLabel, today } from '../lib/format';
import type { PlanState, SessionUser, Settings, Side, WorkspaceInfo } from '../types';
import { Avatar, Badge, Button, Modal, PasswordInput, Segmented } from '../components/ui';

export function SettingsView({ onLogout }:{ onLogout:() => void }) {
  return <div className="settings-grid">
    <WeddingInfo/>
    <div className="settings-side"><Members/><Account onLogout={onLogout}/><Backup/></div>
  </div>;
}

function WeddingInfo() {
  const { state, saveSettings, blocked } = usePlanner();
  const [values, setValues] = useState<Settings>(state.settings); const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setValues(state.settings); }, [state.settings, dirty]);
  const change = (name:keyof Settings, value:string) => { setDirty(true); setValues(v => ({ ...v, [name]:name === 'totalBudget' || name === 'guestTarget' ? num(value) : value })); };
  const submit = async (event:FormEvent) => { event.preventDefault(); if (await saveSettings(values)) setDirty(false); };
  return <form className="card settings-card" onSubmit={submit}>
    <div className="section-title"><h2><Heart size={18}/>두 사람의 기본 정보</h2>{dirty && <Badge tone="gold">저장 전</Badge>}</div>
    <div className="form-grid">
      <label className="field wide"><span>노트 이름 (두 사람의 이름)</span><input value={values.coupleNames} maxLength={100} placeholder="예: 동환 ♥ 지은" onChange={e => change('coupleNames', e.target.value)}/></label>
      <label className="field"><span>결혼 날짜</span><input type="date" value={values.weddingDate} onChange={e => change('weddingDate', e.target.value)}/></label>
      <label className="field"><span>예상 하객 수</span><span className="input-suffix"><input type="number" inputMode="numeric" min={0} max={10000} value={values.guestTarget || ''} placeholder="0" onChange={e => change('guestTarget', e.target.value)}/><em>명</em></span></label>
      <label className="field wide"><span>예식 장소</span><input value={values.venue} maxLength={300} placeholder="예식장 이름 또는 주소" onChange={e => change('venue', e.target.value)}/></label>
      <label className="field wide"><span>전체 목표 예산</span><span className="input-suffix"><input type="number" inputMode="numeric" min={0} max={1e12} value={values.totalBudget || ''} placeholder="0" onChange={e => change('totalBudget', e.target.value)}/><em>원</em></span><small>{values.totalBudget ? `${new Intl.NumberFormat('ko-KR').format(values.totalBudget)}원 · 예산 관리에서 실제 지출과 비교해요.` : '예산 관리에서 실제 지출과 비교할 수 있어요.'}</small></label>
    </div>
    <div className="form-actions"><Button type="submit" busy={blocked} disabled={!dirty}><Check size={16}/>정보 저장하기</Button></div>
  </form>;
}

function Members() {
  const { data, setWorkspace, run, blocked, notify } = usePlanner();
  const { workspace, user } = data;
  const [confirm, setConfirm] = useState<string|null>(null);
  useEffect(() => { api<{ workspace:WorkspaceInfo }>('/api/workspace').then(r => setWorkspace(r.workspace)).catch(() => undefined); }, []);
  const owner = workspace.members.find(m => m.owner)?.username === user.username;
  const target:Side = user.side === 'bride' ? 'groom' : 'bride';
  const link = workspace.invite ? `${location.origin}/invite/${workspace.invite.code}` : '';
  const create = () => run(async () => setWorkspace((await api<{ workspace:WorkspaceInfo }>('/api/invite', { side:target })).workspace), '초대 링크를 만들었어요.');
  const revoke = () => run(async () => setWorkspace((await api<{ workspace:WorkspaceInfo }>('/api/invite', undefined, 'DELETE')).workspace), '초대 링크를 취소했어요.');
  const share = async () => {
    const text = `${user.name}님이 우리의 웨딩 노트에 초대했어요. 링크를 눌러 함께 준비해요!`;
    if (navigator.share) { try { await navigator.share({ title:'우리의 웨딩 노트 초대장', text, url:link }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; } }
    notify(await copyText(link) ? '초대 링크를 복사했어요. 카카오톡에 붙여 넣어 보내 주세요.' : '복사하지 못했어요. 링크를 길게 눌러 복사해 주세요.');
  };
  const removeMember = async () => { if (!confirm) return; const username = confirm; await run(async () => { setWorkspace((await api<{ workspace:WorkspaceInfo }>('/api/members/remove', { username })).workspace); setConfirm(null); }, '함께하는 사람을 내보냈어요.'); };
  return <section className="card settings-card">
    <div className="section-title"><h2><UserPlus size={18}/>함께하는 사람</h2><Badge tone="rose">{workspace.members.length} / {workspace.maxMembers}</Badge></div>
    <ul className="member-list">{workspace.members.map(m => <li key={m.username}><Avatar name={m.name} side={m.side}/><span className="member-info"><strong>{m.name}{m.username === user.username && <em> (나)</em>}</strong><small>{sideLabel[m.side]} · {m.username}</small></span>{m.owner ? <Badge tone="gold"><Crown size={12}/>노트 주인</Badge> : owner && <button type="button" className="text-link danger" onClick={() => setConfirm(m.username)} disabled={blocked}><UserMinus size={14}/>내보내기</button>}</li>)}</ul>
    {workspace.members.length < workspace.maxMembers && <div className="invite-box">
      {workspace.invite ? <>
        <p><strong>{sideLabel[workspace.invite.side]}님 초대 링크</strong>가 준비됐어요. {new Date(workspace.invite.expiresAt).toLocaleDateString('ko-KR', { month:'long', day:'numeric' })}까지 한 번 사용할 수 있어요.</p>
        <div className="link-field"><LinkIcon size={16}/><input readOnly value={link} aria-label="초대 링크" onFocus={e => e.currentTarget.select()}/></div>
        <div className="invite-buttons"><Button onClick={() => void share()}><Share2 size={16}/>카카오톡 등으로 보내기</Button><Button kind="secondary" onClick={async () => notify(await copyText(link) ? '초대 링크를 복사했어요.' : '복사하지 못했어요.')}><Copy size={16}/>복사</Button><Button kind="ghost" size="small" onClick={() => void revoke()} disabled={blocked}>링크 취소</Button></div>
      </> : <>
        <p>{sideLabel[target]}님에게 초대 링크를 보내면, 링크로 가입하는 즉시 이 노트를 함께 쓸 수 있어요. 관리자 승인은 필요 없어요.</p>
        <Button onClick={() => void create()} busy={blocked}><UserPlus size={16}/>{sideLabel[target]} 초대 링크 만들기</Button>
      </>}
    </div>}
    {confirm && <Modal title="함께하는 사람 내보내기" onClose={() => setConfirm(null)} busy={blocked}><div className="confirm-body"><p>이 분을 노트에서 내보낼까요?</p><span>내보낸 분은 바로 로그아웃되고, 다음 로그인부터 새 노트를 쓰게 돼요. 지금까지의 기록은 이 노트에 그대로 남아요.</span></div><div className="modal-actions"><Button kind="secondary" onClick={() => setConfirm(null)} disabled={blocked}>취소</Button><Button kind="danger" busy={blocked} onClick={() => void removeMember()}><UserMinus size={15}/>내보내기</Button></div></Modal>}
  </section>;
}

function Account({ onLogout }:{ onLogout:() => void }) {
  const { data, setData, run, blocked } = usePlanner();
  const [profile, setProfile] = useState({ name:data.user.name, side:data.user.side });
  const [password, setPassword] = useState({ current:'', next:'', confirm:'' }); const [error, setError] = useState('');
  const saveProfile = (event:FormEvent) => { event.preventDefault(); void run(async () => { const result = await api<{ user:SessionUser }>('/api/account/profile', profile); setData(d => ({ ...d, user:result.user, workspace:{ ...d.workspace, members:d.workspace.members.map(m => m.username === result.user.username ? { ...m, name:result.user.name, side:result.user.side } : m) } })); }, '프로필을 저장했어요.'); };
  const changePassword = (event:FormEvent) => {
    event.preventDefault(); setError('');
    if (password.next !== password.confirm) { setError('새 비밀번호 확인이 일치하지 않아요.'); return; }
    void run(async () => { await api('/api/account/password', { current:password.current, next:password.next }); setPassword({ current:'', next:'', confirm:'' }); }, '비밀번호를 바꿨어요. 다른 기기에서는 다시 로그인해야 해요.');
  };
  return <section className="card settings-card">
    <div className="section-title"><h2><UserRound size={18}/>내 계정</h2>{data.user.role === 'admin' && <Badge tone="lilac">관리자</Badge>}</div>
    <form className="stack" onSubmit={saveProfile}>
      <label className="field"><span>이름</span><input value={profile.name} maxLength={20} required onChange={e => setProfile({ ...profile, name:e.target.value })}/></label>
      <div className="field"><span>저는</span><Segmented label="신랑 또는 신부" value={profile.side === 'other' ? 'groom' : profile.side} onChange={side => setProfile({ ...profile, side })} options={[['groom', '신랑'], ['bride', '신부']]}/></div>
      <Button kind="secondary" type="submit" disabled={blocked || (profile.name === data.user.name && profile.side === data.user.side)}><Check size={16}/>프로필 저장</Button>
    </form>
    <form className="stack divided" onSubmit={changePassword}>
      <h3><KeyRound size={16}/>비밀번호 변경</h3>
      <input type="text" name="username" autoComplete="username" value={data.user.username} readOnly hidden/>
      <label className="field"><span>현재 비밀번호</span><PasswordInput value={password.current} onChange={current => setPassword({ ...password, current })} autoComplete="current-password"/></label>
      <label className="field"><span>새 비밀번호</span><PasswordInput value={password.next} onChange={next => setPassword({ ...password, next })} autoComplete="new-password" placeholder="영문과 숫자를 섞어 8자 이상"/></label>
      <label className="field"><span>새 비밀번호 확인</span><PasswordInput value={password.confirm} onChange={confirm => setPassword({ ...password, confirm })} autoComplete="new-password"/></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button kind="secondary" type="submit" disabled={blocked || !password.current || !password.next}><KeyRound size={16}/>비밀번호 바꾸기</Button>
    </form>
    <button type="button" className="logout-link" onClick={onLogout} disabled={blocked}><LogOut size={16}/>로그아웃</button>
  </section>;
}

function Backup() {
  const { state, data, run, blocked, setState } = usePlanner();
  const input = useRef<HTMLInputElement>(null); const [pending, setPending] = useState<PlanState|null>(null); const [error, setError] = useState('');
  const pick = async (file?:File) => {
    setError(''); if (input.current) input.current.value = '';
    if (!file) return;
    try { if (file.size > 5 * 1024 * 1024) throw new Error('백업 파일은 5MB 이하의 JSON 파일이어야 해요.'); const parsed = JSON.parse(await file.text()); setPending((parsed.state || parsed) as PlanState); }
    catch (e) { setError(e instanceof SyntaxError ? '올바른 JSON 백업 파일을 선택해 주세요.' : (e as Error).message); }
  };
  const restore = async () => { if (!pending) return; const backup = pending; await run(async () => { setState((await api<{ state:PlanState }>('/api/state', { state:backup, version:state.version }, 'PUT')).state); setPending(null); }, '백업으로 복원했어요.'); };
  return <section className="card settings-card">
    <div className="section-title"><h2><Download size={18}/>기록 보관하기</h2></div>
    <p className="muted-text">준비한 내용을 JSON 파일로 내려받아 두고, 필요할 때 다시 불러올 수 있어요. 올린 자료 파일은 백업에 포함되지 않아요.</p>
    <div className="button-row"><Button kind="secondary" onClick={() => download(`우리의-웨딩노트-${today()}.json`, JSON.stringify({ exportedAt:new Date().toISOString(), exportedBy:data.user.name, state }, null, 2), 'application/json')}><Download size={16}/>내보내기</Button><Button kind="secondary" disabled={blocked} onClick={() => input.current?.click()}><Upload size={16}/>백업 불러오기</Button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <input ref={input} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} onChange={e => void pick(e.target.files?.[0])}/>
    {pending && <Modal title="백업으로 복원" onClose={() => setPending(null)} busy={blocked}><div className="confirm-body"><p>지금 노트를 선택한 백업 내용으로 바꿀까요?</p><span>할 일, 예산, 업체, 하객, 타임라인, 메모가 백업 내용으로 바뀌어요. 함께 쓰는 분의 화면에도 반영돼요. 먼저 지금 노트를 내보내 두면 안전해요.</span></div><div className="modal-actions"><Button kind="secondary" onClick={() => setPending(null)} disabled={blocked}>취소</Button><Button busy={blocked} onClick={() => void restore()}><Upload size={15}/>복원하기</Button></div></Modal>}
  </section>;
}
