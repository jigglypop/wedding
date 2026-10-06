import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, FileSpreadsheet, FileText, Image as ImageIcon, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { usePlanner } from '../planner';
import { api } from '../lib/api';
import type { Material } from '../types';
import { Badge, Button, Empty, Modal, Spinner } from '../components/ui';
import { Markdown } from './Agent';

const isImage = (m:Material) => !!m.mimeType?.startsWith('image/');
const fileUrl = (m:Material, thumb = false) => `/api/materials/${encodeURIComponent(m.id)}${thumb && m.thumbnail ? '?thumb=1' : ''}`;
const coverLabel = (m:Material) => m.sourceType === 'notion' ? 'WEDDING GUIDE' : m.mimeType?.includes('pdf') ? 'PDF' : m.mimeType?.includes('sheet') || m.mimeType?.includes('excel') || m.mimeType === 'text/csv' ? 'SPREADSHEET' : 'DOCUMENT';
const CoverIcon = ({ m }:{ m:Material }) => coverLabel(m) === 'SPREADSHEET' ? <FileSpreadsheet size={30}/> : <FileText size={30}/>;
// Turns exported Notion markup (callouts, tables, embedded databases) into plain Markdown for reading.
function readable(content:string) {
  return content
    .replace(/<callout([^>]*)>([\s\S]*?)<\/callout>/g, (_, attributes:string, text:string) => `> ${attributes.match(/icon="([^"]*)"/)?.[1] ?? ''} ${text.trim().replace(/\s*\n\s*/g, ' ')}\n`)
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (_, body:string) => '\n' + body.split(/<\/tr>/).map(row => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ')).filter(Boolean).map(line => `- ${line}`).join('\n') + '\n')
    .replace(/<database[^>]*>(?:\s*<\/database>)?/g, '_(노션 표는 원문에서 확인할 수 있어요)_')
    .replace(/<\/?[a-z][a-z-]*(?:\s[^>]*)?\/?>/gi, '')
    .trim();
}
function Detail({ material }:{ material:Material }) {
  const [detail, setDetail] = useState<Material|null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let alive = true; api<{ material:Material }>(`/api/materials/${encodeURIComponent(material.id)}?format=json`).then(r => { if (alive) setDetail(r.material); }).catch(() => { if (alive) setFailed(true); }); return () => { alive = false; }; }, [material.id]);
  if (!detail) return failed ? null : <div className="loading-block"><Spinner label="자료를 불러오는 중이에요"/></div>;
  return detail.content ? <Markdown>{readable(detail.content)}</Markdown> : null;
}

