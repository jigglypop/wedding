import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Collection, PlanState, Proposal } from '../src/types';

export class ValidationError extends Error {}
const str = (max = 2000) => z.string().max(max);
const id = z.string().min(1).max(100);
const money = z.number().finite().min(0).max(1e12);
const date = z.string().refine(v => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v), '날짜 형식을 확인해 주세요.');
const source = { sourceId:str(100).optional() };
export const settingsSchema = z.object({ coupleNames:str(100), weddingDate:date, venue:str(300), totalBudget:money, guestTarget:z.number().int().min(0).max(10000) });
export const itemSchemas = {
  tasks:z.object({ id, title:str(300).min(1), category:str(100), dueDate:date, status:z.enum(['todo', 'doing', 'done']), notes:str(), ...source }),
  budgets:z.object({ id, title:str(300).min(1), category:str(100), planned:money, actual:money, paid:money, notes:str(), ...source }),
  vendors:z.object({ id, name:str(300).min(1), category:str(100), status:z.enum(['researching', 'contacted', 'booked']), price:money, contact:str(300), url:str(2000).refine(v => !v || /^https?:\/\//i.test(v), 'http(s) 주소를 입력해 주세요.'), notes:str(), ...source }),
  guests:z.object({ id, name:str(100).min(1), side:z.enum(['bride', 'groom', 'other']), group:str(100), people:z.number().int().min(1).max(100), rsvp:z.enum(['pending', 'yes', 'no']), table:str(100), contact:str(300), notes:str() }),
  timeline:z.object({ id, time:str(20), title:str(300).min(1), owner:str(100), notes:str() }),
  notes:z.object({ id, title:str(300).min(1), content:str(10000), category:str(100) })
};
export const collections = Object.keys(itemSchemas) as Collection[];
export const collectionLabels:Record<Collection, string> = { tasks:'할 일', budgets:'예산', vendors:'업체', guests:'하객', timeline:'타임라인', notes:'메모' };
export const proposalSchema = z.object({ id, type:z.enum(['upsert', 'delete', 'settings']), collection:z.enum(collections as [Collection, ...Collection[]]).optional(), item:z.record(z.string(), z.unknown()).optional(), itemId:str(100).optional(), settings:settingsSchema.partial().optional(), expectedItem:z.record(z.string(), z.unknown()).nullable().optional(), expectedSettings:settingsSchema.partial().optional(), description:str(300) });
export const messageSchema = z.object({ id, role:z.enum(['user', 'assistant']), content:str(16000), at:str(100), by:str(40).optional(), proposals:z.array(proposalSchema).max(60).optional(), applied:z.boolean().optional(), sources:z.array(z.object({ id, title:str(500), sourceUrl:str(2000).optional() })).max(40).optional() });
export const stateSchema = z.object({
  version:z.number().int().positive(), updatedAt:str(100), settings:settingsSchema,
  tasks:z.array(itemSchemas.tasks).max(600), budgets:z.array(itemSchemas.budgets).max(300), vendors:z.array(itemSchemas.vendors).max(200), guests:z.array(itemSchemas.guests).max(2000), timeline:z.array(itemSchemas.timeline).max(200), notes:z.array(itemSchemas.notes).max(200),
  activity:z.array(z.object({ id, at:str(100), text:str(500), by:str(40).optional() })).max(100), conversations:z.array(messageSchema).max(40)
});

export function validateState(input:unknown):PlanState {
  const parsed = stateSchema.parse(input) as PlanState;
  for (const collection of collections) { const ids = parsed[collection].map(i => i.id); if (new Set(ids).size !== ids.length) throw new ValidationError(`${collectionLabels[collection]} 항목 ID가 중복됩니다.`); }
  if (Buffer.byteLength(JSON.stringify(parsed)) > 340000) throw new ValidationError('저장 공간이 가득 찼어요. 오래된 상담 기록이나 메모를 정리해 주세요.');
  return parsed;
}
export function addActivity(state:PlanState, text:string, by?:string) {
  state.activity.unshift({ id:randomUUID(), at:new Date().toISOString(), text:text.slice(0, 500), ...(by ? { by:by.slice(0, 40) } : {}) });
  state.activity = state.activity.slice(0, 60);
}
export function itemLabel(item:Record<string, unknown>) { return String(item.title ?? item.name ?? '').slice(0, 60); }

export function applyProposals(state:PlanState, proposals:Proposal[], by?:string):PlanState {
  const next = structuredClone(state);
  for (const proposal of proposals) {
    if (proposal.type === 'settings') {
      for (const [key, value] of Object.entries(proposal.expectedSettings || {})) if (next.settings[key as keyof typeof next.settings] !== value) throw new ValidationError('설정이 그사이 변경되었어요. 변경안을 다시 요청해 주세요.');
      next.settings = settingsSchema.parse({ ...next.settings, ...proposal.settings });
      continue;
    }
    const key = proposal.collection;
    if (!key || !collections.includes(key)) throw new ValidationError('지원하지 않는 항목입니다.');
    const items = next[key] as unknown as Record<string, unknown>[];
    const targetId = proposal.type === 'delete' ? proposal.itemId : proposal.item?.id;
    if (proposal.expectedItem !== undefined) {
      const existing = items.find(i => i.id === targetId) || null;
      if (JSON.stringify(existing) !== JSON.stringify(proposal.expectedItem)) throw new ValidationError('항목이 그사이 변경되었어요. 변경안을 다시 요청해 주세요.');
    }
    if (proposal.type === 'delete') {
      const index = items.findIndex(i => i.id === proposal.itemId);
      if (index < 0) throw new ValidationError('삭제할 항목을 찾지 못했어요. 다시 요청해 주세요.');
      items.splice(index, 1);
    } else {
      const parsed = itemSchemas[key].safeParse(proposal.item);
      if (!parsed.success) throw new ValidationError('제안된 항목 형식이 올바르지 않아요. 다시 요청해 주세요.');
      const item = parsed.data as unknown as Record<string, unknown>;
      const index = items.findIndex(i => i.id === item.id);
      if (index >= 0) items[index] = item; else items.push(item);
    }
  }
  addActivity(next, `AI 플래너 제안 ${proposals.length}건 반영`, by);
  return validateState(next);
}

export function scheduleProposals(state:PlanState):Proposal[] {
  if (!state.settings.weddingDate) throw new ValidationError('확정 예식일을 먼저 설정해 주세요.');
  const base = Date.parse(state.settings.weddingDate);
  return state.tasks.flatMap(task => {
    if (task.dueDate || task.status === 'done') return [];
    const match = task.notes.match(/예식일 기준 D([+-])([0-9]+)/);
    if (!match) return [];
    const days = (match[1] === '-' ? -1 : 1) * Number(match[2]);
    const dueDate = new Date(base + days * 86400000).toISOString().slice(0, 10);
    return [{ id:randomUUID(), type:'upsert' as const, collection:'tasks' as const, item:{ ...task, dueDate }, description:`${task.title} · 권장 마감 ${dueDate}` }];
  });
}
