import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Building2, CalendarDays, Check, Download, ExternalLink, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { usePlanner, vendorStatus, type Item } from '../planner';
import type { Venue, VenueAnswer, VenueChecklistField } from '../types';
import { csv, dateLabel, safeUrl, uid } from '../lib/format';
import { Badge, Button, Empty, IconButton, Modal, Segmented } from '../components/ui';

const emptyAnswer = ():VenueAnswer => ({ value:'', checked:false, rating:'' });
const isRecorded = (answer?:VenueAnswer) => !!answer && (!!answer.value.trim() || answer.checked || !!answer.rating);
const blankVenue = ():Venue => ({ id:uid(), name:'', status:'researching', visitDate:'', contact:'', url:'', notes:'', answers:{} });

export function Venues() {
  const { state, data, openEditor, confirmRemove, blocked } = usePlanner();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all');
  const fields = data.venueChecklist.fields;
  const rows = state.venues.filter(venue => (status === 'all' || venue.status === status) && [venue.name, venue.contact, venue.notes, ...Object.values(venue.answers).map(a => a.value)].some(value => value.toLowerCase().includes(search.trim().toLowerCase())));
  const exportCsv = () => csv('웨딩홀-투어-기록.csv', ['웨딩홀', '상태', '방문일', '분류', '항목', '확인', '만족도', '기록'], state.venues.flatMap(venue => fields.map(field => {
    const answer = venue.answers[field.id];
    return [venue.name, vendorStatus[venue.status], venue.visitDate, field.category, field.label, answer?.checked ? '확인' : '', answer?.rating || '', answer?.value || ''];
  })));
  return <>
    <div className="summary-chips"><span>전체<strong>{state.venues.length}</strong></span><span>상담 완료<strong>{state.venues.filter(v => v.status === 'contacted').length}</strong></span><span>계약 완료<strong>{state.venues.filter(v => v.status === 'booked').length}</strong></span></div>
    <div className="toolbar">
      <div className="toolbar-filters"><label className="search-field"><Search size={17}/><input type="search" aria-label="웨딩홀 검색" placeholder="웨딩홀 · 기록 검색" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="웨딩홀 상태 필터" value={status} onChange={e => setStatus(e.target.value)}><option value="all">모든 상태</option>{Object.entries(vendorStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="toolbar-actions"><Button kind="secondary" size="small" disabled={!state.venues.length} onClick={exportCsv}><Download size={15}/>CSV</Button><Button size="small" disabled={blocked} onClick={() => openEditor('venues')}><Plus size={16}/>웨딩홀 추가</Button></div>
    </div>
    {data.venueChecklist.sourceName && <p className="venue-source">체크리스트 원본: {data.venueChecklist.sourceName}</p>}
    {rows.length ? <div className="tile-grid">{rows.map(venue => {
      const recorded = fields.filter(field => isRecorded(venue.answers[field.id])).length;
      const onsite = fields.filter(field => field.kind === 'onsite');
      const checked = onsite.filter(field => venue.answers[field.id]?.checked).length;
      return <article className="tile venue-tile" key={venue.id}>
        <div className="tile-top"><span className="tile-icon"><Building2 size={20}/></span><Badge tone={venue.status === 'booked' ? 'mint' : venue.status === 'contacted' ? 'gold' : 'neutral'}>{vendorStatus[venue.status]}</Badge></div>
        <h3>{venue.name}</h3>
        {venue.visitDate && <p className="vendor-contact"><CalendarDays size={14}/>{dateLabel(venue.visitDate)} 방문</p>}
        <div className="venue-progress"><span>기록 {recorded}/{fields.length}</span><span>현장 확인 {checked}/{onsite.length}</span></div>
        {venue.notes && <p className="tile-note">{venue.notes}</p>}
        <Button kind="secondary" size="small" className="venue-record" disabled={blocked} onClick={() => openEditor('venues', venue)}><Pencil size={14}/>체크리스트 기록</Button>
        <div className="tile-footer">{safeUrl(venue.url) ? <a className="text-link" href={safeUrl(venue.url)} target="_blank" rel="noopener noreferrer">홈페이지<ExternalLink size={13}/></a> : <span/>}<IconButton label={`${venue.name} 삭제`} disabled={blocked} onClick={() => confirmRemove('venues', venue)}><Trash2 size={16}/></IconButton></div>
      </article>;
    })}</div> : <section className="card"><Empty icon={Building2} title={search || status !== 'all' ? '찾는 웨딩홀이 없어요' : '웨딩홀을 추가해 주세요'} description={search || status !== 'all' ? '검색어나 상태 필터를 바꿔 주세요.' : '추가한 홀마다 같은 체크리스트를 따로 기록할 수 있어요.'} action={!search && status === 'all' && <Button disabled={blocked} onClick={() => openEditor('venues')}><Plus size={16}/>웨딩홀 추가</Button>}/></section>}
  </>;
}

// Keep the person's edited fields, while adopting a partner's newer values after a conflict.
function mergeVenue(base:Venue, edited:Venue, latest:Venue):Venue {
  const next = { ...latest, answers:{ ...latest.answers } };
  const keys = ['name', 'status', 'visitDate', 'contact', 'url', 'notes'] as const;
  for (const key of keys) if (edited[key] !== base[key]) Object.assign(next, { [key]:edited[key] });
  for (const key of new Set([...Object.keys(base.answers), ...Object.keys(edited.answers), ...Object.keys(latest.answers)])) {
    const before = base.answers[key] || emptyAnswer(); const local = edited.answers[key] || emptyAnswer(); const remote = latest.answers[key] || emptyAnswer();
    const answer = { ...remote };
    for (const part of ['value', 'checked', 'rating'] as const) if (local[part] !== before[part]) Object.assign(answer, { [part]:local[part] });
    if (isRecorded(answer)) next.answers[key] = answer; else delete next.answers[key];
  }
  return next;
}

export function VenueEditor({ item, current, busy, onClose, onSave }:{ item?:Item; current:Item|null; busy:boolean; onClose:() => void; onSave:(item:Venue) => Promise<void> }) {
  const { data } = usePlanner();
  const [form, setForm] = useState(() => { const initial = item ? structuredClone(item as Venue) : blankVenue(); return { base:initial, values:initial }; });
  const [tab, setTab] = useState<'comparison'|'onsite'>('comparison');
  const [fieldSearch, setFieldSearch] = useState('');
  useEffect(() => {
    if (!item || !current) return;
    setForm(({ base, values }) => ({ base:current as Venue, values:mergeVenue(base, values, current as Venue) }));
  }, [item, current]);
  const venue = form.values;
  const fields = data.venueChecklist.fields;
  const shown = useMemo(() => fields.filter(field => field.kind === tab && `${field.category} ${field.label} ${field.question || ''}`.toLowerCase().includes(fieldSearch.trim().toLowerCase())), [fields, tab, fieldSearch]);
  const categories = [...new Set(shown.map(field => field.category))];
  const set = <K extends keyof Venue>(key:K, value:Venue[K]) => setForm(f => ({ ...f, values:{ ...f.values, [key]:value } }));
  const setAnswer = (id:string, patch:Partial<VenueAnswer>) => setForm(f => ({ ...f, values:{ ...f.values, answers:{ ...f.values.answers, [id]:{ ...(f.values.answers[id] || emptyAnswer()), ...patch } } } }));
  const submit = async (event:FormEvent) => {
    event.preventDefault();
    await onSave({ ...venue, name:venue.name.trim(), contact:venue.contact.trim(), url:venue.url.trim(), notes:venue.notes.trim(), answers:Object.fromEntries(Object.entries(venue.answers).filter(([, answer]) => isRecorded(answer))) });
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
          <div className="venue-checklist-heading"><h3>투어 체크리스트</h3><span>기록 {fields.filter(field => isRecorded(venue.answers[field.id])).length}/{fields.length}</span></div>
          <Segmented label="체크리스트 종류" value={tab} onChange={value => { setTab(value); setFieldSearch(''); }} options={['comparison', 'onsite'].map(kind => [kind as typeof tab, kind === 'comparison' ? '비교 기록' : '현장 체크', fields.filter(field => field.kind === kind).length])}/>
          <label className="search-field venue-field-search"><Search size={16}/><input type="search" aria-label="체크리스트 항목 검색" placeholder="항목 검색" value={fieldSearch} onChange={e => setFieldSearch(e.target.value)}/></label>
          {categories.map((category, index) => {
            const group = shown.filter(field => field.category === category);
            return <details className="venue-check-group" key={`${tab}-${category}-${!!fieldSearch}`} open={fieldSearch ? true : index === 0 ? true : undefined}>
              <summary><strong>{category}</strong><span>{group.filter(field => isRecorded(venue.answers[field.id])).length}/{group.length}</span></summary>
              <div>{group.map(field => <ChecklistEntry key={field.id} field={field} answer={venue.answers[field.id] || emptyAnswer()} onChange={patch => setAnswer(field.id, patch)}/>)}</div>
            </details>;
          })}
          {!shown.length && <p className="form-note">찾는 항목이 없어요.</p>}
        </div>
      </fieldset>
      <div className="modal-actions venue-save"><Button kind="secondary" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" busy={busy}><Check size={16}/>저장하기</Button></div>
    </form>
  </Modal>;
}

function ChecklistEntry({ field, answer, onChange }:{ field:VenueChecklistField; answer:VenueAnswer; onChange:(patch:Partial<VenueAnswer>) => void }) {
  return <div className="venue-check-entry">
    <div className="venue-check-title"><strong>{field.label}</strong><label className="venue-check-toggle"><input type="checkbox" aria-label={`${field.label} 확인`} checked={answer.checked} onChange={e => onChange({ checked:e.target.checked })}/>확인</label></div>
    {field.question && <p className="venue-question">{field.question}</p>}
    {field.kind === 'onsite' && <label className="field venue-rating"><span className="sr-only">{field.label} 만족도</span><select aria-label={`${field.label} 만족도`} value={answer.rating} onChange={e => onChange({ rating:e.target.value as VenueAnswer['rating'] })}><option value="">만족도 선택</option>{['만족', '보통', '아쉬움'].map(rating => <option key={rating} value={rating}>{rating}</option>)}</select></label>}
    <label className="field"><span className="sr-only">{field.label} 기록</span><textarea aria-label={`${field.label} 기록`} rows={2} maxLength={2000} value={answer.value} onChange={e => onChange({ value:e.target.value })} placeholder={field.kind === 'onsite' ? '현장에서 확인한 내용과 메모' : '답변 · 조건 · 메모'}/></label>
  </div>;
}
