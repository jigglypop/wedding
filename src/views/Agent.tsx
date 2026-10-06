import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowRight, BookOpen, Check, CheckCheck, ExternalLink, FileText, LoaderCircle, Send, Sparkles, SquareCheck, Trash2 } from 'lucide-react';
import { collectionName, usePlanner } from '../planner';
import { api } from '../lib/api';
import { dateLabel, money, safeUrl } from '../lib/format';
import type { ChatMessage, PlanState, Proposal } from '../types';
import { Avatar, Badge, Button, IconButton, Modal } from '../components/ui';

const markdownComponents = { a:({ href, children }:{ href?:string; children?:ReactNode }) => safeUrl(href) ? <a href={safeUrl(href)} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>, img:() => null };
export function Markdown({ children }:{ children:string }) { return <div className="markdown"><ReactMarkdown components={markdownComponents}>{children}</ReactMarkdown></div>; }
// Labels come from the structured change itself, not the model's description, so a deletion always reads as one.
function proposalKind(p:Proposal):{ label:string; title:string; tone:'mint'|'gold'|'danger'|'lilac' } {
  if (p.type === 'settings') return { label:'기본 정보', title:Object.keys(p.settings || {}).map(key => settingLabels[key] || key).join(', '), tone:'lilac' };
  const name = collectionName[p.collection!] || '항목';
  const source = (p.type === 'delete' ? p.expectedItem : p.item) || {};
  const title = String(source.title ?? source.name ?? p.itemId ?? '');
  if (p.type === 'delete') return { label:`${name} 삭제`, title, tone:'danger' };
  return { label:`${name} ${p.expectedItem ? '수정' : '추가'}`, title, tone:p.expectedItem ? 'gold' : 'mint' };
}
const settingLabels:Record<string, string> = { coupleNames:'노트 이름', weddingDate:'결혼 날짜', venue:'예식 장소', totalBudget:'목표 예산', guestTarget:'예상 하객 수' };

