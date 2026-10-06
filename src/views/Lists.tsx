import { useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, Check, Circle, Clock3, Download, ExternalLink, Pencil, Phone, Plus, Printer, Search, Sparkles, Store, Trash2, Users } from 'lucide-react';
import { collectionName, guestSides, rsvpLabels, taskStatus, usePlanner, vendorStatus, type Item } from '../planner';
import { compactMoney, csv, dateLabel, fullDate, josa, money, safeUrl, sortTime, today } from '../lib/format';
import type { Budget, Collection, Guest, Note, Task, TimelineItem, Vendor } from '../types';
import { Badge, Button, Empty, IconButton, useIsMobile } from '../components/ui';

type Filters = { search:string; category:string; status:string };
function useFilters() { const [filters, setFilters] = useState<Filters>({ search:'', category:'all', status:'all' }); return { filters, set:(patch:Partial<Filters>) => setFilters(current => ({ ...current, ...patch })) }; }
const matches = (record:Record<string, unknown>, filters:Filters, statusKeys:string[] = ['status']) => {
  const term = filters.search.trim().toLowerCase();
  const text = !term || Object.values(record).some(v => typeof v === 'string' && v.toLowerCase().includes(term));
  const category = filters.category === 'all' || record.category === filters.category || record.group === filters.category;
  const status = filters.status === 'all' || statusKeys.some(key => record[key] === filters.status);
  return text && category && status;
};

