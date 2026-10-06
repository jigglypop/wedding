import json, re, hashlib, shutil, mimetypes
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'
ASSETS=DATA/'assets'
ASSETS.mkdir(parents=True,exist_ok=True)
STAMP='2026-10-06T00:00:00.000Z'
COPYRIGHT='원본 작성자: 리밍 @wedding_liming. 원본 안내: 파일 재배포·복제·타인 공유·판매 금지. 개인 준비 자료로 사용하며 원본 Notion 출처를 보존합니다.'
notion=json.loads((DATA/'notion-source.json').read_text(encoding='utf-8'))
choices=json.loads((DATA/'notion-choice-pages.json').read_text(encoding='utf-8'))
books=json.loads((DATA/'local-spreadsheets.json').read_text(encoding='utf-8'))

def sid(url):
    tail=url.split('/')[-1].split('?')[0].replace('-','')
    return 'notion-'+tail

def clean_title(value):
    return re.sub(r'^[^A-Za-z0-9가-힣]+','',value or '').strip()

def category(title):
    if re.search('허니문|여행|Travel|신행',title,re.I):return '허니문'
    if re.search('가전|가구|생활용품|주방|데코|배송|신혼집|청소|이사|입주|침구|욕실',title):return '혼수·신혼집'
    if re.search('웨딩홀|예식장|홀 유형',title):return '웨딩홀'
    if re.search('포인트|캐시백|카드|지급|정산|블로그|서포터즈|혜택',title):return '혜택·정산'
    if re.search('드레스|촬영|스드메|메이크업|예복|한복|피팅',title):return '촬영·스드메'
    if re.search('식순|서약|영상|본식|청첩|초대|축가|사회|혼주|하객',title):return '초대·본식'
    if re.search('예산|가계부|합의|질문|결혼 전|상견례|기본설정|날짜',title):return '합의·예산'
    return '준비 관리'

def text_body(page):
    text=page.get('text','')
    match=re.search(r'<content>\s*([\s\S]*?)\s*</content>',text)
    return match.group(1) if match else text

def row_text(row):
    pairs=[]
    for key,value in row.items():
        if key in ['url','createdTime'] or key.endswith(':is_datetime') or not value:continue
        if isinstance(value,str) and value.startswith(('formulaResult://','rollupResult://')):continue
        if isinstance(value,str) and value.startswith('["https://app.notion.com'):continue
        if value=='__NO__':value='미확정/미완료'
        elif value=='__YES__':value='원본 체크됨'
        pairs.append(key+': '+str(value))
    return '\n'.join(pairs)

materials=[]
pages=[notion['root']]+notion['pages']+choices
seen=set()
for page in pages:
    if page.get('metadata',{}).get('type')!='page':continue
    url=page.get('url') or page.get('requestedUrl')
    mid=sid(url)
    if mid in seen:continue
    seen.add(mid)
    title=clean_title(page.get('title','Notion 자료'))
    body=text_body(page)
    summary=title+'의 준비 기준과 작성 양식입니다.'
    materials.append({'id':mid,'title':title,'kind':'guide','category':category(title),'summary':summary,'content':body+'\n\n'+COPYRIGHT,'sourceUrl':url,'sourceType':'notion'})

source_lookup={}
for page in notion['pages']:
    for match in re.finditer(r'<data-source url="(?:\{\{)?(collection://[a-f0-9-]{36})',page.get('text','')):
        source_lookup[match.group(1)]=page
    if page.get('requestedUrl','').startswith('collection://'):
        source_lookup[page['requestedUrl']]=page

