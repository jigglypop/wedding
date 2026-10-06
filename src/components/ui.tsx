import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, CircleAlert, Heart, LoaderCircle, X } from 'lucide-react';

// A modal <dialog> sits in the browser's top layer, so page-level errors would hide behind its backdrop; modals render them too.
export const FeedbackContext = createContext<{ error:string; clear:() => void }>({ error:'', clear:() => undefined });
type PopoverElement = HTMLDivElement & { showPopover?:() => void; hidePopover?:() => void };
export function Toast({ message }:{ message:string }) {
  const ref = useRef<PopoverElement>(null);
  useEffect(() => { const element = ref.current; if (!element?.showPopover) return; try { element.hidePopover?.(); } catch {} try { element.showPopover(); } catch {} }, [message]);
  return <div ref={ref} className="toast" role="status" popover="manual"><Check size={17}/>{message}</div>;
}

type ButtonProps = { children:ReactNode; onClick?:() => void; kind?:'primary'|'secondary'|'ghost'|'danger'|'soft'; size?:'small'|'normal'; type?:'button'|'submit'; disabled?:boolean; busy?:boolean; className?:string; title?:string };
export function Button({ children, onClick, kind = 'primary', size = 'normal', type = 'button', disabled = false, busy = false, className = '', title }:ButtonProps) {
  return <button type={type} onClick={onClick} className={`button ${kind} ${size === 'small' ? 'small' : ''} ${className}`} disabled={disabled || busy} title={title} aria-busy={busy || undefined}>{busy && <LoaderCircle size={16} className="spin" aria-hidden="true"/>}{children}</button>;
}
export function IconButton({ label, onClick, children, disabled, className = '' }:{ label:string; onClick:() => void; children:ReactNode; disabled?:boolean; className?:string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function Badge({ children, tone = 'neutral' }:{ children:ReactNode; tone?:'neutral'|'rose'|'lilac'|'mint'|'gold'|'danger' }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Empty({ icon:Icon = Heart, title, description, action }:{ icon?:typeof Heart; title:string; description:string; action?:ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={24}/></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Spinner({ label }:{ label?:string }) { return <span className="spinner" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true"/>{label && <span>{label}</span>}</span>; }
export function Avatar({ name, side, size = 'normal' }:{ name:string; side?:string; size?:'small'|'normal'|'large' }) {
  return <span className={`avatar ${side || ''} ${size}`} aria-hidden="true">{(name.trim()[0] || '?').toUpperCase()}</span>;
}
export function Modal({ title, children, onClose, busy = false, wide = false }:{ title:string; children:ReactNode; onClose:() => void; busy?:boolean; wide?:boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const feedback = useContext(FeedbackContext);
  useEffect(() => { const element = dialog.current; if (element && !element.open) element.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === dialog.current && !busy) onClose(); }}>
    <div className="modal-header"><h2>{title}</h2><IconButton label="닫기" onClick={() => { if (!busy) onClose(); }} disabled={busy}><X size={20}/></IconButton></div>
    {feedback.error && <div className="modal-alert" role="alert"><CircleAlert size={16}/><span>{feedback.error}</span><IconButton className="tiny" label="안내 닫기" onClick={feedback.clear}><X size={15}/></IconButton></div>}
    {children}
  </dialog>;
}
export function Segmented<T extends string>({ value, options, onChange, label }:{ value:T; options:[T, string, number?][]; onChange:(value:T) => void; label:string }) {
  return <div className="segmented" role="tablist" aria-label={label}>{options.map(([key, text, count]) => <button type="button" role="tab" key={key} aria-selected={value === key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>{text}{count !== undefined && <span className="count">{count}</span>}</button>)}</div>;
}
export function ProgressRing({ value, size = 132, stroke = 12 }:{ value:number; size?:number; stroke?:number }) {
  const radius = (size - stroke) / 2; const circumference = 2 * Math.PI * radius;
  return <svg className="progress-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`진행률 ${value}%`}>
    <defs><linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ec7fa6"/><stop offset="100%" stopColor="#8a6fe0"/></linearGradient></defs>
    <circle cx={size / 2} cy={size / 2} r={radius} className="ring-track" strokeWidth={stroke} fill="none"/>
    <circle cx={size / 2} cy={size / 2} r={radius} stroke="url(#ring-gradient)" strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, value)) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-value"/>
  </svg>;
}
export function PasswordInput({ value, onChange, autoComplete, placeholder, id }:{ value:string; onChange:(value:string) => void; autoComplete:string; placeholder?:string; id?:string }) {
  const [visible, setVisible] = useState(false);
  return <span className="password-input"><input id={id} type={visible ? 'text' : 'password'} value={value} autoComplete={autoComplete} placeholder={placeholder} required maxLength={128} onChange={e => onChange(e.target.value)}/><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}>{visible ? '숨기기' : '보기'}</button></span>;
}
export function useIsMobile(query = '(max-width: 760px)') {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => { const media = window.matchMedia(query); const update = () => setMobile(media.matches); media.addEventListener('change', update); update(); return () => media.removeEventListener('change', update); }, [query]);
  return mobile;
}
