import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, Check, Ellipsis, LogOut, Menu, RefreshCw, Trash2, X } from 'lucide-react';
import { api, ApiError, clearInviteUrl, readInviteCode } from './lib/api';
import { dday, josa, num, sideLabel, uid } from './lib/format';
import { collectionName, guestSides, headings, navigation, PlannerContext, rsvpLabels, taskStatus, vendorStatus, views, type Item, type Planner, type View } from './planner';
import type { Bootstrap, Collection, PlanState, SessionUser, Settings, WorkspaceInfo } from './types';
import { AuthScreen, Backdrop, BrandMark, InviteScreen } from './components/AuthScreen';
import { Avatar, Button, FeedbackContext, IconButton, Modal, Spinner, Toast } from './components/ui';
import { Dashboard } from './views/Dashboard';
import { Agent } from './views/Agent';
import { listViews } from './views/Lists';
import { Materials } from './views/Materials';
import { SettingsView } from './views/SettingsView';
import { Admin } from './views/Admin';

export default function App() {
  const [session, setSession] = useState<{ checked:boolean; user:SessionUser|null }>({ checked:false, user:null });
  const [data, setData] = useState<Bootstrap|null>(null);
  const [invite, setInvite] = useState<string|null>(() => readInviteCode());
  const [failure, setFailure] = useState('');
  const load = useCallback(async () => { setFailure(''); try { setData(await api<Bootstrap>('/api/bootstrap')); } catch (e) { if (e instanceof ApiError && e.status === 401) setSession({ checked:true, user:null }); else setFailure((e as Error).message); } }, []);
  useEffect(() => {
    api<{ authenticated:boolean; user:SessionUser|null }>('/api/session')
      .then(async result => { setSession({ checked:true, user:result.user }); if (result.user && !readInviteCode()) await load(); })
      .catch(e => { setSession({ checked:true, user:null }); setFailure((e as Error).message); });
  }, [load]);
  const signedIn = async (user:SessionUser) => { setSession({ checked:true, user }); await load(); };
  const leaveInvite = async () => { clearInviteUrl(); setInvite(null); if (session.user) await load(); };
  const signedOut = useCallback((message?:string) => { setData(null); setSession({ checked:true, user:null }); setFailure(message || ''); }, []);
  const switchAccount = async () => { try { await api('/api/logout', {}); } catch {} setData(null); setSession({ checked:true, user:null }); };

  if (!session.checked) return <Splash/>;
  if (invite) return <InviteScreen code={invite} currentUser={session.user} onSwitchAccount={switchAccount} onLeave={() => void leaveInvite()} onAccepted={async user => { clearInviteUrl(); setInvite(null); await signedIn(user); }}/>;
  if (!session.user) return <>{failure && <div className="floating-error" role="alert">{failure}</div>}<AuthScreen onLogin={signedIn}/></>;
  if (!data) return <Splash error={failure} onRetry={() => void load()}/>;
  return <Shell data={data} setData={setData} onSignedOut={signedOut}/>;
}

function Splash({ error, onRetry }:{ error?:string; onRetry?:() => void }) {
  return <div className="splash"><Backdrop/><div className="splash-card glass"><BrandMark size={52}/><h1>우리의 웨딩 노트</h1>{error ? <><p className="form-error">{error}</p><Button onClick={onRetry}><RefreshCw size={16}/>다시 불러오기</Button></> : <Spinner label="노트를 펼치는 중이에요"/>}</div></div>;
}