export function Materials() {
  const { data, setData, run, blocked, ask, notify } = usePlanner();
  const [search, setSearch] = useState(''); const [category, setCategory] = useState('all');
  const [open, setOpen] = useState<Material|null>(null); const [removing, setRemoving] = useState<Material|null>(null);
  const input = useRef<HTMLInputElement>(null);
  const term = search.trim().toLowerCase();
  const rows = data.materials.filter(m => (category === 'all' || m.category === category) && (!term || `${m.title} ${m.summary || ''} ${m.category}`.toLowerCase().includes(term)));
  const categories = [...new Set(data.materials.map(m => m.category))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
  const upload = async (file?:File) => {
    if (!file || blocked) return;
    if (file.size > 3 * 1024 * 1024) { notify('자료는 파일당 3MB까지 올릴 수 있어요.'); if (input.current) input.current.value = ''; return; }
    await run(async () => {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('파일을 읽지 못했어요.')); reader.readAsDataURL(file); });
      const result = await api<{ material:Material }>('/api/materials/upload', { filename:file.name, data:base64, title:file.name.replace(/\.[^.]+$/, '').slice(0, 200) || '업로드 자료', category:'업로드 자료' });
      setData(d => ({ ...d, materials:[...d.materials, result.material] }));
    }, '자료를 보관함에 추가했어요.');
    if (input.current) input.current.value = '';
  };
  const remove = async () => {
    if (!removing) return; const target = removing;
    await run(async () => { await api(`/api/materials/${encodeURIComponent(target.id)}`, undefined, 'DELETE'); setData(d => ({ ...d, materials:d.materials.filter(m => m.id !== target.id) })); setRemoving(null); setOpen(null); }, '자료를 삭제했어요.');
  };
  const uploadButton = <Button size="small" busy={blocked} onClick={() => input.current?.click()}><Upload size={15}/>자료 올리기</Button>;
  return <>
    <div className="toolbar">
      <div className="toolbar-filters"><label className="search-field"><Search size={17}/><input type="search" aria-label="자료 검색" placeholder="자료 제목이나 분류 검색" value={search} onChange={e => setSearch(e.target.value)}/></label>{categories.length > 1 && <select aria-label="자료 분류" value={category} onChange={e => setCategory(e.target.value)}><option value="all">모든 분류</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>}</div>
      <div className="toolbar-actions">{uploadButton}</div>
      <input ref={input} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls,.csv,.txt" className="sr-only" tabIndex={-1} onChange={e => void upload(e.target.files?.[0])}/>
    </div>
    <p className="collection-info">자료 {data.materials.length}개 · 이미지, PDF, 엑셀, CSV, 텍스트(파일당 3MB) · 올린 자료는 AI 플래너가 함께 읽을 수 있어요.</p>
    {rows.length ? <div className="tile-grid materials">{rows.map(m => <button type="button" className="tile material-tile" key={m.id} onClick={() => setOpen(m)}>
      <span className={`material-cover ${isImage(m) ? 'image' : ''} tone-${[...m.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3}`}>{isImage(m) ? <img src={fileUrl(m, true)} alt="" loading="lazy" decoding="async"/> : <><CoverIcon m={m}/><span>{coverLabel(m)}</span></>}<Badge>{m.category || '참고 자료'}</Badge></span>
      <span className="material-info"><strong>{m.title}</strong><span>{m.summary || m.originalFilename || '결혼 준비 참고 자료'}</span></span>
    </button>)}</div> : <section className="card"><Empty icon={BookOpen} title={term || category !== 'all' ? '찾는 자료가 없어요' : '결혼 준비 자료를 모아 보세요'} description={term || category !== 'all' ? '검색어나 분류를 바꿔 확인해 주세요.' : '계약서, 견적서, 참고 이미지를 올려 두면 AI 플래너가 함께 읽고 정리해 드려요.'} action={!term && category === 'all' && uploadButton}/></section>}
    {open && <Modal title={open.title} onClose={() => setOpen(null)} wide>
      <div className="material-detail"><div className="detail-badges"><Badge tone="lilac">{open.category}</Badge>{open.sourceType === 'upload' && <Badge tone="rose">직접 올린 자료</Badge>}</div>
        {isImage(open) && <img src={fileUrl(open)} alt={open.title}/>}
        {open.summary && <p className="detail-summary">{open.summary}</p>}
        <Detail material={open}/>
        {open.originalFilename && <small className="detail-file">{isImage(open) ? <ImageIcon size={13}/> : <FileText size={13}/>}{open.originalFilename}</small>}
      </div>
      <div className="modal-actions">
        {open.sourceType === 'upload' && <Button kind="ghost" onClick={() => setRemoving(open)} disabled={blocked}><Trash2 size={15}/>삭제</Button>}
        <a className="button secondary" href={fileUrl(open)} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={16}/>{open.filename ? '원본 열기' : '원문 열기'}</a>
        <Button onClick={() => { ask(`자료 ID: ${open.id}. 보관함의 '${open.title}' 자료를 읽고 관련 준비 항목을 제안해 줘.`); setOpen(null); }}><Sparkles size={16}/>플래너에게 물어보기</Button>
      </div>
    </Modal>}
    {removing && <Modal title="자료 삭제" onClose={() => setRemoving(null)} busy={blocked}><div className="confirm-body"><p>‘{removing.title}’ 자료를 삭제할까요?</p><span>보관함과 저장소에서 원본 파일이 함께 삭제돼요.</span></div><div className="modal-actions"><Button kind="secondary" disabled={blocked} onClick={() => setRemoving(null)}>취소</Button><Button kind="danger" busy={blocked} onClick={() => void remove()}><Trash2 size={15}/>삭제하기</Button></div></Modal>}
  </>;
}
