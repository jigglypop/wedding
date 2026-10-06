import type { PlanState } from '../src/types';

// Generic starter plan for newly approved couples. Written for this app; it does not reuse the private Notion guides.
const tasks:[string, string, number][] = [
  ['예산 범위와 우선순위 합의', '합의·예산', -365], ['예식 날짜·시간 후보 정하기', '예식장', -330], ['양가 인사와 상견례 일정 잡기', '가족', -300],
  ['웨딩홀 투어와 견적 비교', '예식장', -300], ['웨딩홀 계약', '예식장', -270], ['스튜디오·드레스·메이크업 비교', '스드메', -240],
  ['스드메 계약', '스드메', -210], ['본식 스냅·영상 업체 예약', '촬영', -180], ['신혼여행지 결정과 항공·숙소 예약', '허니문', -180],
  ['신혼집 계약과 입주 일정 확인', '신혼집', -150], ['드레스 투어', '스드메', -150], ['예복 맞춤 또는 대여', '예복', -120],
  ['예물·예단 범위 협의', '가족', -120], ['웨딩 촬영', '촬영', -120], ['가전·가구 목록 정리와 구매', '혼수', -90],
  ['한복 준비(혼주 포함)', '예복', -90], ['청첩장 디자인과 주문', '초대', -75], ['모바일 청첩장 제작', '초대', -60],
  ['하객 명단 정리', '하객', -60], ['사회자·축가 섭외', '본식', -60], ['혼주 헤어·메이크업 예약', '본식', -45],
  ['청첩장 전달과 모임 일정', '초대', -45], ['본식 순서 확정', '본식', -30], ['부케·부토니에 준비', '본식', -30],
  ['웨딩홀 최종 미팅(보증 인원·메뉴)', '예식장', -14], ['잔금·답례품·도우미 비용 정리', '합의·예산', -7], ['본식 당일 준비물 점검', '본식', -3],
  ['신혼여행 짐 꾸리기', '허니문', -2], ['감사 인사와 축의금 정리', '마무리', 7], ['혼인신고', '행정', 14]
];
const budgets:[string, string][] = [
  ['웨딩홀 대관료', '예식장'], ['식대', '예식장'], ['스튜디오 촬영', '스드메'], ['드레스', '스드메'], ['헤어·메이크업', '스드메'],
  ['본식 스냅', '촬영'], ['본식 영상', '촬영'], ['예복', '예복'], ['한복', '예복'], ['예물', '예물·예단'], ['청첩장', '초대'],
  ['부케', '본식'], ['사회·축가', '본식'], ['신혼여행', '허니문'], ['가전', '혼수'], ['가구', '혼수'], ['답례품', '본식'], ['예비비', '합의·예산']
];

export function starterState():PlanState {
  const now = new Date().toISOString();
  return {
    version:1, updatedAt:now, settings:{ coupleNames:'', weddingDate:'', venue:'', totalBudget:0, guestTarget:0 },
    tasks:tasks.map(([title, category, day], index) => ({ id:`starter-task-${index + 1}`, title, category, dueDate:'', status:'todo' as const, notes:`권장 시기: 예식일 기준 D${day < 0 ? '-' : '+'}${Math.abs(day)}. 실제 계약·촬영 일정이 정해지면 그 날짜를 우선해 주세요.` })),
    budgets:budgets.map(([title, category], index) => ({ id:`starter-budget-${index + 1}`, title, category, planned:0, actual:0, paid:0, notes:'' })),
    vendors:[], guests:[], timeline:[], notes:[], activity:[], conversations:[]
  };
}
