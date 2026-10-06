# 컷툰 제작 AI 코파일럿

기업 연계 프로젝트. 4컷 컷툰 생성 코파일럿.

골든패스: 온보딩(레퍼런스 업로드 → 스타일 추출 → 스타일 확인·재추출 → 상세 입력 확인 → 캐릭터 시트 → 프리셋 저장) → 세션(소재 입력 → 브레인스토밍 3턴 → 표지 3안 → 나머지 3컷) → 에디터(대사 수정 · 되돌리기 → Export ZIP).

## 문서

| 문서 | 담는 것 | 변경 권한 |
| --- | --- | --- |
| [`PRD.md`](./PRD.md) | 제품 요구사항 · 제약 · 제외 기능 · 아키텍처 결정 | chictimin 승인 (5-1절 의존성 목록은 예외 — 승인 불필요) |
| `README.md` (이 문서) | 스택 · 폴더 소유권 · 브랜치 · git 규칙 | chictimin 승인 |
| `spec/*.schema.json` | 데이터 계약(필드·enum) | chictimin 승인 |
| [`docs/pipeline.md`](./docs/pipeline.md) | 온보딩→세션→에디터 호출 순서 · 소유 경계 · 파이프라인 사실 정리 | chictimin 승인 |
| [`docs/gate-evidence/`](./docs/gate-evidence/) | P0 게이트(캐릭터 동일성 · 말풍선 억제) 판정 근거 이미지 | chictimin 승인 |
| `spec/data/*.json`(`cta_presets.json`·`narrative-flow.json`·`style-vocabulary.json`) | 값 목록 데이터 파일(CTA 문구 · 서사 흐름 템플릿 · 스타일 키워드 매핑) | chictimin 승인 |
| `spec/vocabulary.json` | enum별 프롬프트 힌트(영문 서술) | chictimin 승인 |

**구현 전에 `PRD.md`를 확인한다.** 개인 로컬 문서(각자의 PRD 초안·노트)는 정본이 아니다.

## 2차 일정 · 팀

09-30(수) 시작 → 10-14(수) 기능 동결 → 10-15(목) 마감 → 10-16(금) 발표. 10-09(한글날) 휴일, 작업일 11일.

| 팀원 | 맡는 곳 |
| --- | --- |
| chictimin | 스키마 · 데이터 계약 · LLM · 백엔드 (`spec/` 변경 승인권자) |
| JEON-DAEJIN | 화면 전체 |
| joniverse-ai | 이미지 생성 · 추출 · 캐릭터 시트 |
| smartman3514-commits | 렌더링 버그 수정 + QA 검증(모든 기능·버그 PR의 머지 전 동작 확인) |

## 시작하기

```
npm install
npm run dev              # 개발 서버
npm run build            # 머지 전 빌드 확인
npm start                # 프로덕션 실행
npm run lint             # 린트
npm run spec:sync-check  # 스키마 · 데이터 정합 검사
```