for database in notion['databases']:
    url=database['sourceUrl']
    page=source_lookup.get(url,{})
    title=clean_title(page.get('title','연결 자료 표'))
    if title=='새 데이터베이스':
        keys=set().union(*(x.keys() for x in database.get('results',[])))
        if '역할·동선' in keys:title='식순 역할 분담표'
        elif '설명' in keys:title={'collection://f391264d-bfae-83cf-9fa6-87ad0c807a01':'웨딩촬영 준비 시작 체크리스트','collection://e171264d-bfae-831c-9727-87a6fe26a75e':'촬영 하루 전날 체크리스트','collection://5981264d-bfae-8286-aa2d-07e0ffcd60f5':'촬영 당일 준비물 체크리스트'}.get(url,'촬영 준비물 상세 목록')
        elif '모임 이름' in keys:title='청첩 모임 관리표'
    mid=sid(url)
    rows=database.get('results',[])
    public_url=page.get('url') or page.get('requestedUrl') or url
    material={'id':mid,'title':title,'kind':'guide','category':category(title),'summary':f'{len(rows)}개 항목이 있는 원본 관리표입니다. 예시와 미정 입력값을 구분합니다.','content':'\n\n'.join(row_text(x) for x in rows)+'\n\n'+COPYRIGHT,'sourceUrl':public_url,'sourceType':'notion'}
    if mid not in seen:materials.append(material);seen.add(mid)

for i,book in enumerate(books,1):
    filename=f'wedding-workbook-{i:02d}'+Path(book['filename']).suffix.lower()
    shutil.copy2(ROOT/book['filename'],ASSETS/filename)
    body=[]
    for sheet in book['sheets']:
        if not sheet['rows']:continue
        body.append('시트: '+sheet['title'])
        for row in sheet['rows']:
            values=[]
            for cell in row['cells']:
                value=cell['value']
                if isinstance(value,str) and value.startswith('='):continue
                values.append(cell['cell']+': '+str(value))
            if values:body.append(' | '.join(values))
    title=clean_title(re.sub(r'^TalkFile_','',Path(book['filename']).stem))
    materials.append({'id':book['id'],'title':title,'kind':'file','category':category(title),'summary':'원본 엑셀 양식입니다. 확정 금액·일정 입력 전 템플릿이며 참고 가격은 당시 안내입니다.','content':'\n'.join(body),'filename':filename,'originalFilename':book['filename'],'sourceType':'local-spreadsheet','mimeType':mimetypes.guess_type(filename)[0] or 'application/octet-stream'})

