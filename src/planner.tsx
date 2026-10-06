import { createContext, useContext } from 'react';
import { BookOpen, Clock3, FileText, LayoutDashboard, Settings as SettingsIcon, ShieldCheck, Sparkles, SquareCheck, Store, Users, Wallet } from 'lucide-react';
import type { Bootstrap, Budget, Collection, Guest, Note, PlanState, Settings, Task, TimelineItem, Vendor, WorkspaceInfo } from './types';

export type View = 'dashboard'|'agent'|Collection|'materials'|'settings'|'admin';
export type Item = Task|Budget|Vendor|Guest|TimelineItem|Note;
export const views:View[] = ['dashboard', 'agent', 'tasks', 'budgets', 'vendors', 'guests', 'timeline', 'materials', 'notes', 'settings', 'admin'];
export const navigation:{ id:View; label:string; short:string; icon:typeof Sparkles; group:string; admin?:boolean }[] = [
  { id:'dashboard', label:'한눈에 보기', short:'홈', icon:LayoutDashboard, group:'홈' },
  { id:'agent', label:'AI 웨딩플래너', short:'AI 플래너', icon:Sparkles, group:'홈' },
  { id:'tasks', label:'준비 체크리스트', short:'할 일', icon:SquareCheck, group:'준비' },
  { id:'budgets', label:'예산 관리', short:'예산', icon:Wallet, group:'준비' },
  { id:'vendors', label:'업체 비교', short:'업체', icon:Store, group:'준비' },
  { id:'guests', label:'하객 관리', short:'하객', icon:Users, group:'준비' },
  { id:'timeline', label:'본식 타임라인', short:'타임라인', icon:Clock3, group:'준비' },
  { id:'materials', label:'자료 보관함', short:'자료', icon:BookOpen, group:'기록' },
  { id:'notes', label:'우리의 메모', short:'메모', icon:FileText, group:'기록' },
  { id:'settings', label:'설정 · 함께하기', short:'설정', icon:SettingsIcon, group:'설정' },
  { id:'admin', label:'회원 관리', short:'관리', icon:ShieldCheck, group:'설정', admin:true }
];
export const headings:Record<View, [string, string, string]> = {
  dashboard:['OUR WEDDING JOURNEY', '둘이 만드는, 우리의 결혼', '중요한 일정과 준비 상황을 한눈에 확인해요.'],
  agent:['YOUR PERSONAL PLANNER', '곁에 있는 웨딩플래너', '일정부터 예산, 업체 비교까지 함께 정리해요.'],
  tasks:['CHECKLIST', '준비 체크리스트', '작은 할 일을 하나씩, 빠뜨리는 일 없이.'],
  budgets:['BUDGET', '예산 관리', '예정 금액과 실제 지출, 지급 내역을 한곳에.'],
  vendors:['VENDORS', '업체 비교', '마음에 드는 업체를 모으고 꼼꼼히 비교해요.'],
  guests:['GUESTS', '하객 관리', '초대할 분들과 참석 여부를 편하게 정리해요.'],
  timeline:['WEDDING DAY', '본식 타임라인', '그날의 흐름을 함께하는 사람들과 나눠요.'],
  materials:['LIBRARY', '자료 보관함', '참고 자료와 계약 문서를 다시 찾기 쉽게.'],
  notes:['NOTES', '우리의 메모', '잊고 싶지 않은 생각과 결정들을 남겨요.'],
  settings:['SETTINGS', '설정 · 함께하기', '기본 정보와 함께 쓰는 사람, 내 계정을 관리해요.'],
  admin:['ADMIN', '회원 관리', '가입 신청을 승인하고 계정을 관리해요.']
};
export const taskStatus = { todo:'예정', doing:'진행 중', done:'완료' } as const;
export const vendorStatus = { researching:'알아보는 중', contacted:'상담 완료', booked:'계약 완료' } as const;
export const rsvpLabels = { pending:'확인 전', yes:'참석', no:'불참' } as const;
export const guestSides = { bride:'신부측', groom:'신랑측', other:'공통' } as const;
export const collectionName:Record<Collection, string> = { tasks:'할 일', budgets:'예산 항목', vendors:'업체', guests:'하객', timeline:'일정', notes:'메모' };

export interface Planner {
  data:Bootstrap; state:PlanState; blocked:boolean; busy:boolean; chatBusy:boolean; isAdmin:boolean;
  navigate(view:View):void; ask(message:string):void;
  draft:string; setDraft(value:string):void; sendChat(message?:string):Promise<void>;
  saveItem(collection:Collection, item:Item, success?:string):Promise<boolean>;
  removeItem(collection:Collection, item:Item):Promise<boolean>;
  saveSettings(settings:Settings):Promise<boolean>;
  setState(state:PlanState):void; setWorkspace(workspace:WorkspaceInfo):void; setData(update:(data:Bootstrap) => Bootstrap):void;
  run<T>(task:() => Promise<T>, success?:string):Promise<T|undefined>;
  notify(message:string):void;
  openEditor(collection:Collection, item?:Item):void; confirmRemove(collection:Collection, item:Item):void;
}
export const PlannerContext = createContext<Planner|null>(null);
export function usePlanner() { const value = useContext(PlannerContext); if (!value) throw new Error('PlannerContext missing'); return value; }
