import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, CalendarHeart, CircleAlert, Heart, HeartHandshake, Hourglass, Mail, Sparkles, SquareCheck, Wallet } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { sideLabel } from '../lib/format';
import type { InvitePreview, SessionUser, Side } from '../types';
import { Button, PasswordInput, Segmented, Spinner } from './ui';

export function Backdrop() { return <div className="backdrop" aria-hidden="true"><i/><i/><i/></div>; }
export function BrandMark({ size = 44 }:{ size?:number }) { return <span className="brand-mark" style={{ width:size, height:size }}><Heart size={Math.round(size * 0.5)} fill="currentColor"/></span>; }

function AuthLayout({ children }:{ children:ReactNode }) {
  return <div className="auth-page"><Backdrop/>
    <section className="auth-hero">
      <div className="auth-brand"><BrandMark size={40}/><span><strong>우리의 웨딩 노트</strong><small>OUR WEDDING NOTE</small></span></div>
      <div className="auth-copy">
        <span className="eyebrow">함께 준비하는 가장 특별한 하루</span>
        <h1>우리의 결혼,<br/>차근차근 아름답게.</h1>
        <p>할 일과 예산, 하객과 본식 타임라인까지.{' '}<br/>둘이 함께 쓰는 웨딩 노트에 모두 담아요.</p>
        <ul className="auth-features"><li><SquareCheck size={17}/>준비 체크리스트</li><li><Wallet size={17}/>예산 · 업체 비교</li><li><HeartHandshake size={17}/>신랑 · 신부 함께 쓰기</li><li><Sparkles size={17}/>AI 웨딩플래너</li></ul>
      </div>
      <span className="auth-footnote">A little planning, a lot of love.</span>
    </section>
    <section className="auth-panel">{children}</section>
  </div>;
}