images=[
('KakaoTalk_20261005_214600784.jpg','Direct 결혼준비 체크리스트 1','웨딩홀·스드메·허니문 항목과 추가금 점검. 작성일 2026-08-13. 가격·혜택은 자료 당시 안내이며 현재 견적 미확정.','홀 대관·꽃장식·식대·수모·2부 진행 포함 범위 확인. 스튜디오 기본앨범·액자·원본/수정본·페이지 추가·액자 업그레이드·셀렉과 출고일을 확인. 드레스 촬영/본식 구성, 투어 피팅비, 헬퍼비, 출장비, 2부 드레스 및 재피팅 비용 확인. 메이크업 담당 지정·얼리·헤어피스·네일·지방출장 추가금 확인. 허니문 항공·숙박·여행코스 취소 조건 확인.'),
('KakaoTalk_20261005_214631972.jpg','Direct 결혼준비 체크리스트 2','본식 상품·혼수·신혼집 항목별 계약과 수령 점검. 작성일 2026-08-13.','본식 스냅은 메인 작가 인원·수정비·셀렉비·작가지정비·출장비·추가촬영 및 납품일 확인. DVD는 화질·촬영 인원·카메라·출장비·납품일 확인. 사회자·연주·축가·폐백은 진행 구성과 담당자 확정. 부케는 꽃 종류·코사지 수량·배송 장소와 시점 확인. 청첩장 샘플·수량·모바일·할인 포함을 확인. 예복·한복은 촬영/본식 대여 구성, 예물은 디자인·납기·금액 확인. 가전·가구·청소·이사·인터넷 혜택은 업체의 현재 서면 조건 확인.'),
('KakaoTalk_20261005_214707152.jpg','Direct 드레스 투어 Q&A','투어·촬영 드레스·본식 가봉·재피팅·2부 드레스 안내.','투어는 샵 비교·선택 단계이고 촬영 드레스와 본식 드레스 선택은 별도 예약 단계. 지퍼형 드레스는 본식 전 별도 가봉 확인이 필요할 수 있음. 지정 후 샵 변경과 투어 예약 취소 시 위약금 여부를 계약서로 확인. 재피팅은 별도 예약과 비용 발생. 2부 드레스 피팅 가능 수와 미진행 피팅비·헬퍼 추가금·취소 조건을 계약 전에 확인.'),
('KakaoTalk_20261006_160040416.png','Direct 포인트 계정 승인 안내','포인트 계정 승인 처리 화면 참고. 로그인 화면 이름은 플래닝 설정으로 가져오지 않습니다.','포인트 담당자의 계정 승인 이후 포인트 사이트를 이용할 수 있다는 화면. 안내에는 계정 승인까지 최대 24시간 소요 가능이라고 표시됨. 계정 승인과 활동별 적립 승인은 별도 단계.'),
('KakaoTalk_20261006_160040416_01.jpg','Direct 소개 가입 포인트 신청','포인트 적립 신청 화면과 증빙 입력 참고.','포인트 신청에서 적립 신청을 선택하고 포인트 구분·추천인·증빙자료를 입력하는 예시 화면. 예상 적립 포인트는 사용자 실제 잔액이나 확정 입금이 아님. 신청 후 승인 상태를 별도로 확인.'),
('KakaoTalk_20261006_160040416_02.jpg','Direct 잔여 포인트 환급 안내','예식·잔금 정산 후 포인트 환급 신청 참고.','자료에는 서포터즈 회원의 예식 후 잔여 포인트 환급, 5만 포인트 이상 신청, 3.3% 공제라고 안내되어 있음. 환급 신청 입력 양식은 빈 양식이며 실제 환급액은 미정. 현재 적용 조건과 과세 처리는 업체 최신 안내로 확인.'),
('KakaoTalk_20261006_160040416_03.jpg','Direct 캐시백 신청 안내','제휴 업체 완납 이후 캐시백 신청과 포인트 전환 참고.','자료에는 제휴업체 잔금까지 완납 후 캐시백 신청, 웨딩홀은 예식 진행 후 신청, 수수료 입금 이후 처리로 최대 15일 소요 가능이라고 안내됨. 신랑·신부 이름, 예식일, 업체명, 총 계약금액을 적는 양식. 승인 캐시백은 스드메 비용 차감용 포인트로 전환된다는 자료 설명이며 실제 지급 확정이 아님.'),
('KakaoTalk_20261006_160041587.jpg','Direct 포인트 적립 사용 가이드','회원가입·서포터즈 신청·활동·승인·사용·환급 흐름.','웨딩 계약 후 포인트 사이트 가입 및 서포터즈 등급 신청. 가이드북을 따라 활동하고 증빙과 함께 포인트 적립 신청. 검수 승인 후 적립 완료까지 1~2주 이상 소요할 수 있다고 안내. 제휴 스드메·부케·본식스냅 등의 사용 가능 여부를 플래너에게 확인. 예식 후 환급 조건은 최신 공식 안내 확인. 예상 포인트는 가용 현금으로 예산에 선반영하지 않음.'),
('KakaoTalk_20261006_160043895.png','Direct 서포터즈 등업 안내','서포터즈 활동과 포인트 적립 제도 소개 화면.','서포터즈 활동을 통한 포인트 적립과 경험 공유를 소개하는 참고 화면. 대상·등업 조건·활동별 적립 조건·광고 표시·사진 사용권·시간 부담을 확인 후 참여 여부 선택. 자료 화면만으로 사용자의 가입·승인·적립액을 확정하지 않음.'),
('KakaoTalk_20261006_160053132.jpg','메이크업 시간과 지정비 안내','신부 약 3시간·신랑 약 30분 예시와 담당 지정비 안내.','자료는 신부 메이크업 2시간30분+피팅30분 총3시간, 신랑 메이크업 약30분으로 안내. 신랑·신부는 별도 공간과 별도 스태프일 수 있음. 지정비는 자료에 5만5천~11만원 샵별 차이라고 기재. 실제 시작·종료·이동 시간과 지정비는 예약한 샵에 확인하여 본식 동선에 반영.'),
('KakaoTalk_20261006_160056448.webp','한 장으로 보는 웨딩 준비 흐름','홀 조사부터 투어·촬영·입주·본식까지 순서와 결제 참고.','위치·예산·보증인원·날짜·시간대 합의, 홀 조사·상담·방문·계약. 이후 본식스냅/DVD·허니문 예약, 드레스 투어와 촬영 가봉, 예복·예물·헤어변형 준비, 촬영과 셀렉, 입주2~3개월 전 가전·가구·청소·이사 준비, 본식 가봉과 최종 점검. 결제 예시: 최초계약금30~50만원, 촬영한달전 중도금80%, 본식2주전 나머지20%. 이는 업체 안내 예시이며 사용자 계약 조건은 별도 확인. 헤어변형·식전영상·포토테이블·본식스냅/원판·DVD 구분 참고.'),
('KakaoTalk_20261006_160103736.jpg','드레스 비교 기록 양식 1','샵별 피팅 드레스 실루엣과 세부 요소 기록 양식.','두 샵 드레스 피팅 후 실루엣·네크라인·소매·소재·트레인·장식·느낌과 선택 메모를 기록하는 빈 비교 양식. 실제 드레스 선택 결과는 입력되지 않음.'),
('KakaoTalk_20261006_160103736_01.jpg','드레스 비교 기록 양식 2','피팅 드레스 1·2 비교와 평가 메모 양식.','샵 이름과 피팅 드레스별 형태·넥라인·소매·소재·트레인·메모를 비교하는 빈 드레스 기록 양식. 실제 사용자 선호나 선택값은 미입력.'),
('KakaoTalk_20261006_160103736_02.jpg','드레스 비교 기록 양식 3','피팅 드레스 3·4 비교와 평가 메모 양식.','피팅 드레스 추가 후보별 디자인과 상세 요소를 비교하고 장단점·선택 이유를 기록하는 빈 드레스 기록 양식. 실제 선택값은 미입력.'),
('KakaoTalk_20261006_160120924.jpg','본식 드레스 피팅 체크','피팅 예약·비교·속옷·액세서리·재피팅 주의사항.','본식 드레스 피팅은 샵이 정한 예약시간을 지키고 늦을 경우 즉시 연락. 홀드 드레스와 비교 드레스의 상태·라인·가격·서비스 포함 여부 확인. 화이트/스킨톤 속옷과 끈 없는 형태 준비 여부를 상담. 코사지·티아라·베일을 조합하여 어울림을 확인. 레이스 촉감·안전한 움직임·피팅감 확인. 재피팅 비용과 드레스 사용 기간·반납 조건은 업체에 확인.'),
('KakaoTalk_20261006_160120924_01.jpg','드레스 투어 준비 체크','샵 선택·가봉·추가금·피팅비·촬영 제한 점검.','드레스 한 벌보다 샵 전체 분위기·스타일·당사자 체형과 취향의 적합성을 비교. 투어 당시 드레스는 촬영용 선택과 별개이며 본식 선택은 별도 일정. 샵 변경 위약금·재피팅 비용·소재/컬러/프리미엄 라인 추가금과 홀딩 조건 확인. 속옷은 샵 상담 후 준비. 피팅비의 현금/카드 가능 여부와 이동시간을 확인. 자료의 투어 약45~50분·4벌은 안내 예시이며 업체별 실제 조건 확인. 사진 촬영 가능 여부를 사전 확인.')
]
for i,(original,title,summary,body) in enumerate(images,1):
    filename=f'wedding-reference-{i:02d}'+Path(original).suffix.lower()
    shutil.copy2(ROOT/original,ASSETS/filename)
    materials.append({'id':f'image-{i:02d}','title':title,'kind':'image','category':category(title),'summary':summary,'content':body+'\n이미지 육안 확인을 통한 요약이며 전체 OCR 전사가 아닙니다. 원본 이미지를 함께 확인하세요.','filename':filename,'originalFilename':original,'sourceType':'local-image','mimeType':mimetypes.guess_type(filename)[0] or 'image/jpeg'})