function Toolbar({ collection, filters, set, categories, statuses, statusLabel = '모든 상태', onExport, extra }:{ collection:Collection; filters:Filters; set:(patch:Partial<Filters>) => void; categories?:string[]; statuses?:[string, string][]; statusLabel?:string; onExport?:() => void; extra?:ReactNode }) {
  const { openEditor, blocked } = usePlanner();
  return <div className="toolbar">
    <div className="toolbar-filters">
      <label className="search-field"><Search size={17}/><input type="search" aria-label="목록 검색" placeholder="검색" value={filters.search} onChange={e => set({ search:e.target.value })}/></label>
      {categories && categories.length > 0 && <select aria-label="분류 필터" value={filters.category} onChange={e => set({ category:e.target.value })}><option value="all">모든 분류</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>}
      {statuses && <select aria-label="상태 필터" value={filters.status} onChange={e => set({ status:e.target.value })}><option value="all">{statusLabel}</option>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
    </div>
    <div className="toolbar-actions">{extra}{onExport && <Button kind="secondary" size="small" onClick={onExport}><Download size={15}/>CSV</Button>}<Button size="small" onClick={() => openEditor(collection)} disabled={blocked}><Plus size={16}/>{collectionName[collection]} 추가</Button></div>
  </div>;
}
function RowActions({ collection, item }:{ collection:Collection; item:Item }) {
  const { openEditor, confirmRemove, blocked } = usePlanner();
  return <div className="row-actions"><IconButton label={`${collectionName[collection]} 수정`} disabled={blocked} onClick={() => openEditor(collection, item)}><Pencil size={16}/></IconButton><IconButton label={`${collectionName[collection]} 삭제`} disabled={blocked} onClick={() => confirmRemove(collection, item)}><Trash2 size={16}/></IconButton></div>;
}
function FilteredEmpty({ collection, filtered }:{ collection:Collection; filtered:boolean }) {
  const { openEditor, blocked } = usePlanner();
  return <Empty title={filtered ? '찾는 항목이 없어요' : `첫 ${josa(collectionName[collection], '을/를')} 추가해 보세요`} description={filtered ? '검색어나 필터를 바꿔 다시 확인해 주세요.' : '직접 추가하거나 AI 웨딩플래너에게 정리를 부탁해 보세요.'} action={!filtered && <Button onClick={() => openEditor(collection)} disabled={blocked}><Plus size={16}/>{collectionName[collection]} 추가</Button>}/>;
}
const categoriesOf = (rows:Record<string, unknown>[], key = 'category') => [...new Set(rows.map(r => String(r[key] || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
const isFiltered = (f:Filters) => !!f.search.trim() || f.category !== 'all' || f.status !== 'all';
const nextStatus:Record<Task['status'], Task['status']> = { todo:'doing', doing:'done', done:'todo' };

export function Tasks() {
  const { state, saveItem, blocked } = usePlanner(); const { filters, set } = useFilters();
  const now = today();
  const rows = useMemo(() => state.tasks.map((task, index) => ({ task, index })).filter(({ task }) => matches(task as unknown as Record<string, unknown>, filters))
    .sort((a, b) => Number(a.task.status === 'done') - Number(b.task.status === 'done') || (a.task.dueDate || '9999').localeCompare(b.task.dueDate || '9999') || a.index - b.index).map(r => r.task), [state.tasks, filters]);
  const overdue = state.tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < now).length;
  return <>
    <div className="summary-chips"><button type="button" className={filters.status === 'all' ? 'active' : ''} onClick={() => set({ status:'all' })}>전체<strong>{state.tasks.length}</strong></button>{(Object.keys(taskStatus) as Task['status'][]).map(key => <button type="button" key={key} className={filters.status === key ? 'active' : ''} onClick={() => set({ status:key })}>{taskStatus[key]}<strong>{state.tasks.filter(t => t.status === key).length}</strong></button>)}{overdue > 0 && <span className="chip-warning">기한 지남 {overdue}</span>}</div>
    <Toolbar collection="tasks" filters={filters} set={set} categories={categoriesOf(state.tasks as unknown as Record<string, unknown>[])} statuses={Object.entries(taskStatus)}/>
    <section className="card list-card">{rows.length ? <ul className="task-list">{rows.map(task => {
      const late = task.status !== 'done' && !!task.dueDate && task.dueDate < now;
      return <li key={task.id} className={`task-row ${task.status === 'done' ? 'done' : ''}`}>
        <button type="button" className={`check-button ${task.status === 'done' ? 'checked' : ''}`} aria-label={`${task.title} ${task.status === 'done' ? '완료 취소' : '완료로 표시'}`} disabled={blocked} onClick={() => void saveItem('tasks', { ...task, status:task.status === 'done' ? 'todo' : 'done' }, task.status === 'done' ? '다시 할 일로 옮겼어요.' : '완료했어요. 잘하고 있어요!')}>{task.status === 'done' ? <Check size={16} strokeWidth={3}/> : <Circle size={22}/>}</button>
        <div className="task-main"><strong>{task.title}</strong>{task.notes && <p>{task.notes}</p>}<div className="task-meta"><Badge>{task.category || '미분류'}</Badge>{task.dueDate && <span className={late ? 'late' : ''}><CalendarDays size={13}/>{dateLabel(task.dueDate)}{late && ' · 기한 지남'}</span>}</div></div>
        <button type="button" className={`status-pill ${task.status}`} disabled={blocked} title="눌러서 상태 바꾸기" onClick={() => void saveItem('tasks', { ...task, status:nextStatus[task.status] }, '상태를 바꿨어요.')}>{taskStatus[task.status]}</button>
        <RowActions collection="tasks" item={task}/>
      </li>;
    })}</ul> : <FilteredEmpty collection="tasks" filtered={isFiltered(filters)}/>}</section>
  </>;
}

function Outstanding({ budget }:{ budget:Budget }) {
  if (!budget.actual) return <span className="muted">—</span>;
  return budget.paid >= budget.actual ? <Badge tone="mint">지급 완료</Badge> : <Badge tone="gold">{money(budget.actual - budget.paid)}</Badge>;
}
export function Budgets() {
  const { state, navigate } = usePlanner(); const { filters, set } = useFilters(); const mobile = useIsMobile();
  const planned = state.budgets.reduce((s, b) => s + b.planned, 0); const actual = state.budgets.reduce((s, b) => s + b.actual, 0); const paid = state.budgets.reduce((s, b) => s + b.paid, 0);
  const target = state.settings.totalBudget; const remaining = target - actual;
  const rows = state.budgets.filter(b => matches(b as unknown as Record<string, unknown>, filters));
  const exportCsv = () => csv('웨딩-예산.csv', ['항목', '분류', '예정 금액', '확정 금액', '지급 금액', '메모'], state.budgets.map(b => [b.title, b.category, b.planned, b.actual, b.paid, b.notes]));
  return <>
    <div className="stats-grid four">
      <div className="stat-card static"><span className="stat-text"><span>예정 금액</span><strong>{compactMoney(planned)}</strong><small>{state.budgets.length}개 항목</small></span></div>
      <div className="stat-card static"><span className="stat-text"><span>확정 금액</span><strong>{compactMoney(actual)}</strong><small>{target ? `목표 ${compactMoney(target)}` : '목표 예산 미설정'}</small></span></div>
      <div className="stat-card static"><span className="stat-text"><span>지급 완료</span><strong>{compactMoney(paid)}</strong><small>남은 지급 {compactMoney(Math.max(0, actual - paid))}</small></span></div>
      <div className={`stat-card static ${remaining < 0 ? 'warn' : ''}`}><span className="stat-text"><span>{remaining < 0 ? '목표 초과' : '남은 예산'}</span><strong>{target ? compactMoney(Math.abs(remaining)) : '—'}</strong><small>{target ? '확정 금액 기준' : <button type="button" className="inline-link" onClick={() => navigate('settings')}>목표 예산 설정하기</button>}</small></span></div>
    </div>
    {target > 0 && <div className="card budget-bar"><div><strong>목표 예산 사용</strong><span>{Math.round(actual / target * 100)}%</span></div><div className="bar"><i style={{ width:`${Math.min(100, actual / target * 100)}%` }} className={remaining < 0 ? 'over' : ''}/></div></div>}
    <Toolbar collection="budgets" filters={filters} set={set} categories={categoriesOf(state.budgets as unknown as Record<string, unknown>[])} onExport={exportCsv}/>
    <section className="card list-card">{!rows.length ? <FilteredEmpty collection="budgets" filtered={isFiltered(filters)}/> : mobile ? <ul className="card-rows">{rows.map(b => <li key={b.id}>
      <div className="card-row-head"><div><strong>{b.title}</strong><small>{b.category || '미분류'}</small></div><RowActions collection="budgets" item={b}/></div>
      <dl className="money-grid"><div><dt>예정</dt><dd>{b.planned ? money(b.planned) : '미입력'}</dd></div><div><dt>확정</dt><dd className="strong">{b.actual ? money(b.actual) : '미입력'}</dd></div><div><dt>지급</dt><dd>{money(b.paid)}</dd></div><div><dt>남은 지급</dt><dd><Outstanding budget={b}/></dd></div></dl>
      {b.notes && <p className="row-note">{b.notes}</p>}
    </li>)}</ul> : <div className="table-scroll"><table><thead><tr><th>항목</th><th>예정 금액</th><th>확정 금액</th><th>지급 금액</th><th>남은 지급</th><th><span className="sr-only">작업</span></th></tr></thead><tbody>{rows.map(b => <tr key={b.id}>
      <td><strong>{b.title}</strong><small>{b.category || '미분류'}</small>{b.notes && <p className="cell-note">{b.notes}</p>}</td>
      <td>{b.planned ? money(b.planned) : <span className="muted">미입력</span>}</td><td className="strong">{b.actual ? money(b.actual) : <span className="muted">미입력</span>}</td><td>{money(b.paid)}</td>
      <td><Outstanding budget={b}/></td><td><RowActions collection="budgets" item={b}/></td>
    </tr>)}</tbody></table></div>}</section>
  </>;
}

export function Vendors() {
  const { state, ask, blocked } = usePlanner(); const { filters, set } = useFilters();
  const rows = state.vendors.filter(v => matches(v as unknown as Record<string, unknown>, filters));
  const tone = (s:Vendor['status']) => s === 'booked' ? 'mint' : s === 'contacted' ? 'gold' : 'neutral';
  return <>
    <div className="summary-chips"><span>전체<strong>{state.vendors.length}</strong></span><span>상담 완료<strong>{state.vendors.filter(v => v.status === 'contacted').length}</strong></span><span>계약 완료<strong>{state.vendors.filter(v => v.status === 'booked').length}</strong></span></div>
    <Toolbar collection="vendors" filters={filters} set={set} categories={categoriesOf(state.vendors as unknown as Record<string, unknown>[])} statuses={Object.entries(vendorStatus)} extra={state.vendors.length > 1 && <Button kind="secondary" size="small" disabled={blocked} onClick={() => ask('등록된 업체들의 견적, 조건, 상담 메모를 비교해 주고 추가로 확인할 질문을 정리해 줘.')}><Sparkles size={15}/>AI 비교</Button>}/>
    {rows.length ? <div className="tile-grid">{rows.map(v => <article className="tile vendor-tile" key={v.id}>
      <div className="tile-top"><span className="tile-icon"><Store size={20}/></span><Badge tone={tone(v.status)}>{vendorStatus[v.status]}</Badge></div>
      <small className="tile-category">{v.category || '미분류'}</small><h3>{v.name}</h3>
      <div className="vendor-price"><span>견적</span><strong>{v.price ? money(v.price) : '확인 전'}</strong></div>
      {v.contact && <p className="vendor-contact"><Phone size={13}/>{v.contact}</p>}
      <p className="tile-note">{v.notes || '상담 내용과 조건을 메모해 두세요.'}</p>
      <div className="tile-footer">{safeUrl(v.url) ? <a className="text-link" href={safeUrl(v.url)} target="_blank" rel="noopener noreferrer">홈페이지<ExternalLink size={13}/></a> : <span/>}<RowActions collection="vendors" item={v}/></div>
    </article>)}</div> : <section className="card"><FilteredEmpty collection="vendors" filtered={isFiltered(filters)}/></section>}
  </>;
}

const nextRsvp:Record<Guest['rsvp'], Guest['rsvp']> = { pending:'yes', yes:'no', no:'pending' };
export function Guests() {
  const { state, saveItem, blocked } = usePlanner(); const { filters, set } = useFilters(); const mobile = useIsMobile();
  const count = (list:Guest[]) => list.reduce((s, g) => s + g.people, 0);
  const rows = state.guests.filter(g => matches(g as unknown as Record<string, unknown>, filters, ['rsvp', 'side']));
  const exportCsv = () => csv('웨딩-하객명단.csv', ['성함', '초대 구분', '그룹', '인원', '참석 여부', '테이블', '연락처', '메모'], state.guests.map(g => [g.name, guestSides[g.side], g.group, g.people, rsvpLabels[g.rsvp], g.table, g.contact, g.notes]));
  const rsvpButton = (g:Guest) => <button type="button" className={`status-pill rsvp-${g.rsvp}`} disabled={blocked} title="눌러서 참석 여부 바꾸기" onClick={() => void saveItem('guests', { ...g, rsvp:nextRsvp[g.rsvp] }, '참석 여부를 바꿨어요.')}>{rsvpLabels[g.rsvp]}</button>;
  return <>
    <div className="stats-grid four">
      <div className="stat-card static"><span className="stat-icon lilac"><Users size={19}/></span><span className="stat-text"><span>전체 초대</span><strong>{count(state.guests)}<em>명</em></strong><small>{state.settings.guestTarget ? `목표 ${state.settings.guestTarget}명` : `${state.guests.length}개 연락처`}</small></span></div>
      <div className="stat-card static"><span className="stat-icon mint"><Check size={19}/></span><span className="stat-text"><span>참석</span><strong>{count(state.guests.filter(g => g.rsvp === 'yes'))}<em>명</em></strong><small>동반 인원 포함</small></span></div>
      <div className="stat-card static"><span className="stat-icon gold"><Clock3 size={19}/></span><span className="stat-text"><span>확인 전</span><strong>{count(state.guests.filter(g => g.rsvp === 'pending'))}<em>명</em></strong><small>참석 여부를 확인해 주세요</small></span></div>
      <div className="stat-card static"><span className="stat-icon rose"><Users size={19}/></span><span className="stat-text"><span>신랑측 · 신부측</span><strong>{count(state.guests.filter(g => g.side === 'groom'))}<em>·</em>{count(state.guests.filter(g => g.side === 'bride'))}</strong><small>공통 {count(state.guests.filter(g => g.side === 'other'))}명</small></span></div>
    </div>
    <Toolbar collection="guests" filters={filters} set={set} categories={categoriesOf(state.guests as unknown as Record<string, unknown>[], 'group')} statuses={[...Object.entries(rsvpLabels), ...Object.entries(guestSides)]} statusLabel="모든 하객" onExport={exportCsv}/>
    <section className="card list-card">{!rows.length ? <FilteredEmpty collection="guests" filtered={isFiltered(filters)}/> : mobile ? <ul className="card-rows">{rows.map(g => <li key={g.id}>
      <div className="card-row-head"><div><strong>{g.name}</strong><small>{guestSides[g.side]}{g.group && ` · ${g.group}`} · {g.people}명</small></div>{rsvpButton(g)}</div>
      <div className="card-row-foot"><span>{g.table ? `테이블 ${g.table}` : '테이블 미정'}{g.contact && ` · ${g.contact}`}</span><RowActions collection="guests" item={g}/></div>
      {g.notes && <p className="row-note">{g.notes}</p>}
    </li>)}</ul> : <div className="table-scroll"><table><thead><tr><th>성함</th><th>구분</th><th>그룹</th><th>인원</th><th>참석 여부</th><th>테이블</th><th>연락처</th><th><span className="sr-only">작업</span></th></tr></thead><tbody>{rows.map(g => <tr key={g.id}>
      <td><strong>{g.name}</strong>{g.notes && <p className="cell-note">{g.notes}</p>}</td><td>{guestSides[g.side]}</td><td>{g.group || <span className="muted">—</span>}</td><td>{g.people}명</td>
      <td>{rsvpButton(g)}<span className="sr-only">{rsvpLabels[g.rsvp]}</span></td><td>{g.table || <span className="muted">미정</span>}</td><td>{g.contact || <span className="muted">—</span>}</td><td><RowActions collection="guests" item={g}/></td>
    </tr>)}</tbody></table></div>}</section>
  </>;
}

export function Timeline() {
  const { state, openEditor, blocked } = usePlanner();
  const rows = [...state.timeline].sort((a, b) => sortTime(a.time).localeCompare(sortTime(b.time)));
  return <>
    <div className="card timeline-head"><div><span className="tile-icon"><CalendarDays size={20}/></span><span><strong>{state.settings.coupleNames || '우리의 결혼식'}</strong><small>{state.settings.weddingDate ? fullDate(state.settings.weddingDate) : '날짜 미정'}{state.settings.venue && ` · ${state.settings.venue}`}</small></span></div><div className="toolbar-actions"><Button kind="secondary" size="small" onClick={() => window.print()}><Printer size={15}/>인쇄 · PDF</Button><Button size="small" onClick={() => openEditor('timeline')} disabled={blocked}><Plus size={16}/>일정 추가</Button></div></div>
    {rows.length ? <section className="card timeline-card"><ol className="timeline">{rows.map((t:TimelineItem) => <li key={t.id}>
      <time>{sortTime(t.time)}</time><span className="timeline-dot" aria-hidden="true"/>
      <div className="timeline-body"><h3>{t.title}</h3>{t.owner && <span className="timeline-owner"><Users size={13}/>{t.owner}</span>}{t.notes && <p>{t.notes}</p>}</div>
      <RowActions collection="timeline" item={t}/>
    </li>)}</ol></section> : <section className="card"><Empty icon={Clock3} title="본식 타임라인을 만들어 보세요" description="메이크업부터 폐백, 피로연까지 시간 순서대로 정리해 두면 당일이 훨씬 편해요." action={<Button onClick={() => openEditor('timeline')} disabled={blocked}><Plus size={16}/>일정 추가</Button>}/></section>}
    <p className="page-footnote"><Printer size={14}/>인쇄 · PDF로 저장해 도우미, 사회자와 공유할 수 있어요.</p>
  </>;
}

export function Notes() {
  const { state } = usePlanner(); const { filters, set } = useFilters();
  const rows = state.notes.filter((n:Note) => matches(n as unknown as Record<string, unknown>, filters));
  return <>
    <Toolbar collection="notes" filters={filters} set={set} categories={categoriesOf(state.notes as unknown as Record<string, unknown>[])}/>
    {rows.length ? <div className="tile-grid notes">{rows.map(note => <article className="tile note-tile" key={note.id}><div className="tile-top"><Badge tone="lilac">{note.category || '우리의 생각'}</Badge><RowActions collection="notes" item={note}/></div><h3>{note.title}</h3><p>{note.content}</p></article>)}</div> : <section className="card"><FilteredEmpty collection="notes" filtered={isFiltered(filters)}/></section>}
  </>;
}

export const listViews = { tasks:Tasks, budgets:Budgets, vendors:Vendors, guests:Guests, timeline:Timeline, notes:Notes };