const viewFromHash = ():View => { const value = location.hash.replace(/^#\/?/, '') as View; return views.includes(value) ? value : 'dashboard'; };
type Editor = { collection:Collection; item?:Item };

function Shell({ data, setData, onSignedOut }:{ data:Bootstrap; setData:(update:Bootstrap|((d:Bootstrap|null) => Bootstrap|null)) => void; onSignedOut:(message?:string) => void }) {
  const [view, setView] = useState<View>(viewFromHash);
  const [busy, setBusy] = useState(false); const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState(''); const [toast, setToast] = useState('');
  const [editor, setEditor] = useState<Editor|null>(null); const [removal, setRemoval] = useState<{ collection:Collection; item:Item }|null>(null);
  const [drawer, setDrawer] = useState(false); const [draft, setDraft] = useState('');
  const state = data.state; const isAdmin = data.user.role === 'admin';
  const latest = useRef({ state, members:data.workspace.members.length, busy:false, modal:false });
  latest.current = { state, members:data.workspace.members.length, busy:busy || chatBusy, modal:!!editor || !!removal };
  const blocked = busy || chatBusy;

  useEffect(() => { const sync = () => { setView(viewFromHash()); setDrawer(false); }; window.addEventListener('popstate', sync); window.addEventListener('hashchange', sync); return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); }; }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3800); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { document.title = view === 'dashboard' ? '우리의 웨딩 노트' : `${navigation.find(n => n.id === view)?.label} · 우리의 웨딩 노트`; }, [view]);

  // Responses can arrive out of order (a slow refresh after a save); an older note never replaces a newer one.
  const setState = useCallback((next:PlanState) => setData(d => d && next.version >= d.state.version ? { ...d, state:next } : d), [setData]);
  const setWorkspace = useCallback((workspace:WorkspaceInfo) => setData(d => d ? { ...d, workspace } : d), [setData]);
  const fail = useCallback(async (e:unknown) => {
    if (e instanceof ApiError && e.status === 401) { onSignedOut('접속이 만료되었어요. 다시 로그인해 주세요.'); return; }
    if (e instanceof ApiError && e.code === 'conflict') { try { setState((await api<{ state:PlanState }>('/api/state')).state); } catch {} setError('함께 쓰는 분이 먼저 수정한 내용이 있어 최신 노트를 불러왔어요. 확인 후 다시 시도해 주세요.'); return; }
    setError((e as Error).message || '저장하지 못했어요. 다시 시도해 주세요.');
  }, [onSignedOut, setState]);
  const run = useCallback(async <T,>(task:() => Promise<T>, success?:string) => {
    setBusy(true); setError('');
    try { const result = await task(); if (success) setToast(success); return result; }
    catch (e) { await fail(e); return undefined; }
    finally { setBusy(false); }
  }, [fail]);

  // Pull changes made by the partner while this screen is open.
  useEffect(() => {
    const pull = async () => {
      if (document.hidden || latest.current.busy || latest.current.modal) return;
      try {
        const result = await api<{ state?:PlanState; memberCount?:number }>(`/api/state?since=${latest.current.state.version}`);
        if (result.state) setState(result.state);
        if (result.memberCount !== undefined && result.memberCount !== latest.current.members) setWorkspace((await api<{ workspace:WorkspaceInfo }>('/api/workspace')).workspace);
      } catch (e) { if (e instanceof ApiError && e.status === 401) onSignedOut('접속이 만료되었어요. 다시 로그인해 주세요.'); }
    };
    const timer = setInterval(pull, 30000); const onVisible = () => { if (!document.hidden) void pull(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [setState, setWorkspace, onSignedOut]);

  const navigate = useCallback((target:View) => {
    setDrawer(false); setError('');
    if (target === viewFromHash()) { window.scrollTo({ top:0, behavior:'smooth' }); return; }
    history.pushState(null, '', target === 'dashboard' ? location.pathname : `#/${target}`);
    setView(target); window.scrollTo({ top:0 });
  }, []);
  // Writes send the copy shown on screen, so the server can refuse to overwrite a partner's newer edit.
  const shown = (collection:Collection, id:string) => (latest.current.state[collection] as Item[]).find(row => row.id === id) ?? null;
  const saveItem = useCallback(async (collection:Collection, item:Item, success = '저장했어요.') => !!(await run(async () => { setState((await api<{ state:PlanState }>('/api/items', { collection, item, expected:shown(collection, item.id) })).state); return true; }, success)), [run, setState]);
  const removeItem = useCallback(async (collection:Collection, item:Item) => !!(await run(async () => { setState((await api<{ state:PlanState }>('/api/items/delete', { collection, id:item.id, expected:shown(collection, item.id) ?? undefined })).state); return true; }, '삭제했어요.')), [run, setState]);
  const saveSettings = useCallback(async (changes:Partial<Settings>, expected:Partial<Settings>) => !!(await run(async () => { setState((await api<{ state:PlanState }>('/api/settings', { settings:changes, expected }, 'PUT')).state); return true; }, '기본 정보를 저장했어요.')), [run, setState]);
  const sendChat = useCallback(async (message?:string) => {
    const text = (message ?? draft).trim();
    if (!text || busy || chatBusy || !data.agentReady) return;
    setChatBusy(true); setError('');
    try { const result = await api<{ state:PlanState }>('/api/chat', { message:text, requestId:uid() }); setState(result.state); setDraft(current => current.trim() === text ? '' : current); }
    catch (e) { await fail(e); }
    finally { setChatBusy(false); }
  }, [draft, busy, chatBusy, data.agentReady, fail, setState]);
  const logout = useCallback(async () => { try { await api('/api/logout', {}); } catch {} history.replaceState(null, '', '/'); onSignedOut(); }, [onSignedOut]);

  const planner = useMemo<Planner>(() => ({
    data, state, blocked, busy, chatBusy, isAdmin, navigate, ask:(message:string) => { setDraft(message); navigate('agent'); },
    draft, setDraft, sendChat, saveItem, removeItem, saveSettings, setState, setWorkspace,
    setData:(update:(d:Bootstrap) => Bootstrap) => setData(d => d ? update(d) : d), run, notify:setToast, fail:setError, signOut:onSignedOut,
    openEditor:(collection:Collection, item?:Item) => setEditor({ collection, item }), confirmRemove:(collection:Collection, item:Item) => setRemoval({ collection, item })
  }), [data, state, blocked, busy, chatBusy, isAdmin, navigate, draft, sendChat, saveItem, removeItem, saveSettings, setState, setWorkspace, setData, run, onSignedOut]);
  const feedback = useMemo(() => ({ error, clear:() => setError('') }), [error]);

  const current = view === 'admin' && !isAdmin ? 'dashboard' : view;
  const [eyebrow, title, subtitle] = headings[current];
  const countdown = dday(state.settings.weddingDate);
  const members = data.workspace.members;
  const ListView = current in listViews ? listViews[current as keyof typeof listViews] : null;
  const nav = navigation.filter(n => !n.admin || isAdmin);
  const groups = [...new Set(nav.map(n => n.group))];
  const mobileTabs:View[] = ['dashboard', 'tasks', 'agent', 'budgets'];

  return <PlannerContext.Provider value={planner}><FeedbackContext.Provider value={feedback}>
    <div className="app-shell"><Backdrop/>
      <aside className={`sidebar glass ${drawer ? 'open' : ''}`} aria-label="주 메뉴">
        <div className="sidebar-head"><button type="button" className="brand" onClick={() => navigate('dashboard')}><BrandMark size={38}/><span><strong>우리의 웨딩 노트</strong><small>OUR WEDDING NOTE</small></span></button><IconButton className="drawer-close" label="메뉴 닫기" onClick={() => setDrawer(false)}><X size={20}/></IconButton></div>
        <div className="couple-card">
          <div className="couple-avatars">{members.map(m => <Avatar key={m.username} name={m.name} side={m.side}/>)}</div>
          <strong>{state.settings.coupleNames || members.map(m => m.name).join(' ♥ ')}</strong>
          <span><CalendarDays size={13}/>{state.settings.weddingDate ? new Date(`${state.settings.weddingDate}T00:00:00`).toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric' }) : '결혼 날짜를 정해 주세요'}<em>{countdown.label}</em></span>
        </div>
        <nav>{groups.map(group => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{nav.filter(n => n.group === group).map(({ id, label, icon:Icon }) => <button type="button" key={id} className={`nav-item ${current === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={current === id ? 'page' : undefined}><Icon size={19}/><span>{label}</span>{id === 'agent' && <em className="nav-tag">AI</em>}{id === 'admin' && !!data.pendingUsers && <em className="nav-count" aria-label={`승인 대기 ${data.pendingUsers}명`}>{data.pendingUsers}</em>}</button>)}</div>)}</nav>
        <div className="sidebar-foot"><div className="me"><Avatar name={data.user.name} side={data.user.side} size="small"/><span><strong>{data.user.name}</strong><small>{sideLabel[data.user.side]}{isAdmin ? ' · 관리자' : ''}</small></span></div><IconButton label="로그아웃" onClick={() => void logout()} disabled={blocked}><LogOut size={18}/></IconButton></div>
      </aside>
      {drawer && <button type="button" className="drawer-scrim" aria-label="메뉴 닫기" onClick={() => setDrawer(false)}/>}
      <main className="main">
        <header className="topbar glass">
          <div className="topbar-title"><IconButton className="menu-button" label="메뉴 열기" onClick={() => setDrawer(true)}><Menu size={21}/></IconButton><span className="crumb">우리의 웨딩 노트</span><strong>{navigation.find(n => n.id === current)?.label}</strong></div>
          <div className="topbar-right"><span className={`sync ${blocked ? 'working' : ''}`}><i/>{chatBusy ? '플래너가 생각 중' : busy ? '저장 중' : '저장됨'}</span><span className="topbar-dday">{countdown.label}</span><button type="button" className="me-button" onClick={() => navigate('settings')} aria-label="설정 · 함께하기 열기"><Avatar name={data.user.name} side={data.user.side} size="small"/></button></div>
        </header>
        <div className="content">
          <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div></div>
          {error && <div className="alert" role="alert"><span>{error}</span><IconButton label="안내 닫기" onClick={() => setError('')}><X size={17}/></IconButton></div>}
          {current !== 'settings' && current !== 'admin' && !state.settings.weddingDate && <button type="button" className="setup-banner glass" onClick={() => navigate('settings')}><CalendarDays size={20}/><span><strong>두 사람의 계획부터 시작해요.</strong> 결혼 날짜와 목표 예산을 알려 주면 준비가 훨씬 쉬워져요.</span><ArrowRight size={17}/></button>}
          {current === 'dashboard' && <Dashboard/>}
          {current === 'agent' && <Agent/>}
          {ListView && <ListView/>}
          {current === 'materials' && <Materials/>}
          {current === 'settings' && <SettingsView onLogout={() => void logout()}/>}
          {current === 'admin' && <Admin/>}
        </div>
        <footer className="app-footer">우리의 속도로, 함께 준비하는 하루.</footer>
      </main>
      <nav className="tabbar glass" aria-label="빠른 메뉴">{mobileTabs.map(id => { const item = navigation.find(n => n.id === id)!; const Icon = item.icon; return <button type="button" key={id} className={current === id ? 'active' : ''} onClick={() => navigate(id)} aria-current={current === id ? 'page' : undefined}><Icon size={21}/><span>{item.short}</span></button>; })}<button type="button" className={drawer || !mobileTabs.includes(current) ? 'active' : ''} onClick={() => setDrawer(true)}><Ellipsis size={21}/><span>전체</span></button></nav>
    </div>
    {toast && <Toast message={toast}/>}
    {editor && <ItemEditor key={`${editor.collection}-${editor.item?.id || 'new'}`} editor={editor} current={editor.item ? shown(editor.collection, editor.item.id) : null} busy={blocked} onClose={() => setEditor(null)} onSave={async item => { if (await saveItem(editor.collection, item, editor.item ? '수정했어요.' : `${josa(collectionName[editor.collection], '을/를')} 추가했어요.`)) setEditor(null); }}/>}
    {removal && <Modal title={`${collectionName[removal.collection]} 삭제`} onClose={() => setRemoval(null)} busy={blocked}><div className="confirm-body"><p>‘{'title' in removal.item ? removal.item.title : removal.item.name}’ 항목을 삭제할까요?</p><span>함께 쓰는 분의 노트에서도 삭제돼요.</span></div><div className="modal-actions"><Button kind="secondary" disabled={blocked} onClick={() => setRemoval(null)}>취소</Button><Button kind="danger" busy={blocked} onClick={async () => { if (await removeItem(removal.collection, removal.item)) setRemoval(null); }}><Trash2 size={15}/>삭제하기</Button></div></Modal>}
  </FeedbackContext.Provider></PlannerContext.Provider>;
}

type Field = { name:string; label:string; type?:'text'|'number'|'date'|'time'|'url'|'tel'|'select'|'textarea'; options?:[string, string][]; required?:boolean; placeholder?:string; wide?:boolean; max?:number; min?:number; maxLength?:number };
const fields:Record<Collection, Field[]> = {
  tasks:[{ name:'title', label:'할 일', required:true, wide:true, placeholder:'예: 웨딩홀 방문 상담 예약', maxLength:300 }, { name:'category', label:'분류', placeholder:'예: 웨딩홀', maxLength:100 }, { name:'dueDate', label:'마감일', type:'date' }, { name:'status', label:'진행 상태', type:'select', options:Object.entries(taskStatus) }, { name:'notes', label:'메모', type:'textarea', wide:true, maxLength:2000 }],
  budgets:[{ name:'title', label:'항목', required:true, wide:true, placeholder:'예: 스튜디오 촬영', maxLength:300 }, { name:'category', label:'분류', placeholder:'예: 스드메', maxLength:100 }, { name:'planned', label:'예정 금액 (원)', type:'number' }, { name:'actual', label:'확정 금액 (원)', type:'number' }, { name:'paid', label:'지급 금액 (원)', type:'number' }, { name:'notes', label:'메모', type:'textarea', wide:true, maxLength:2000 }],
  vendors:[{ name:'name', label:'업체명', required:true, wide:true, maxLength:300 }, { name:'category', label:'분류', placeholder:'예: 웨딩홀', maxLength:100 }, { name:'status', label:'상담 · 계약 상태', type:'select', options:Object.entries(vendorStatus) }, { name:'price', label:'견적 금액 (원)', type:'number' }, { name:'contact', label:'연락처', type:'tel', maxLength:300 }, { name:'url', label:'홈페이지 주소', type:'url', wide:true, placeholder:'https://', maxLength:2000 }, { name:'notes', label:'장점, 조건, 상담 메모', type:'textarea', wide:true, maxLength:2000 }],
  guests:[{ name:'name', label:'성함', required:true, wide:true, maxLength:100 }, { name:'side', label:'초대 구분', type:'select', options:Object.entries(guestSides) }, { name:'group', label:'그룹', placeholder:'예: 가족, 직장 동료', maxLength:100 }, { name:'people', label:'참석 인원 (동반 포함)', type:'number', min:1, max:100 }, { name:'rsvp', label:'참석 여부', type:'select', options:Object.entries(rsvpLabels) }, { name:'table', label:'테이블 · 좌석', maxLength:100 }, { name:'contact', label:'연락처', type:'tel', maxLength:300 }, { name:'notes', label:'메모', type:'textarea', wide:true, maxLength:2000 }],
  timeline:[{ name:'time', label:'시간', type:'time', required:true }, { name:'title', label:'진행 내용', required:true, maxLength:300 }, { name:'owner', label:'담당자', wide:true, maxLength:100 }, { name:'notes', label:'전달할 사항', type:'textarea', wide:true, maxLength:2000 }],
  notes:[{ name:'title', label:'제목', required:true, wide:true, maxLength:300 }, { name:'category', label:'분류', wide:true, maxLength:100 }, { name:'content', label:'내용', type:'textarea', wide:true, required:true, maxLength:10000 }]
};
const defaults:Record<Collection, Record<string, unknown>> = { tasks:{ title:'', category:'', dueDate:'', status:'todo', notes:'' }, budgets:{ title:'', category:'', planned:0, actual:0, paid:0, notes:'' }, vendors:{ name:'', category:'', status:'researching', price:0, contact:'', url:'', notes:'' }, guests:{ name:'', side:'other', group:'', people:1, rsvp:'pending', table:'', contact:'', notes:'' }, timeline:{ time:'', title:'', owner:'', notes:'' }, notes:{ title:'', content:'', category:'' } };

function ItemEditor({ editor, current, onClose, onSave, busy }:{ editor:Editor; current:Item|null; onClose:() => void; onSave:(item:Item) => Promise<void>; busy:boolean }) {
  const [form, setForm] = useState(() => { const initial:Record<string, unknown> = { ...defaults[editor.collection], ...editor.item }; return { base:initial, values:initial }; });
  // When the partner's newer copy arrives (e.g. after a conflict), adopt it in every field this person has not edited.
  useEffect(() => {
    if (!editor.item || !current) return;
    setForm(({ base, values }) => { const latest = { ...current } as Record<string, unknown>; return { base:latest, values:Object.fromEntries(Object.keys({ ...values, ...latest }).map(key => [key, values[key] === base[key] ? latest[key] : values[key]])) }; });
  }, [current, editor.item]);
  const values = form.values;
  const deleted = !!editor.item && !current;
  const submit = async (event:FormEvent) => {
    event.preventDefault();
    const result:Record<string, unknown> = { ...values, id:editor.item?.id || uid() };
    for (const field of fields[editor.collection]) { if (field.type === 'number') result[field.name] = field.name === 'people' ? Math.max(1, Math.round(num(result[field.name]))) : num(result[field.name]); else if (typeof result[field.name] === 'string') result[field.name] = (result[field.name] as string).trim(); }
    await onSave(result as unknown as Item);
  };
  const set = (name:string, value:unknown) => setForm(f => ({ ...f, values:{ ...f.values, [name]:value } }));
  return <Modal title={`${collectionName[editor.collection]} ${editor.item ? '수정' : '추가'}`} onClose={onClose} busy={busy}>
    {deleted && <p className="form-note editor-note">함께 쓰는 분이 이 항목을 삭제했어요. 저장하면 다시 추가돼요.</p>}
    <form onSubmit={submit}>
      <div className="form-grid modal-body">{fields[editor.collection].map(field => <label className={`field ${field.wide ? 'wide' : ''}`} key={field.name}>
        <span>{field.label}{field.required && <i className="required" aria-hidden="true">*</i>}</span>
        {field.type === 'textarea' ? <textarea rows={field.name === 'content' ? 8 : 4} maxLength={field.maxLength} required={field.required} value={String(values[field.name] ?? '')} onChange={e => set(field.name, e.target.value)}/>
          : field.type === 'select' ? <select value={String(values[field.name] ?? '')} onChange={e => set(field.name, e.target.value)}>{field.options?.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          : <input type={field.type || 'text'} inputMode={field.type === 'number' ? 'numeric' : undefined} required={field.required} min={field.type === 'number' ? field.min ?? 0 : undefined} max={field.type === 'number' ? field.max ?? 1e12 : undefined} maxLength={field.maxLength} placeholder={field.placeholder} value={field.type === 'number' && !values[field.name] && field.name !== 'people' ? '' : String(values[field.name] ?? '')} onChange={e => set(field.name, e.target.value)}/>}
      </label>)}</div>
      <div className="modal-actions"><Button kind="secondary" onClick={onClose} disabled={busy}>취소</Button><Button type="submit" busy={busy}><Check size={16}/>저장하기</Button></div>
    </form>
  </Modal>;
}