`.env`는 저장소에 없다(추적 제외). 팀 내부 채널로 전달받는다. 필수 환경변수는 `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 세 개다. 선택 변수는 `IMAGE_PROVIDER` — 비우면 `openai`, 개발·QA 비용 절감용 `openai-low`(#190), 로컬 ComfyUI로 그리는 개발 테스트 전용 `comfyui`(#226, `COMFYUI_*` 변수 필요). P0 판정·발표·최종 회귀는 `openai`로만 한다. 키 이름은 `.env.example` 참고. 이미지 생성 테스트는 `OPENAI_API_KEY`를 각자 개인 키로 바꿔 쓴다.

### Supabase 셋업

새 Supabase 프로젝트로 갈아타거나 처음 셋업할 때는 아래 둘 다 필요하다. 테이블만 만들고 버킷을 빠뜨리면 업로드와 이미지 읽기가 통째로 실패한다(`Bucket not found`, issue #67).

1. **테이블** — `lib/db/schema.sql`을 Supabase SQL Editor에서 실행
2. **Storage 버킷** — `assets` 버킷을 **public으로** 생성 (`lib/asset-store.ts`의 `getAssetUrl()`이 `getPublicUrl()`을 쓰기 때문이다)

## 스택

| 영역 | 선택 |
| --- | --- |
| 앱 | Next.js 16 (App Router) · React 19 · TypeScript |
| 컷 생성 | OpenAI Responses API — 텍스트 모델 `gpt-5` + image_generation 도구 (`lib/openai/generate.ts:19`) |
| 캐릭터 시트 | `gpt-image-1` (`lib/openai/extract.ts:213`) |
| 텍스트(브레인스토밍 · 스타일 추출) | `gpt-4o` (`lib/llm/brainstorm.ts:137`, `lib/openai/extract.ts:92`) |
| DB · 스토리지 | Supabase |
| 렌더 합성 | sharp (`lib/render/`) |

## 폴더 구조와 소유권

```
cuttoon-copilot/
├─ app/
│  ├─ (studio)/                화면 전체                      JEON-DAEJIN
│  │   ├─ page.tsx             프로젝트 목록
│  │   ├─ onboarding/          온보딩 + 프리셋 생성
│  │   ├─ session/[id]/        소재 입력 → 3안 → 4컷 완성
│  │   ├─ editor/[id]/         대사 수정 · 드래그 · 되돌리기
│  │   └─ projects/            세션 목록
│  └─ api/
│      ├─ preset/              프리셋 CRUD                    chictimin
│      ├─ session/             세션 관리 · Export             chictimin
│      ├─ upload/              레퍼런스 업로드                chictimin
│      ├─ brainstorm/          브레인스토밍 3턴                chictimin
│      ├─ generate/            이미지 생성                    joniverse-ai
│      └─ extract/             스타일 추출                    joniverse-ai
├─ lib/
│  ├─ asset-store.ts           업로드 검증 · Storage 저장      chictimin
│  ├─ llm/                     브레인스토밍 3턴 · 캡션         chictimin
│  ├─ openai/
│  │   ├─ generate.ts          컷 생성 (멀티턴 세션 관리)      joniverse-ai
│  │   ├─ extract.ts           레퍼런스 VLM 추출 · 시트 생성   joniverse-ai
│  │   └─ provider.ts          ImageProvider 인터페이스        joniverse-ai
│  ├─ render/                  텍스트 레이어 합성 · ZIP        smartman3514-commits
│  └─ db/                      Supabase 클라이언트 · 쿼리      chictimin
├─ spec/                       계약 (변경은 chictimin 승인)    chictimin
│  ├─ preset.schema.json
│  ├─ storyboard.schema.json
│  ├─ vocabulary.json          계약 ⑤ 어휘 사전
│  ├─ data/                    값 목록 데이터
│  └─ samples/                 샘플 응답 JSON + 이미지
└─ public/
   └─ demo-cache/              발표용 캐시 폴백 (예정 — 아직 없음)
```

| 담당 | 폴더 · 파일 | 역할 |
| --- | --- | --- |
| chictimin | `spec/`, `lib/llm/`, `app/(studio)/session/[id]/storyboard-assembly.ts`(컷 대사·연출 상수, #152), `app/api/brainstorm/`, `app/api/preset/`, `app/api/session/`, `app/api/upload/`, `lib/db/`, `lib/asset-store.ts` | 스키마 · 데이터 계약 · LLM · 백엔드. 데이터 계약(`spec/`) 변경 승인권자 |
| JEON-DAEJIN | `app/(studio)/` (단 `session/[id]/storyboard-assembly.ts`는 제외) | 화면 전체 |
| joniverse-ai | `lib/openai/`, `app/api/generate/`, `app/api/extract/` | 이미지 생성 · 추출 · 캐릭터 시트 |
| smartman3514-commits | `lib/render/` | 렌더링 버그 수정(#105, #169, #170) + QA 검증 |

1차에는 A①~B③ 6파트 체제였다. `docs/pipeline.md`는 각자 자기 영역 절을 고친다. `public/demo-cache/`는 아직 만들어지지 않았고 담당도 미정이다.

## 브랜치 · git 규칙

1. main 직접 push 금지, PR로만
2. `npm run build` 확인 후 머지, 조금씩 자주
3. 되감기(rebase·force-push)는 본인 브랜치만, main은 그대로
4. DB 구조 변경(`lib/db/`)은 chictimin 승인
5. `.env`는 커밋하지 않는다(저장소 추적 제외)
6. 마감(10-15) 전에 태그 하나 찍고 멈추기, 이후 수정 시 태그 새로
7. 스텁 3규칙(#60): ① 스텁 표식 유지(`stub:true`, `asset://stub/` · `asset://mock/`) ② 실패 가시화(조용히 성공처럼 보이지 않게) ③ PR 본문에 스텁 명시