export function Agent() {
  const { state, data, draft, setDraft, sendChat, chatBusy, blocked, run, setState, navigate } = usePlanner();
  const [removing, setRemoving] = useState<string|null>(null);
  const list = useRef<HTMLDivElement>(null);
  const materialIds = new Set(data.materials.map(m => m.id));
  // Keep the newest message in view inside the chat panel without scrolling the whole page.
  useEffect(() => { const element = list.current; if (element && (state.conversations.length || chatBusy)) element.scrollTo({ top:element.scrollHeight, behavior:'smooth' }); }, [state.conversations.length, chatBusy]);
  const apply = (message:ChatMessage) => run(async () => { const result = await api<{ state:PlanState }>('/api/chat/apply', { messageId:message.id }); setState(result.state); }, '제안 내용을 노트에 반영했어요.');
  const remove = async () => { if (!removing) return; await run(async () => { const result = await api<{ state:PlanState }>('/api/chat/remove', { messageId:removing }); setState(result.state); setRemoving(null); }, '상담 기록을 삭제했어요.'); };
  const complete = state.tasks.filter(t => t.status === 'done').length;
  const suggestions = ['지금 준비 상황을 정리해 줘', '이번 달에 꼭 해야 할 일을 알려 줘', '예산을 검토하고 조언해 줘'];
  return <section className="agent-layout">
    <div className="chat-panel card">
      <header className="chat-header"><span className="agent-avatar"><Sparkles size={20}/></span><div><strong>우리의 AI 웨딩플래너</strong><span>{data.agentReady ? '준비 상황을 바탕으로 함께 계획해요' : 'AI 연결 설정이 필요해요'}</span></div><Badge tone={data.agentReady ? 'mint' : 'gold'}>{data.agentReady ? '상담 가능' : '연결 대기'}</Badge></header>
      <div className="chat-messages" aria-live="polite" ref={list}>
        {state.conversations.length === 0 && <div className="chat-welcome"><span className="welcome-icon"><Sparkles size={28}/></span><h2>어떤 준비를 함께할까요?</h2><p>일정과 예산을 알려 주거나,<br/>체크리스트 정리를 부탁해 보세요.</p><div>{suggestions.map(s => <button type="button" key={s} onClick={() => setDraft(s)}>{s}<ArrowRight size={14}/></button>)}</div></div>}
        {state.conversations.map(message => <article className={`chat-message ${message.role}`} key={message.id}>
          {message.role === 'assistant' ? <span className="chat-avatar"><Sparkles size={16}/></span> : <Avatar name={message.by || '나'} size="small" side={data.workspace.members.find(m => m.name === message.by)?.side}/>}
          <div className="message-body">
            <span className="message-label">{message.role === 'assistant' ? '웨딩플래너' : message.by || '나'}<time>{new Date(message.at).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}</time>{message.role === 'assistant' && <IconButton className="tiny" label="상담 기록 삭제" disabled={blocked} onClick={() => setRemoving(message.id)}><Trash2 size={14}/></IconButton>}</span>
            <div className="bubble"><Markdown>{message.content}</Markdown></div>
            {!!message.sources?.length && <div className="message-sources"><span><BookOpen size={13}/>참고한 자료</span>{message.sources.map(source => {
              const href = materialIds.has(source.id) ? `/api/materials/${encodeURIComponent(source.id)}` : safeUrl(source.sourceUrl);
              return href ? <a key={source.id} href={href} target="_blank" rel="noopener noreferrer">{materialIds.has(source.id) ? <FileText size={12}/> : <ExternalLink size={12}/>}{source.title}</a> : <span key={source.id} className="source-chip">{source.title}</span>;
            })}</div>}
            {!!message.proposals?.length && <div className="proposal-card">
              <div className="proposal-head"><SquareCheck size={16}/><strong>{message.applied ? '노트에 반영했어요' : '이렇게 정리할 수 있어요'}</strong><Badge tone="lilac">{message.proposals.length}개 변경</Badge></div>
              <ul>{message.proposals.slice(0, 12).map(p => { const kind = proposalKind(p); return <li key={p.id}><Badge tone={kind.tone}>{kind.label}</Badge><span><strong>{kind.title}</strong>{p.description && p.description !== kind.title && <small>{p.description}</small>}</span></li>; })}{message.proposals.length > 12 && <li className="more">외 {message.proposals.length - 12}개</li>}</ul>
              {message.applied ? <span className="applied-label"><CheckCheck size={15}/>반영 완료</span> : <Button size="small" disabled={blocked} onClick={() => void apply(message)}><Check size={15}/>제안 전체 반영하기</Button>}
            </div>}
          </div>
        </article>)}
        {chatBusy && <div className="chat-thinking"><span className="chat-avatar"><Sparkles size={16}/></span><div><span className="thinking-dots"><i/><i/><i/></span><p>자료와 준비 상황을 살펴보고 있어요. 최대 1~2분 걸릴 수 있어요.</p></div></div>}
      </div>
      <form className="chat-compose" onSubmit={event => { event.preventDefault(); void sendChat(); }}>
        {!data.agentReady && <p className="form-error">서버에 AI 키가 설정되면 상담을 사용할 수 있어요. 다른 기능은 그대로 쓸 수 있어요.</p>}
        <div className="compose-box">
          <textarea rows={2} maxLength={4000} aria-label="웨딩플래너에게 메시지 보내기" value={draft} onChange={e => setDraft(e.target.value)} placeholder="예: 다음 달까지 해야 할 일을 정리해 줘" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendChat(); } }}/>
          <button type="submit" aria-label="메시지 보내기" disabled={!draft.trim() || blocked || !data.agentReady}>{chatBusy ? <LoaderCircle size={19} className="spin"/> : <Send size={18}/>}</button>
        </div>
        <small>제안은 내용을 확인하고 ‘반영하기’를 눌러야 저장돼요.</small>
      </form>
    </div>
    <aside className="agent-context">
      <section className="card context-card">
        <span className="eyebrow">함께 알고 있는 정보</span><h3>우리의 준비 현황</h3>
        <dl><div><dt>결혼 날짜</dt><dd>{dateLabel(state.settings.weddingDate)}</dd></div><div><dt>목표 예산</dt><dd>{state.settings.totalBudget ? money(state.settings.totalBudget) : '미설정'}</dd></div><div><dt>체크리스트</dt><dd>{complete} / {state.tasks.length} 완료</dd></div><div><dt>참고 자료</dt><dd>{data.materials.length}개</dd></div></dl>
        <button type="button" className="text-link" onClick={() => navigate('materials')}>자료 보관함 열기<ArrowRight size={14}/></button>
      </section>
      <section className="tip-card"><h3>우리의 속도로 준비해요</h3><p>궁금한 것은 편하게 물어보세요. 결정이 필요한 항목은 두 사람이 함께 확인해 주세요.</p></section>
    </aside>
    {removing && <Modal title="상담 기록 삭제" onClose={() => setRemoving(null)} busy={blocked}><div className="confirm-body"><p>이 상담 기록을 삭제할까요?</p><span>질문과 답변이 삭제돼요. 이미 반영한 할 일과 예산은 그대로 남아요.</span></div><div className="modal-actions"><Button kind="secondary" disabled={blocked} onClick={() => setRemoving(null)}>취소</Button><Button kind="danger" busy={blocked} onClick={() => void remove()}><Trash2 size={15}/>삭제하기</Button></div></Modal>}
  </section>;
}
