import type { Side } from '../types';

export const money = (value:number) => `${new Intl.NumberFormat('ko-KR').format(value || 0)}원`;
export function compactMoney(value:number) {
  if (!value) return '0원';
  if (value >= 1e8) return `${(value / 1e8).toFixed(value % 1e8 ? 1 : 0)}억원`;
  if (value >= 1e4) return `${new Intl.NumberFormat('ko-KR').format(Math.round(value / 1e4))}만원`;
  return money(value);
}
export const num = (value:unknown) => Math.max(0, Number(value) || 0);
export const uid = () => crypto.randomUUID();
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone:'Asia/Seoul' });
export const dateLabel = (value:string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('ko-KR', { month:'long', day:'numeric' }) : '날짜 미정';
export const fullDate = (value:string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' }) : '';
export function dday(date:string) {
  if (!date) return { label:'D-?', days:null as number|null };
  const days = Math.round((Date.parse(date) - Date.parse(today())) / 86400000);
  return { label:days === 0 ? 'D-DAY' : days > 0 ? `D-${days}` : `D+${-days}`, days };
}
export function ago(iso:string) {
  const seconds = (Date.now() - Date.parse(iso)) / 1000;
  if (seconds < 60) return '방금';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  if (seconds < 172800) return '어제';
  return new Date(iso).toLocaleDateString('ko-KR', { month:'numeric', day:'numeric' });
}
export const safeUrl = (value?:string) => { try { const url = new URL(value || ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } };
export const sideLabel:Record<Side, string> = { groom:'신랑', bride:'신부', other:'함께' };
export const initial = (name:string) => (name.trim()[0] || '?').toUpperCase();
// Picks the right Korean particle (을/를, 이/가 …) for the final syllable.
export function josa(word:string, pair:'을/를'|'이/가'|'은/는'|'과/와'|'으로/로') {
  const [withBatchim, without] = pair.split('/');
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}${without}`;
  const final = code % 28;
  return `${word}${final === 0 || (pair === '으로/로' && final === 8) ? without : withBatchim}`;
}
export const sortTime = (time:string) => { const [h = '0', m = '0'] = time.split(':'); return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`; };

export function download(filename:string, content:string, type:string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = Object.assign(document.createElement('a'), { href:url, download:filename });
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csv(filename:string, headers:string[], rows:unknown[][]) {
  const encode = (v:unknown) => { const value = String(v ?? ''); return `"${(/^[\s]*[=+\-@]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`; };
  download(filename, '﻿' + [headers, ...rows].map(row => row.map(encode).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
export async function copyText(text:string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const area = Object.assign(document.createElement('textarea'), { value:text }); area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.append(area); area.select(); const ok = document.execCommand('copy'); area.remove(); return ok;
  }
}
