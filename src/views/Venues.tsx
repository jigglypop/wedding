import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Building2, CalendarDays, Check, Download, ExternalLink, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { usePlanner, vendorStatus, type Item } from '../planner';
import type { Venue, VenueAnswer, VenueChecklistField, VenueHall } from '../types';
import { csv, dateLabel, safeUrl, uid } from '../lib/format';
import { normalizeVenue, venueFieldScope } from '../lib/venue-checklist';
import { Badge, Button, Empty, IconButton, Modal, Segmented } from '../components/ui';

const emptyAnswer = ():VenueAnswer => ({ value:'', checked:false, rating:'' });
const isRecorded = (answer?:VenueAnswer) => !!answer && (!!answer.value.trim() || answer.checked || !!answer.rating);
const blankHall = (name = '홀 1'):VenueHall => ({ id:uid(), name, answers:{} });
const blankVenue = ():Venue => ({ id:uid(), name:'', status:'researching', visitDate:'', contact:'', url:'', notes:'', answers:{}, halls:[blankHall()] });
const hallCategory = (field:VenueChecklistField) => field.id === 'compare-r54' ? '비용' : field.category;
const answerValues = (venue:Venue) => [...Object.values(venue.answers), ...venue.halls.flatMap(hall => Object.values(hall.answers))].map(answer => answer.value);