schedule=next(x['results'] for x in notion['databases'] if x['sourceUrl']=='collection://f8143fa4-0234-46dd-815d-89da1f1ae5be')
budget_rows=next(x['results'] for x in notion['databases'] if x['sourceUrl']=='collection://bd9dc8fe-25aa-4d01-9c4e-3672c7465b71')
materials_by_id={x['id']:x for x in materials}
tasks=[]
for row in sorted(schedule,key=lambda x:(x.get('준비 시기',''),{'먼저':0,'다음':1,'여유':2}.get(x.get('중요도'),3),-x.get('D-일수',0))):
    d=row.get('D-일수')
    timing=('D-'+str(d)) if d is not None and d>=0 else ('D+'+str(-d)) if d is not None else '미정'
    source=sid(row.get('관련 안내',''))
    if source not in materials_by_id:source=sid('collection://f8143fa4-0234-46dd-815d-89da1f1ae5be')
    notes=f"{row.get('준비 시기','')} · 중요도 {row.get('중요도','')} · {row.get('구분','')}\n권장 초안: 예식일 기준 {timing}. 기준일: {row.get('기준일','예식일')}. 실제 계약·촬영·입주·출국 일정이 있으면 실제 마감을 우선합니다.\n선행 조건: {row.get('선행 조건','')}\n완료 기준: {row.get('완료 기준','')}"
    tasks.append({'id':'task-'+row['url'].split('/')[-1],'title':row['할 일'],'category':row.get('단계','준비 관리'),'dueDate':row.get('date:실제 마감:start',''),'status':{'할 일':'todo','진행':'doing','완료':'done'}.get(row.get('상태'),'todo'),'notes':notes,'sourceId':source})