type Mode = 'login'|'signup';
export function AuthScreen({ onLogin }:{ onLogin:(user:SessionUser) => Promise<void> }) {
  const [mode, setMode] = useState<Mode>('login');
  const [form, setForm] = useState({ username:'', password:'', confirm:'', name:'', side:'groom' as Side });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [submitted, setSubmitted] = useState(false);
  const update = (patch:Partial<typeof form>) => { setForm(current => ({ ...current, ...patch })); setError(''); };
  const switchMode = (next:Mode) => { setMode(next); setError(''); setForm(current => ({ ...current, password:'', confirm:'' })); };
  const submit = async (event:FormEvent) => {
    event.preventDefault(); if (busy) return;
    if (mode === 'signup' && form.password !== form.confirm) { setError('비밀번호 확인이 일치하지 않아요.'); return; }
    setBusy(true); setError('');
    try {
      if (mode === 'login') { const result = await api<{ user:SessionUser }>('/api/login', { username:form.username, password:form.password }); await onLogin(result.user); }
      else { await api('/api/signup', { username:form.username, password:form.password, name:form.name, side:form.side }); setSubmitted(true); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  if (submitted) return <AuthLayout><div className="auth-card glass result-card">
    <span className="result-icon"><Hourglass size={26}/></span>
    <h2>가입 신청이 접수되었어요</h2>
    <p>관리자가 확인하고 승인하면 바로 로그인할 수 있어요.<br/>{form.side === 'bride' ? '신랑' : '신부'}에게 초대 링크를 받았다면, 그 링크로 가입하면 승인 없이 바로 함께 쓸 수 있어요.</p>
    <Button onClick={() => { setSubmitted(false); switchMode('login'); }}>로그인 화면으로<ArrowRight size={17}/></Button>
  </div></AuthLayout>;
  return <AuthLayout><form className="auth-card glass" onSubmit={submit}>
    <div className="auth-card-head"><BrandMark size={46}/><div><h2>{mode === 'login' ? '다시 만나서 반가워요' : '웨딩 노트 시작하기'}</h2><p>{mode === 'login' ? '아이디와 비밀번호로 로그인해 주세요.' : '가입 신청 후 관리자 승인을 거쳐 이용할 수 있어요.'}</p></div></div>
    <Segmented label="로그인 또는 회원가입" value={mode} onChange={switchMode} options={[['login', '로그인'], ['signup', '회원가입']]}/>
    {mode === 'signup' && <>
      <label className="field"><span>이름</span><input value={form.name} onChange={e => update({ name:e.target.value })} maxLength={20} required autoComplete="nickname" placeholder="노트에 표시될 이름"/></label>
      <div className="field"><span>저는</span><Segmented label="신랑 또는 신부" value={form.side} onChange={side => update({ side })} options={[['groom', '신랑이에요'], ['bride', '신부예요']]}/></div>
    </>}
    <label className="field"><span>아이디</span><input value={form.username} onChange={e => update({ username:e.target.value })} required maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" placeholder="영문 소문자·숫자 4~20자"/></label>
    <label className="field"><span>비밀번호</span><PasswordInput value={form.password} onChange={password => update({ password })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? '비밀번호' : '영문과 숫자를 섞어 8자 이상'}/></label>
    {mode === 'signup' && <label className="field"><span>비밀번호 확인</span><PasswordInput value={form.confirm} onChange={confirm => update({ confirm })} autoComplete="new-password" placeholder="한 번 더 입력해 주세요"/></label>}
    {error && <p className="form-error" role="alert"><CircleAlert size={16}/>{error}</p>}
    <Button type="submit" busy={busy} className="block">{mode === 'login' ? '웨딩 노트 열기' : '가입 신청하기'}{!busy && <ArrowRight size={18}/>}</Button>
    <p className="auth-switch">{mode === 'login' ? <>아직 계정이 없나요? <button type="button" onClick={() => switchMode('signup')}>회원가입</button></> : <>이미 계정이 있나요? <button type="button" onClick={() => switchMode('login')}>로그인</button></>}</p>
  </form></AuthLayout>;
}

export function InviteScreen({ code, currentUser, onAccepted, onLeave }:{ code:string; currentUser:SessionUser|null; onAccepted:(user:SessionUser) => Promise<void>; onLeave:() => void }) {
  const [invite, setInvite] = useState<InvitePreview|null>(null); const [problem, setProblem] = useState('');
  const [mode, setMode] = useState<'signup'|'login'>('signup');
  const [form, setForm] = useState({ username:'', password:'', confirm:'', name:'' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { api<{ invite:InvitePreview }>(`/api/invites/${encodeURIComponent(code)}`).then(r => setInvite(r.invite)).catch((e:ApiError) => setProblem(e.message)); }, [code]);
  const update = (patch:Partial<typeof form>) => { setForm(current => ({ ...current, ...patch })); setError(''); };
  const accept = async (body:Record<string, string>) => {
    if (busy) return; setBusy(true); setError('');
    try { const result = await api<{ user:SessionUser }>(`/api/invites/${encodeURIComponent(code)}/accept`, body); await onAccepted(result.user); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const submit = (event:FormEvent) => {
    event.preventDefault();
    if (mode === 'signup' && form.password !== form.confirm) { setError('비밀번호 확인이 일치하지 않아요.'); return; }
    void accept(mode === 'signup' ? { mode, username:form.username, password:form.password, name:form.name } : { mode, username:form.username, password:form.password });
  };
  if (problem) return <AuthLayout><div className="auth-card glass result-card"><span className="result-icon muted"><CircleAlert size={26}/></span><h2>초대장을 열 수 없어요</h2><p>{problem}</p><Button onClick={onLeave}>{currentUser ? '내 노트로 가기' : '로그인 화면으로'}<ArrowRight size={17}/></Button></div></AuthLayout>;
  if (!invite) return <AuthLayout><div className="auth-card glass result-card"><Spinner label="초대장을 펼치는 중이에요"/></div></AuthLayout>;
  const role = sideLabel[invite.side];
  const notice = <p className="form-note"><CircleAlert size={15}/>이미 쓰던 노트가 있다면, 수락 후에는 {invite.inviterName}님의 노트를 함께 쓰게 되고 혼자 쓰던 노트는 정리돼요.</p>;
  return <AuthLayout><div className="auth-card glass invite-card">
    <div className="invitation"><span className="envelope"><Mail size={26}/></span><span className="eyebrow">WEDDING NOTE INVITATION</span><h2>{invite.inviterName}님이<br/>함께 준비하자고 초대했어요</h2><p><CalendarHeart size={15}/>{role}님을 위한 초대장 · {new Date(invite.expiresAt).toLocaleDateString('ko-KR', { month:'long', day:'numeric' })}까지 유효</p></div>
    {currentUser ? <div className="invite-actions">
      <p className="signed-in-as"><strong>{currentUser.name}</strong>({currentUser.username}) 계정으로 로그인되어 있어요.</p>
      {notice}
      {error && <p className="form-error" role="alert"><CircleAlert size={16}/>{error}</p>}
      <Button busy={busy} className="block" onClick={() => void accept({ mode:'session' })}>이 계정으로 함께하기{!busy && <ArrowRight size={18}/>}</Button>
      <Button kind="ghost" className="block" onClick={onLeave} disabled={busy}>나중에 할게요</Button>
    </div> : <form onSubmit={submit} className="invite-form">
      <Segmented label="가입 또는 로그인" value={mode} onChange={next => { setMode(next); setError(''); }} options={[['signup', '처음이에요'], ['login', '계정이 있어요']]}/>
      {mode === 'signup' && <label className="field"><span>이름</span><input value={form.name} onChange={e => update({ name:e.target.value })} maxLength={20} required autoComplete="nickname" placeholder={`노트에 표시될 ${role}님 이름`}/></label>}
      <label className="field"><span>아이디</span><input value={form.username} onChange={e => update({ username:e.target.value })} required maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" placeholder="영문 소문자·숫자 4~20자"/></label>
      <label className="field"><span>비밀번호</span><PasswordInput value={form.password} onChange={password => update({ password })} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder={mode === 'signup' ? '영문과 숫자를 섞어 8자 이상' : '비밀번호'}/></label>
      {mode === 'signup' && <label className="field"><span>비밀번호 확인</span><PasswordInput value={form.confirm} onChange={confirm => update({ confirm })} autoComplete="new-password" placeholder="한 번 더 입력해 주세요"/></label>}
      {mode === 'login' && notice}
      {error && <p className="form-error" role="alert"><CircleAlert size={16}/>{error}</p>}
      <Button type="submit" busy={busy} className="block">{mode === 'signup' ? '가입하고 함께하기' : '로그인하고 함께하기'}{!busy && <ArrowRight size={18}/>}</Button>
      <p className="auth-switch">초대 링크로 가입하면 관리자 승인 없이 바로 시작돼요.</p>
    </form>}
  </div></AuthLayout>;
}
