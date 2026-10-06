import { ArrowRight, CalendarDays, Circle, Gem, MapPin, Sparkles, SquareCheck, UserPlus, Users, Wallet } from 'lucide-react';
import { usePlanner, taskStatus } from '../planner';
import { ago, compactMoney, dateLabel, dday, fullDate, money, sideLabel, today } from '../lib/format';
import { Avatar, Badge, Button, Empty, ProgressRing } from '../components/ui';

export function Dashboard() {
  const { state, data, navigate, ask, saveItem, blocked, openEditor } = usePlanner();
  const { settings } = state;
  const complete = state.tasks.filter(t => t.status === 'done').length;
  const doing = state.tasks.filter(t => t.status === 'doing').length;
  const progress = state.tasks.length ? Math.round(complete / state.tasks.length * 100) : 0;
  const actual = state.budgets.reduce((sum, b) => sum + b.actual, 0);
  const paid = state.budgets.reduce((sum, b) => sum + b.paid, 0);
  const guests = { yes:state.guests.filter(g => g.rsvp === 'yes').reduce((s, g) => s + g.people, 0), all:state.guests.reduce((s, g) => s + g.people, 0) };
  const upcoming = state.tasks.filter(t => t.status !== 'done').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')).slice(0, 5);
  const countdown = dday(settings.weddingDate);
  const members = data.workspace.members;
  const budgetUse = settings.totalBudget ? Math.min(100, Math.round(actual / settings.totalBudget * 100)) : 0;
  return <>
    <div className="dashboard-grid">
      <section className="hero-card">
        <div className="hero-glow" aria-hidden="true"/>
        <span className="hero-eyebrow">함께 기다리는 우리의 날</span>
        <div className="dday-number">{countdown.label}</div>
        <h2>{settings.coupleNames || members.map(m => m.name).join(' ♥ ') || '우리의 결혼식'}</h2>
        <p><CalendarDays size={16}/>{settings.weddingDate ? fullDate(settings.weddingDate) : '날짜를 정하면 카운트다운이 시작돼요'}</p>
        {settings.venue && <p><MapPin size={16}/>{settings.venue}</p>}
        <div className="hero-footer">
          <div className="hero-members">{members.map(m => <Avatar key={m.username} name={m.name} side={m.side}/>)}{members.length < data.workspace.maxMembers && <button type="button" className="avatar add" onClick={() => navigate('settings')} aria-label="함께 쓸 사람 초대하기"><UserPlus size={16}/></button>}</div>
          <button type="button" className="hero-link" onClick={() => navigate('settings')}>웨딩 정보 수정<ArrowRight size={15}/></button>
        </div>
      </section>
      <section className="card progress-card">
        <div className="section-title"><h2>준비는 이만큼</h2><button type="button" className="text-link" onClick={() => navigate('tasks')}>체크리스트<ArrowRight size={14}/></button></div>
        <div className="progress-body">
          <div className="ring-wrap"><ProgressRing value={progress}/><div className="ring-label"><strong>{progress}<small>%</small></strong><span>{complete}/{state.tasks.length}</span></div></div>
          <ul className="progress-legend">
            <li><i className="dot mint"/>완료<strong>{complete}</strong></li>
            <li><i className="dot gold"/>진행 중<strong>{doing}</strong></li>
            <li><i className="dot muted"/>예정<strong>{state.tasks.length - complete - doing}</strong></li>
          </ul>
        </div>
      </section>
    </div>
    <div className="stats-grid">
      <button type="button" className="stat-card" onClick={() => navigate('budgets')}><span className="stat-icon rose"><Wallet size={20}/></span><span className="stat-text"><span>목표 예산</span><strong>{settings.totalBudget ? compactMoney(settings.totalBudget) : '미설정'}</strong><small>{settings.totalBudget ? `확정 지출 ${budgetUse}% 사용` : '설정에서 입력해 주세요'}</small></span>{settings.totalBudget > 0 && <span className="mini-bar"><i style={{ width:`${budgetUse}%` }}/></span>}</button>
      <button type="button" className="stat-card" onClick={() => navigate('budgets')}><span className="stat-icon gold"><Gem size={20}/></span><span className="stat-text"><span>확정 지출</span><strong>{compactMoney(actual)}</strong><small>지급 완료 {money(paid)}</small></span></button>
      <button type="button" className="stat-card" onClick={() => navigate('guests')}><span className="stat-icon lilac"><Users size={20}/></span><span className="stat-text"><span>참석 확정 하객</span><strong>{guests.yes}<em>명</em></strong><small>초대 {guests.all}명{settings.guestTarget ? ` · 목표 ${settings.guestTarget}명` : ''}</small></span></button>
    </div>
    <div className="dashboard-bottom">
      <section className="card upcoming-card">
        <div className="section-title"><h2>곧 챙길 일 <Badge tone="rose">{upcoming.length}</Badge></h2><button type="button" className="text-link" onClick={() => navigate('tasks')}>전체 보기<ArrowRight size={14}/></button></div>
        {upcoming.length ? <ul className="upcoming-list">{upcoming.map(task => {
          const overdue = !!task.dueDate && task.dueDate < today();
          return <li key={task.id}>
            <button type="button" className="check-button" aria-label={`${task.title} 완료로 표시`} disabled={blocked} onClick={() => void saveItem('tasks', { ...task, status:'done' }, '완료로 표시했어요.')}><Circle size={22}/></button>
            <div><strong>{task.title}</strong><span>{task.category || '미분류'}{task.dueDate && ` · ${dateLabel(task.dueDate)}`}</span></div>
            <Badge tone={overdue ? 'danger' : task.status === 'doing' ? 'gold' : 'neutral'}>{overdue ? '기한 지남' : taskStatus[task.status]}</Badge>
          </li>;
        })}</ul> : <Empty icon={SquareCheck} title="모든 준비를 마쳤어요" description="새로운 할 일이 생기면 추가해 보세요." action={<Button kind="secondary" onClick={() => openEditor('tasks')}>할 일 추가</Button>}/>}
      </section>
      <section className="planner-card">
        <span className="planner-icon"><Sparkles size={22}/></span>
        <span className="eyebrow">AI WEDDING PLANNER</span>
        <h2>막막할 땐, 함께 정리해요.</h2>
        <p>{data.privateLibrary ? '보관함 자료와 지금의 준비 상황을 살펴보고' : '지금의 준비 상황을 살펴보고'} 우리에게 맞는 다음 단계를 제안해요.</p>
        <button type="button" onClick={() => ask('우리의 현재 준비 상황을 살펴보고, 지금 가장 먼저 해야 할 일들을 정리해 줘.')}><span>지금 필요한 준비는?</span><ArrowRight size={16}/></button>
        <button type="button" onClick={() => ask('우리의 예산과 업체 정보를 검토하고, 비교할 항목과 비용을 줄일 방법을 알려 줘.')}><span>예산을 함께 살펴봐요</span><ArrowRight size={16}/></button>
        {settings.weddingDate && <button type="button" onClick={() => ask('예식일 기준으로 날짜가 없는 준비 할 일들의 권장 마감일을 잡아 줘.')}><span>준비 일정 자동으로 잡기</span><ArrowRight size={16}/></button>}
      </section>
    </div>
    {state.activity.length > 0 && <section className="card activity-card">
      <div className="section-title"><h2>최근 기록</h2></div>
      <ul className="activity-list">{state.activity.slice(0, 6).map(a => <li key={a.id}>{a.by ? <Avatar name={a.by} size="small" side={members.find(m => m.name === a.by)?.side}/> : <span className="avatar small system" aria-hidden="true">✓</span>}<span className="activity-text"><strong>{a.by || '웨딩 노트'}</strong>{a.text}</span><time dateTime={a.at}>{ago(a.at)}</time></li>)}</ul>
    </section>}
    {members.length < data.workspace.maxMembers && <section className="invite-banner glass">
      <span className="invite-banner-icon"><UserPlus size={20}/></span>
      <div><strong>{sideLabel[data.user.side === 'bride' ? 'groom' : 'bride']}님과 함께 쓰면 더 쉬워요</strong><p>초대 링크를 보내면 같은 노트를 함께 보고 고칠 수 있어요.</p></div>
      <Button kind="secondary" size="small" onClick={() => navigate('settings')}>초대하기<ArrowRight size={15}/></Button>
    </section>}
  </>;
}