local_by_name={b['filename']:b['id'] for b in books}
extras=[
('부케·부토니아·코사지 도착과 배분 확인','예식장 또는 메이크업샵 배송 장소, 부케·부토니아·코사지 수량과 배분 담당을 확인합니다.'),
('헬퍼 도착 시간과 이동 동선 확인','메이크업샵 도착, 드레스 착용, 차량 이동, 예식장 인계까지 업체와 확인합니다.'),
('양가 혼주 도착과 장갑·코사지 확인','예식장 제공 품목과 개인 준비 품목을 구분하고 도착 시간을 공유합니다.'),
('액자·포토테이블 사진 수령과 전달','원본 본식점검표의 사전 수령 권장에 따라 실제 스튜디오 수령·식장 전달 마감을 확인합니다.'),
('혼인서약문·성혼선언문 출력본 준비','예식장 준비 여부를 확인하고 사회자와 같은 최종본을 사용합니다.'),
('방명록·필기구·식권 수량 준비','예식장 제공 여부, 수량, 배부·회수 담당과 보관 위치를 확인합니다.'),
('본식 촬영팀 도착과 촬영 범위 확인','메이크업씬·원판 선촬영 여부, 대기실·단체촬영·폐백 촬영 포함 범위와 도착 시간을 확인합니다.'),
('본식 영상팀 도착과 촬영 범위 확인','메이크업씬 촬영 여부, 추가카메라·추가시간과 출장비, 결과물 납품일을 확인합니다.'),
('사회자·주례·연주자 도착 시간 확인','원본 점검표의 도착 예시는 참고이며 실제 식장 리허설·본식 시작에 맞추어 도착·연락망을 확정합니다.'),
('폐백 진행과 음식·의상·도우미 확인','폐백을 선택한 경우에만 음식·의상·수모·추가 헬퍼비·배송·보관·잔금을 확인합니다.'),
('예식 전날 차량·지갑·소품 최종 점검','예식장 도착과 공항 이동 차량, 지갑·소품·사례비·개인 물품을 체크합니다.')
]
for i,(title,notes) in enumerate(extras,1):
    source=local_by_name['웨딩하루전체크.xlsx'] if i==11 else local_by_name['본식점검표.xls']
    tasks.append({'id':f'task-local-day-{i:02d}','title':title,'category':'초대·본식','dueDate':'','status':'todo','notes':'D-7~D-day 세부 점검. 실제 마감 미정.\n'+notes,'sourceId':source})