## 구현 현황

골든패스 각 단계가 지금 어디까지 됐는지. **main에 머지된 것만** 센다 — 열려 있는 PR이나 작업 브랜치 코드만으로 완료 처리하지 않는다.

| 단계 | 로직 · API | 화면 | 상태 | 관련 이슈 |
| --- | --- | --- | --- | --- |
| 1. 레퍼런스 업로드 | `POST /api/upload` · `lib/asset-store.ts` (10MB · png/jpeg/webp, #68 확정) | 연결됨 | 완료 | #68 |
| 2. 스타일 추출 | `lib/openai/extract.ts` (실제 호출) | 연결됨 | 완료 | — |
| 3. 프리셋 자동 확정 | `lib/llm/preset-guard.ts` | 있음 | 부분 | #125(미매핑 단어 치환값이 프롬프트에 아직 연결되지 않음) |
| 4. 프리셋 저장 | `GET·POST /api/preset` | 연결됨 | 완료 | — |
| 5. 캐릭터 시트 표시 | — | 있음 | 완료 | — |
| 6. 프로젝트 목록 | `GET /api/preset` (id 없이) · 세션 목록 | 연결됨 | 완료 | #136 |
| 7. 소재 입력 | — | 있음 | 있음 | #206(소재 [브랜드] 표기 진행 중) |
| 8. 브레인스토밍 3턴 | `POST /api/brainstorm` · `lib/llm/brainstorm.ts` (업종 주입 · 질문 문구 단일화 PR #204) | 연결됨 | 완료 | #119(턴 건너뛰기 PR #154로 완료. 흐름 턴은 #157 종료 — 3종 유지) |
| 9. 표지컷 3안 | `kind: 'cover_variants'` | 연결됨 | 완료 | #102(닫힘) |
| 10. 4컷 생성 | `POST /api/generate` 체이닝 | 연결됨 | 완료 | #103(닫힘) · #104(`generateChainedCuts` 중간 실패 시 만든 컷 보존·이어서 만들기 — 2차 작업 10번) · #138(나머지 3컷 진행률 "n/3" — 2차 작업 5번) |
| 11. 대사 수정 · 드래그 | — | 있음 | 완료 | — |
| 12. v2 저장 · 되돌리기 | `/api/session`(선택 기록 `selections` 동봉 · #207) `/version` `/revert` · 재진입 복원 | 연결됨 | 완료 | #143 · #207(PR #210 · #213 머지) |
| 13. Export ZIP | `GET /api/session/export` | 연결됨 | 완료 | — |

1차 추가 완료분: 화면 간 이동(#134), 프로젝트 이름 변경 · 비활성화(#161, `PATCH`/`DELETE /api/preset`), 흐름 템플릿 JSON 분리(PR #153).

2차 착수 전 머지: PR #163 — 말풍선 꼬리 길이를 목표점까지 거리 비율로 조정(`lib/render/compose.ts`).

이 표는 손으로 갱신합니다. 단계를 완료하는 PR을 올릴 때 함께 고쳐주세요.

## 2차 작업 표

| # | 구분 | 항목 | 우선순위 | 기한 | 담당 | 관련 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 기능 | 소재에 맞는 컷 대사 · 연출 (**완료** — PR #204 머지) | 발표 필수 | 대사 10-06, 연출 10-08 | chictimin | #152 |
| 2 | 기능 | 조연 마스코트 고정 (서버 연결 PR #212 머지 — 남은 것: joniverse-ai 시트·컷 PR → JEON-DAEJIN 화면 연결(순서 #150 코멘트)) | 품질 | 10-08 | joniverse-ai | #150 · 화면 계약 #200 |
| 3 | 기능 | 사용자 그림체 키워드 반영 (병합 배선 · 레퍼런스 스킵 · 미매핑 치환) | 품질 | 10-08 | JEON-DAEJIN | #151, #125 |
| 4 | 기능 | 건너뛰면 기본값 채우기 ("알아서 해줘") | 품질 | 10-08 | JEON-DAEJIN | #181 |
| 5 | 기능 | 나머지 3컷 생성 진행률 표시 | 품질 | 10-08 | JEON-DAEJIN | #138 |
| 6 | 기능 | 브레인스토밍 흐름 턴 LLM 선택 (**완료** — 3종 유지로 종료) | 품질 | 10-04 | chictimin | #157, #201 |
| 7 | 버그 | 숫자 소재가 이미지에 글자로 박힘 (수정 머지됨, 9/30 재실행 통과 — 근거 PR #165 머지됨) | 발표 필수 | 10-06 | joniverse-ai | #146 |
| 8 | 버그 | 긴 대사에서 말풍선 꼬리 미노출 (**해결** — main에서 재현 안 됨, 9/30 QA. 꼬리 길이 조정은 PR #163 머지) | 발표 필수 | 10-06 | smartman3514-commits | PR #163 |
| 9 | 버그 | 크롭이 말풍선 여백을 깎을 수 있음 | 품질 | 10-08 | smartman3514-commits | #105 |
| 10 | 버그 | 생성 결과 유실 방지 잔여분 (`generateChainedCuts`) | 품질 | 10-08 | JEON-DAEJIN | #104 |
| 11 | 버그 | **완료**(PR #192 머지) — 아주 긴 대사 말풍선이 그림 오른쪽 밖으로 잘림 (`top_right`) | 품질 | 10-08 | smartman3514-commits | #169 |
| 12 | 버그 | **완료**(PR #192 머지) — 아주 긴 대사 center 말풍선이 인물을 덮어 꼬리가 사라짐 | 품질 | 10-08 | smartman3514-commits | #170 |
| 13 | 버그 | center 말풍선 꼬리를 화자 방향으로 (PR #235 머지 — #199는 열어 둠, Export 연결이 완료 조건) | 품질 | 미정 | smartman3514-commits | #199 |
| 14 | 기능 | CTA를 세션 단위로 — 마무리 강도 3단계 + 이번 편 목적 (**완료** — 1단 PR #223 · 2단 온보딩 기본 강도 PR #229 머지. "이번 편에 알릴 내용"은 #206에서 이어서 검토) | 품질 | 미정 | chictimin · JEON-DAEJIN | #205 |
| 15 | 기능 | 소재 [브랜드·제품명] 표기 (서버 연결 PR #231 머지 — 남은 것: 이미지 프롬프트 치환 PR #237 OPEN, 화면 배선(#220 머지 후 착수), 소재 안내 문구(이미지 치환 확인 후)) | 품질 | 미정 | chictimin | #206 |
| 16 | 기능 | 표지 선택 기록 (**완료** — 서버 PR #210 · 화면 PR #213 머지, QA #216 남음) | 품질 | 미정 | chictimin · JEON-DAEJIN | #207 |

3번 선행: chictimin의 그림체 키워드 선정 스크립트. 4번 선행 해소: 6번 완료(#157 종료), PRD 8절 기본값 확정(#181).

모든 기능·버그 PR은 머지 전에 smartman3514-commits가 골든패스로 동작을 확인하고 결과를 PR에 남긴다. 문서·데이터 계약(`spec/`) 변경 승인은 chictimin이 한다.

## P0 판정 현황

판정 기준 근거 #133(종료), 기록 #113.

- 최종 판정(조건부 통과, #113): 게이트 1 4/5(09-30 케이스 기록), 게이트 2 위반 0컷(#146, 근거 이미지 PR #165 머지됨). 한계 3가지는 #113 기록과 함께 인용 — 케이스 4는 3컷 기준 인정, 케이스 5는 #148 이전 조건 실패 잔류, 케이스 2는 `8460d73`에서 실행
- 남은 것: 10-14 이후 최종 회귀·리허설(OpenAI 기본 설정)에서 발표 경로 확인

## 문서 지도

| 문서 | 보는 때 |
| --- | --- |
| [`PRD.md`](./PRD.md) | 제품 요구사항 · 제약 확인 (정본, 구현보다 우선) |
| [`docs/pipeline.md`](./docs/pipeline.md) | 온보딩→세션→에디터 호출 순서 · 소유 경계 확인 |
| `spec/` | 스키마 · 값 목록 · 어휘 사전 확인 (변경은 chictimin 승인) |
| [`docs/gate-evidence/`](./docs/gate-evidence/) | P0 판정 근거 이미지 확인 |