export function Venues() {
  const { state, data, openEditor, confirmRemove, blocked } = usePlanner();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all');
  const fields = data.venueChecklist.fields;
  const rows = state.venues.filter(venue => (status === 'all' || venue.status === status) && [venue.name, venue.contact, venue.notes, ...venue.halls.map(hall => hall.name), ...answerValues(venue)].some(value => value.toLowerCase().includes(search.trim().toLowerCase())));
  const exportCsv = () => csv('웨딩홀-투어-기록.csv', ['웨딩홀', '홀', '상태', '방문일', '분류', '항목', '확인', '만족도', '기록'], state.venues.flatMap(venue => fields.flatMap(field => {
    const targets = venueFieldScope(field) === 'hall' ? venue.halls : [{ name:'공통', answers:venue.answers }];
    return targets.map(target => { const answer = target.answers[field.id]; return [venue.name, target.name, vendorStatus[venue.status], venue.visitDate, venueFieldScope(field) === 'hall' ? hallCategory(field) : field.category, field.label, answer?.checked ? '확인' : '', answer?.rating || '', answer?.value || '']; });
  })));
  return <>
    <div className="summary-chips"><span>전체<strong>{state.venues.length}</strong></span><span>상담 완료<strong>{state.venues.filter(v => v.status === 'contacted').length}</strong></span><span>계약 완료<strong>{state.venues.filter(v => v.status === 'booked').length}</strong></span></div>
    <div className="toolbar">
      <div className="toolbar-filters"><label className="search-field"><Search size={17}/><input type="search" aria-label="웨딩홀 검색" placeholder="웨딩홀 · 기록 검색" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="웨딩홀 상태 필터" value={status} onChange={e => setStatus(e.target.value)}><option value="all">모든 상태</option>{Object.entries(vendorStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="toolbar-actions"><Button kind="secondary" size="small" disabled={!state.venues.length} onClick={exportCsv}><Download size={15}/>CSV</Button><Button size="small" disabled={blocked} onClick={() => openEditor('venues')}><Plus size={16}/>웨딩홀 추가</Button></div>
    </div>
    {data.venueChecklist.sourceName && <p className="venue-source">체크리스트 원본: {data.venueChecklist.sourceName}</p>}
    {rows.length ? <div className="tile-grid">{rows.map(venue => {
      const hallFields = fields.filter(field => venueFieldScope(field) === 'hall'); const common = fields.filter(field => venueFieldScope(field) === 'venue');
      const recorded = common.filter(field => isRecorded(venue.answers[field.id])).length + venue.halls.reduce((total, hall) => total + hallFields.filter(field => isRecorded(hall.answers[field.id])).length, 0);
      const total = common.length + hallFields.length * venue.halls.length;
      return <article className="tile venue-tile" key={venue.id}>
        <div className="tile-top"><span className="tile-icon"><Building2 size={20}/></span><Badge tone={venue.status === 'booked' ? 'mint' : venue.status === 'contacted' ? 'gold' : 'neutral'}>{vendorStatus[venue.status]}</Badge></div>
        <h3>{venue.name}</h3>
        {venue.visitDate && <p className="vendor-contact"><CalendarDays size={14}/>{dateLabel(venue.visitDate)} 방문</p>}
        <div className="venue-progress"><span>홀 {venue.halls.length}개</span><span>기록 {recorded}/{total}</span></div>
        <p className="venue-hall-names">{venue.halls.map(hall => hall.name).join(' · ')}</p>
        {venue.notes && <p className="tile-note">{venue.notes}</p>}
        <Button kind="secondary" size="small" className="venue-record" disabled={blocked} onClick={() => openEditor('venues', venue)}><Pencil size={14}/>체크리스트 기록</Button>
        <div className="tile-footer">{safeUrl(venue.url) ? <a className="text-link" href={safeUrl(venue.url)} target="_blank" rel="noopener noreferrer">홈페이지<ExternalLink size={13}/></a> : <span/>}<IconButton label={`${venue.name} 삭제`} disabled={blocked} onClick={() => confirmRemove('venues', venue)}><Trash2 size={16}/></IconButton></div>
      </article>;
    })}</div> : <section className="card"><Empty icon={Building2} title={search || status !== 'all' ? '찾는 웨딩홀이 없어요' : '웨딩홀을 추가해 주세요'} description={search || status !== 'all' ? '검색어나 상태 필터를 바꿔 주세요.' : '추가한 홀마다 같은 체크리스트를 따로 기록할 수 있어요.'} action={!search && status === 'all' && <Button disabled={blocked} onClick={() => openEditor('venues')}><Plus size={16}/>웨딩홀 추가</Button>}/></section>}
  </>;
}

function mergeAnswers(base:Venue['answers'], edited:Venue['answers'], latest:Venue['answers']) {
  const next = { ...latest };
  for (const key of new Set([...Object.keys(base), ...Object.keys(edited), ...Object.keys(latest)])) {
    const before = base[key] || emptyAnswer(); const local = edited[key] || emptyAnswer(); const remote = latest[key] || emptyAnswer();
    const answer = { ...remote };
    for (const part of ['value', 'checked', 'rating'] as const) if (local[part] !== before[part]) Object.assign(answer, { [part]:local[part] });
    if (isRecorded(answer)) next[key] = answer; else delete next[key];
  }
  return next;
}

// Keep local edits and new halls, while adopting a partner's untouched changes after a conflict.
function mergeVenue(base:Venue, edited:Venue, latest:Venue):Venue {
  const next = { ...latest, answers:mergeAnswers(base.answers, edited.answers, latest.answers), halls:[...latest.halls] };
  for (const key of ['name', 'status', 'visitDate', 'contact', 'url', 'notes'] as const) if (edited[key] !== base[key]) Object.assign(next, { [key]:edited[key] });
  const removed = new Set(base.halls.filter(hall => !edited.halls.some(local => local.id === hall.id)).map(hall => hall.id));
  next.halls = next.halls.filter(hall => !removed.has(hall.id));
  for (const local of edited.halls) {
    const before = base.halls.find(hall => hall.id === local.id); const remote = next.halls.find(hall => hall.id === local.id);
    if (!before || !remote) { if (!before && !remote) next.halls.push(local); continue; }
    next.halls = next.halls.map(hall => hall.id === local.id ? { ...remote, name:local.name === before.name ? remote.name : local.name, answers:mergeAnswers(before.answers, local.answers, remote.answers) } : hall);
  }
  if (!next.halls.length) next.halls = latest.halls;
  return next;
}

export function VenueEditor({ item, current, busy, onClose, onSave }:{ item?:Item; current:Item|null; busy:boolean; onClose:() => void; onSave:(item:Venue) => Promise<void> }) {
  const { data, fail } = usePlanner();
  const fields = data.venueChecklist.fields;
  const [form, setForm] = useState(() => { const initial = item ? normalizeVenue(structuredClone(item as Venue), fields) : blankVenue(); return { base:initial, values:initial }; });
  const formRef = useRef(form); formRef.current = form;
  const [deletedLocalHalls, setDeletedLocalHalls] = useState<VenueHall[]>([]);
  const [hallId, setHallId] = useState(form.values.halls[0].id);
  const [removeHallId, setRemoveHallId] = useState<string|null>(null);
  const [tab, setTab] = useState<'comparison'|'onsite'>('comparison');
  const [fieldSearch, setFieldSearch] = useState('');
  useEffect(() => {
    if (!item || !current) return;
    const latest = normalizeVenue(current as Venue, fields);
    const { base, values } = formRef.current;
    const deleted = values.halls.filter(local => { const before = base.halls.find(hall => hall.id === local.id); return before && !latest.halls.some(hall => hall.id === local.id) && JSON.stringify(local) !== JSON.stringify(before); });
    if (deleted.length) setDeletedLocalHalls(previous => [...previous, ...deleted.filter(hall => !previous.some(saved => saved.id === hall.id))]);
    setForm({ base:latest, values:mergeVenue(base, values, latest) });
  }, [item, current, fields]);
  const venue = form.values;
  const selectedHall = venue.halls.find(hall => hall.id === hallId) || venue.halls[0];
  const shown = useMemo(() => fields.filter(field => field.kind === tab && `${field.category} ${hallCategory(field)} ${field.label} ${field.question || ''}`.toLowerCase().includes(fieldSearch.trim().toLowerCase())), [fields, tab, fieldSearch]);
  const hallFields = shown.filter(field => venueFieldScope(field) === 'hall'); const commonFields = shown.filter(field => venueFieldScope(field) === 'venue');
  const set = <K extends keyof Venue>(key:K, value:Venue[K]) => setForm(f => ({ ...f, values:{ ...f.values, [key]:value } }));
  const setAnswer = (id:string, patch:Partial<VenueAnswer>, target?:string) => setForm(f => {
    const update = (answers:Venue['answers']) => ({ ...answers, [id]:{ ...(answers[id] || emptyAnswer()), ...patch } });
    return { ...f, values:target ? { ...f.values, halls:f.values.halls.map(hall => hall.id === target ? { ...hall, answers:update(hall.answers) } : hall) } : { ...f.values, answers:update(f.values.answers) } };
  });
  const addHall = () => { const hall = blankHall(`홀 ${venue.halls.length + 1}`); set('halls', [...venue.halls, hall]); setHallId(hall.id); setRemoveHallId(null); };
  const cleanAnswers = (answers:Venue['answers']) => Object.fromEntries(Object.entries(answers).filter(([, answer]) => isRecorded(answer)));
  const submit = async (event:FormEvent) => {
    event.preventDefault();
    if (deletedLocalHalls.length) { fail('삭제된 홀의 입력을 보관하거나 취소한 뒤 저장해 주세요.'); return; }
    await onSave({ ...venue, name:venue.name.trim(), contact:venue.contact.trim(), url:venue.url.trim(), notes:venue.notes.trim(), answers:cleanAnswers(venue.answers), halls:venue.halls.map(hall => ({ ...hall, name:hall.name.trim(), answers:cleanAnswers(hall.answers) })) });
  };
  return <Modal title={item ? `${venue.name} · 체크리스트` : '웨딩홀 추가'} onClose={onClose} busy={busy} wide>
    {item && !current && <p className="form-note editor-note">함께 쓰는 분이 이 웨딩홀을 삭제했어요. 저장하면 다시 추가돼요.</p>}
    <form onSubmit={submit}>
      <fieldset className="venue-form-fields" disabled={busy}>
        <div className="form-grid modal-body">
          <label className="field wide"><span>웨딩홀 이름<i className="required" aria-hidden="true">*</i></span><input required maxLength={300} value={venue.name} onChange={e => set('name', e.target.value)} placeholder="웨딩홀 이름"/></label>
          <label className="field"><span>상담 · 계약 상태</span><select value={venue.status} onChange={e => set('status', e.target.value as Venue['status'])}>{Object.entries(vendorStatus).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="field"><span>방문일</span><input type="date" value={venue.visitDate} onChange={e => set('visitDate', e.target.value)}/></label>
          <label className="field"><span>연락처</span><input type="tel" maxLength={300} value={venue.contact} onChange={e => set('contact', e.target.value)}/></label>
          <label className="field"><span>홈페이지 주소</span><input type="url" maxLength={2000} placeholder="https://" value={venue.url} onChange={e => set('url', e.target.value)}/></label>
          <label className="field wide"><span>전체 메모</span><textarea rows={2} maxLength={2000} value={venue.notes} onChange={e => set('notes', e.target.value)}/></label>
        </div>
        <div className="venue-checklist">
          <div className="venue-checklist-heading"><h3>투어 체크리스트</h3><span>홀 {venue.halls.length}개</span></div>
          <Segmented label="체크리스트 종류" value={tab} onChange={value => { setTab(value); setFieldSearch(''); }} options={['comparison', 'onsite'].map(kind => [kind as typeof tab, kind === 'comparison' ? '비교 기록' : '현장 체크', fields.filter(field => field.kind === kind).length])}/>
          <label className="search-field venue-field-search"><Search size={16}/><input type="search" aria-label="체크리스트 항목 검색" placeholder="항목 검색" value={fieldSearch} onChange={e => setFieldSearch(e.target.value)}/></label>
          {deletedLocalHalls.map(hall => <div className="venue-hall-removal" key={hall.id}><p>함께 쓰는 분이 ‘{hall.name}’ 홀을 삭제했어요. 아직 저장하지 않은 입력을 보관할까요?</p><div className="button-row"><Button kind="secondary" size="small" onClick={() => setDeletedLocalHalls(current => current.filter(saved => saved.id !== hall.id))}>이 입력 취소</Button><Button size="small" disabled={venue.halls.length >= 20} onClick={() => { const restored = { ...hall, id:uid() }; set('halls', [...venue.halls, restored]); setHallId(restored.id); setDeletedLocalHalls(current => current.filter(saved => saved.id !== hall.id)); }}>입력을 새 홀로 보관</Button></div></div>)}
          <section className="venue-hall-panel" aria-label="홀별 정보">
            <div className="venue-scope-heading"><h3>홀별 정보</h3><span>예식 시간·내부·비용을 홀마다 기록해요.</span></div>
            <div className="venue-hall-toolbar"><div className="venue-hall-tabs" role="tablist" aria-label="홀 선택">{venue.halls.map(hall => <button type="button" role="tab" key={hall.id} className={hall.id === selectedHall.id ? 'active' : ''} aria-selected={hall.id === selectedHall.id} onClick={() => { setHallId(hall.id); setRemoveHallId(null); }}>{hall.name || '이름 없는 홀'}</button>)}</div><Button kind="ghost" size="small" disabled={busy || venue.halls.length >= 20} onClick={addHall}><Plus size={14}/>홀 추가</Button></div>
            <div className="venue-hall-name"><label className="field"><span>홀 이름</span><input required maxLength={100} value={selectedHall.name} placeholder="예: 그랜드홀, 루비홀" onChange={e => set('halls', venue.halls.map(hall => hall.id === selectedHall.id ? { ...hall, name:e.target.value } : hall))}/></label><IconButton label={`${selectedHall.name} 홀 삭제`} disabled={busy || venue.halls.length === 1} onClick={() => setRemoveHallId(selectedHall.id)}><Trash2 size={16}/></IconButton></div>
            {removeHallId && <div className="venue-hall-removal"><p>이 홀과 홀별 기록을 삭제할까요? 저장하면 반영돼요.</p><div className="button-row"><Button kind="secondary" size="small" onClick={() => setRemoveHallId(null)}>취소</Button><Button kind="danger" size="small" onClick={() => { set('halls', venue.halls.filter(hall => hall.id !== removeHallId)); setRemoveHallId(null); }}>홀 삭제</Button></div></div>}
            <ChecklistGroups fields={hallFields} answers={selectedHall.answers} groupKey={`${tab}-${selectedHall.id}-${!!fieldSearch}`} searching={!!fieldSearch} onChange={(id, patch) => setAnswer(id, patch, selectedHall.id)} hall/>
          </section>
          <section className="venue-common-panel" aria-label="웨딩홀 공통 정보"><div className="venue-scope-heading"><h3>웨딩홀 공통 정보</h3><span>모든 홀에 똑같이 적용돼요.</span></div><ChecklistGroups fields={commonFields} answers={venue.answers} groupKey={`${tab}-common-${!!fieldSearch}`} searching={!!fieldSearch} onChange={(id, patch) => setAnswer(id, patch)}/></section>
          {!shown.length && <p className="form-note">찾는 항목이 없어요.</p>}
        </div>
      </fieldset>
      <div className="modal-actions venue-save"><Button kind="secondary" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" busy={busy} disabled={!!deletedLocalHalls.length}><Check size={16}/>저장하기</Button></div>
    </form>
  </Modal>;
}

function ChecklistGroups({ fields, answers, groupKey, searching, onChange, hall = false }:{ fields:VenueChecklistField[]; answers:Venue['answers']; groupKey:string; searching:boolean; onChange:(id:string, patch:Partial<VenueAnswer>) => void; hall?:boolean }) {
  const categoryOf = (field:VenueChecklistField) => hall ? hallCategory(field) : field.category;
  return <>{[...new Set(fields.map(categoryOf))].map((category, index) => {
    const group = fields.filter(field => categoryOf(field) === category);
    return <details className="venue-check-group" key={`${groupKey}-${category}`} open={searching ? true : index === 0 ? true : undefined}><summary><strong>{category}</strong><span>{group.filter(field => isRecorded(answers[field.id])).length}/{group.length}</span></summary><div>{group.map(field => <ChecklistEntry key={field.id} field={field} answer={answers[field.id] || emptyAnswer()} onChange={patch => onChange(field.id, patch)}/>)}</div></details>;
  })}</>;
}

function ChecklistEntry({ field, answer, onChange }:{ field:VenueChecklistField; answer:VenueAnswer; onChange:(patch:Partial<VenueAnswer>) => void }) {
  return <div className="venue-check-entry">
    <div className="venue-check-title"><strong>{field.label}</strong><label className="venue-check-toggle"><input type="checkbox" aria-label={`${field.label} 확인`} checked={answer.checked} onChange={e => onChange({ checked:e.target.checked })}/>확인</label></div>
    {field.question && <p className="venue-question">{field.question}</p>}
    {field.kind === 'onsite' && <label className="field venue-rating"><span className="sr-only">{field.label} 만족도</span><select aria-label={`${field.label} 만족도`} value={answer.rating} onChange={e => onChange({ rating:e.target.value as VenueAnswer['rating'] })}><option value="">만족도 선택</option>{['만족', '보통', '아쉬움'].map(rating => <option key={rating} value={rating}>{rating}</option>)}</select></label>}
    <label className="field"><span className="sr-only">{field.label} 기록</span><textarea aria-label={`${field.label} 기록`} rows={2} maxLength={2000} value={answer.value} onChange={e => onChange({ value:e.target.value })} placeholder={field.kind === 'onsite' ? '현장에서 확인한 내용과 메모' : '답변 · 조건 · 메모'}/></label>
  </div>;
}