for i,(title,notes) in enumerate([('허니문 선물 대상과 예산 정하기','원본 D-20 준비 목록. 가족·친지·친구에게 필요한 선물 여부와 예산을 여행 경비 안에 계획합니다.'),('결혼휴가와 업무 인수인계 확인','원본 D-20 및 D-2 준비 목록. 직장 규정에 맞추어 휴가 신청과 업무 인수인계를 확인합니다.')],1):
    tasks.append({'id':f'task-local-prep-{i:02d}','title':title,'category':'여행' if i==1 else '합의·예산','dueDate':'','status':'todo','notes':notes,'sourceId':local_by_name['혜선실장결혼준비리스트 (1).xls']})

budgets=[]
for row in budget_rows:
    title=re.sub(r'[^\w가-힣 ·/()+&-]','',row['항목']).strip()
    notes='금액 미정: 화면의 0은 입력 대기값이며 확정 0원 또는 납부 완료를 뜻하지 않습니다.\n'+row.get('메모','')
    if row.get('분류')=='혼수':notes+='\n기존 보유품·임대 옵션 확인 후 필요한 품목에만 예산을 배정합니다.'
    budgets.append({'id':'budget-'+row['url'].split('/')[-1],'title':title,'category':row.get('분류','기타'),'planned':0,'actual':0,'paid':0,'notes':notes,'sourceId':sid('collection://bd9dc8fe-25aa-4d01-9c4e-3672c7465b71')})

state={'version':1,'updatedAt':STAMP,'settings':{'coupleNames':'','weddingDate':'','venue':'','totalBudget':0,'guestTarget':0},'tasks':tasks,'budgets':budgets,'vendors':[],'guests':[],'timeline':[],'notes':[],'activity':[],'conversations':[]}
gaps=[
    '원본 자료에는 확정 예식일·커플 이름·총예산·하객 수·사용자 계약금액·실제 지급이 입력되어 있지 않습니다.',
    'Notion 링크에 포함된 외부 PPT·영상·외부 이미지 파일과 QR 연결 서비스는 별도 파일로 다운로드하지 않았습니다. 원본 링크를 보존했습니다.',
    'Notion 표의 formulaResult/rollupResult URI는 계산값으로 해석하지 않았습니다. 실제 미입력 값을 0원 확정이나 완료로 처리하지 않았습니다.',
    '이미지 16개는 모두 육안 확인 후 핵심 내용을 요약했습니다. 전체 OCR 전사와 작은 글씨·QR 목적지의 자동 추출은 수행하지 않았습니다.',
    'XLS는 셀의 캐시 값을 읽었습니다. 원본 수식·스타일·체크박스와 그림은 원본 다운로드 파일에 보존되며 JSON에 모든 형태를 복제하지 않았습니다.',
    '업체 가격·할인·포인트 조건·카드 혜택·여행 입국조건은 자료 당시 안내입니다. 현재 공식 조건과 확정 견적은 별도 확인이 필요합니다.',
    '노션 표에 있는 작성자 예시 완료·여행 예약·청첩 모임 사례·후보 웨딩홀·예산대는 사용자 실제 계약·완료·지출로 가져오지 않았습니다.'
]
extracted={'version':1,'retrievedAt':STAMP,'provenance':{'notionRoot':notion['root']['url'],'copyright':COPYRIGHT,'privateUse':True,'originalsPreserved':True},'counts':{'notionPages':len([m for m in materials if m['sourceType']=='notion' and not m['id'].startswith('notion-collection')])-26,'notionDatabases':len(notion['databases']),'notionRows':sum(len(d.get('results',[])) for d in notion['databases']),'spreadsheets':len(books),'images':len(images),'materials':len(materials),'initialTasks':len(tasks),'initialBudgetItems':len(budgets)},'importGaps':gaps,'checklist':tasks,'budgetItems':budgets,'guidanceReferences':[{'id':m['id'],'title':m['title'],'category':m['category'],'sourceUrl':m.get('sourceUrl'),'originalFilename':m.get('originalFilename')} for m in materials]}
extracted['counts']['notionPages']=len([m for m in materials if m['sourceType']=='notion'])-len(notion['databases'])
for name,obj in [('materials.json',materials),('initial-state.json',state),('source-extracted.json',extracted)]:
    (DATA/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(extracted['counts'],ensure_ascii=False))
