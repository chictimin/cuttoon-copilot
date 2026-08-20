# 컷툰 제작 AI 코파일럿

기업 연계 프로젝트. 4컷 컷툰 생성 코파일럿.

## 문서

| 문서 | 담는 것 | 변경 권한 |
| --- | --- | --- |
| [`PRD.md`](./PRD.md) | 제품 요구사항 · 제약 · 제외 기능 · 아키텍처 결정 | chictimin 승인 (5-1절 의존성 목록은 예외 — 승인 불필요) |
| `README.md` (이 문서) | 스택 · 폴더 소유권 · 브랜치 · git 규칙 | chictimin 승인 |
| `spec/*.schema.json` | 데이터 계약(필드·enum) | A① 승인 |
| [`docs/pipeline.md`](./docs/pipeline.md) | 온보딩→세션→에디터 호출 순서 · A/B 소유 경계 · 파이프라인 사실 정리 | A① 승인 |
| [`docs/gate-evidence/`](./docs/gate-evidence/) | P0 게이트(캐릭터 동일성 · 말풍선 억제) 판정 근거 이미지 | A① 승인 |
| `spec/data/*.json`(`cta_presets.json`·`narrative-flow.json`·`style-vocabulary.json`) | 값 목록 데이터 파일(CTA 문구 · 서사 흐름 템플릿 · 스타일 키워드 매핑) | A① 승인 |
| `spec/vocabulary.json` | enum별 프롬프트 힌트(영문 서술) | A① 승인 |

**구현 전에 `PRD.md`를 확인한다.** 개인 로컬 문서(각자의 PRD 초안·노트)는 정본이 아니다.

## 스택

| 영역 | 선택 |
| --- | --- |
| 앱 | Next.js (App Router) |
| 언어 | TypeScript |
| 이미지 | OpenAI (gpt-image / Responses API) |
| 텍스트 | OpenAI |
| DB·스토리지 | Supabase |

## 폴더 구조

```
cuttoon-copilot/
├─ app/
│  ├─ (studio)/                화면 전체                      A②
│  │   ├─ page.tsx             프로젝트 목록
│  │   ├─ onboarding/          온보딩 + 프리셋 생성 ← A/B 접점
│  │   ├─ session/[id]/        소재 입력 → 3안 → 4컷 완성
│  │   └─ editor/[id]/         대사 수정 · 드래그 · 되돌리기
│  └─ api/
│      ├─ preset/              프리셋 CRUD                    A③
│      ├─ session/             세션 관리 · Export             A③
│      ├─ brainstorm/          브레인스토밍 3턴                A①
│      └─ generate/            이미지 생성 (maxDuration=300)  B①
├─ lib/
│  ├─ llm/                     브레인스토밍 3턴 · 캡션         A①
│  ├─ openai/
│  │   ├─ generate.ts          컷 생성 (멀티턴 세션 관리)      B①
│  │   ├─ extract.ts           레퍼런스 VLM 추출              B②
│  │   └─ provider.ts          ImageProvider 인터페이스        B①
│  ├─ render/                  텍스트 레이어 합성 · ZIP        B③
│  └─ db/                      Supabase 클라이언트 · 쿼리      A③
├─ spec/                       계약 (변경은 A① 승인)          A①
│  ├─ preset.schema.json
│  ├─ storyboard.schema.json
│  ├─ vocabulary.json          계약 ⑤ 어휘 사전
│  └─ samples/                 샘플 응답 JSON + 이미지
└─ public/
   └─ demo-cache/              발표용 캐시 폴백
```

## 폴더 소유권

| 폴더 | 담당 |
| --- | --- |
| `app/(studio)/` | A② |
| `app/api/preset/`, `app/api/session/` | A③ (chictimin) |
| `lib/llm/`, `app/api/brainstorm/`, `spec/` | A① (dabi) |
| `app/api/generate/`, `lib/openai/generate.ts` | B① |
| `lib/openai/extract.ts` | B② |
| `lib/render/` | B③ |

## 구현 현황

골든 패스 각 단계가 지금 어디까지 됐는지. **2026-08-20 기준, main에 머지된 것만** 센다 — 열려 있는 PR은 포함하지 않는다.

| 단계 | 로직·API | 화면 | 상태 | 관련 이슈 |
| --- | --- | --- | --- | --- |
| 1. 레퍼런스 업로드 | `POST /api/upload` · `lib/asset-store.ts` | 연결됨 | 완료 | — |
| 2. 스타일 추출 | `lib/openai/extract.ts` (실제 호출) | 연결됨 | 완료 | — |
| 3. 프리셋 자동 확정 | `lib/llm/preset-guard.ts` | 있음 | 완료 | — |
| 4. 프리셋 저장 | `GET·POST /api/preset` | 연결됨 | 완료 | — |
| 5. 캐릭터 시트 표시 | — | 있음 | 완료 | — |
| 6. 프로젝트 목록 | `GET /api/preset` (id 없이) | 연결됨 | 완료 | — |
| 7. 소재 입력 | — | 있음 | 있음 | — |
| 8. 브레인스토밍 3턴 | `POST /api/brainstorm` · `lib/llm/brainstorm.ts` (PR #112) | 연결됨 | 완료 | #119(소재 → draft 추출, PR #154로 1번 항목 완료·2번 항목은 흐름 템플릿 데이터 분리만) |
| 9. 표지컷 3안 | `kind: 'cover_variants'` (PR #81) | 연결됨 | 완료 | #102 · #104 (후속) |
| 10. 4컷 생성 | `POST /api/generate` 체이닝 | 연결됨 | 완료 | #102 · #103 · #104 (후속) |
| 11. 대사 수정 · 드래그 | — | 있음 | 완료 | — |
| 12. v2 저장 · 되돌리기 | `/api/session` `/version` `/revert` | 연결됨 | 완료 | — |
| 13. Export ZIP | `GET /api/session/export` | 연결됨 | 완료 | — |

알아둘 것 다섯 가지다.

**저장·조회 계열은 화면까지 이어졌습니다.** 프로젝트 목록(`GET /api/preset`), 프리셋 저장(`POST /api/preset`), 세션 저장(`POST /api/session`), 에디터의 조회·버전 저장·되돌리기가 모두 실제 API를 부릅니다.

**이미지 생성이 화면까지 이어졌습니다(PR #100).** 세션 화면(`SessionFlow.tsx`)이 로컬 mock 대신 `generate-client.ts`를 통해 `POST /api/generate`를 부릅니다 — 표지 3안은 `kind: 'cover_variants'` 1회 호출(서버가 3회를 대신 처리), 나머지 3컷은 `continuationToken` 체이닝으로 순차 생성입니다. `mock-generate.ts`는 삭제됐습니다. Export ZIP(13번)도 같은 PR에서 에디터에 다운로드 버튼이 붙었습니다.

**레퍼런스 업로드·스타일 추출(1·2번)도 화면까지 이어졌습니다(PR #91, #95).** 온보딩 화면(`OnboardingFlow.tsx`)이 `style-analysis.ts`를 통해 `POST /api/upload`(Supabase Storage 저장) → `POST /api/extract`(실제 GPT-4o 호출)를 부르고, 캐릭터 시트도 `generateCharacterSheet` 실제 호출로 생성합니다(#87 closed).

**브레인스토밍(8번)은 실제 LLM 호출로 연결됐습니다(PR #112).** 세션 화면이 `POST /api/brainstorm`을 불러 소재에 맞는 선택지를 받습니다. PRD 6절의 턴 건너뛰기도 실현됐습니다 — 소재 텍스트에서 주인공·조연을 자체 추출(`extractDraftFromSubject`, PR #154)해 이미 파악된 턴을 건너뜁니다. 다만 흐름(flow) 턴은 이번 추출 범위 밖이라 항상 물어보고, 흐름 템플릿 자체는 여전히 화면이 로컬 값으로 강제합니다(`spec/data/narrative-flow.json`으로 데이터만 분리됨, PR #153) — LLM 자유 선택 전환은 `#119`에 보류 상태로 남아 있습니다.

**P0 게이트 판정이 부분적으로 진행됐습니다 — "완료"가 아닙니다.** `PRD.md` 7절이 "P0의 두 게이트가 가장 중요한 판단점"이라고 못 박은 것(캐릭터 4컷 동일성 / 말풍선 억제)에 대해, 케이스 1·5·3을 실행하고 기록을 남겼습니다(`#113`, 근거 이미지 `docs/gate-evidence/`).

- 그림체 동일성: 3/3 통과
- 주인공 동일성: 케이스 5가 처음엔 실패(상의 색이 4컷 내내 흔들림)했는데, 원인(팔레트가 색의 집합만 정하고 배정을 안 정함)이 특정돼 PR #148로 고쳐졌고 축소 재검증은 통과했습니다. **다만 `4/5` 본 판정 기준은 케이스 2·4가 아직 실행되지 않아 미완입니다**
- 게이트 2(말풍선·텍스트 억제): 케이스 1·5는 4/4 클린, 케이스 3(텍스트 유혹 소재)은 2/4 위반 — 원인이 특정돼 `#146`으로 분리됐습니다
- 남은 것: 케이스 2·4 실행과 `4/5` 최종 판정입니다. 실행 시점은 B②가 판단합니다

이 표는 손으로 갱신합니다. 단계를 완료하는 PR을 올릴 때 함께 고쳐주세요.

## 브랜치

1인 1브랜치: `feat/a1` `feat/a2` `feat/a3` `feat/b1` `feat/b2` `feat/b3`

## git 규칙

1. main 직접 push 금지, PR로만
2. 빌드 확인 후 머지, 조금씩 자주
3. 되감기(rebase·force-push)는 본인 브랜치만, main은 그대로
4. DB 구조 변경은 A③만
5. `.env`는 팀 공유를 위해 커밋 가능(private 저장소 한정) — public으로 전환하기 전 반드시 키 재발급
6. 발표 전날 태그 하나 찍고 멈추기, 이후 수정 시 태그 새로

## 로컬 실행

```
npm install
npm run dev
```

`.env`는 저장소에 들어 있으므로(위 git 규칙 5번) 따로 만들 필요는 없다.

### Supabase 셋업

새 Supabase 프로젝트로 갈아타거나 처음 셋업할 때는 아래 둘 다 필요하다. 테이블만 만들고 버킷을 빠뜨리면 업로드와 이미지 읽기가 통째로 실패한다(`Bucket not found`, issue #67).

1. **테이블** — `lib/db/schema.sql`을 Supabase SQL Editor에서 실행
2. **Storage 버킷** — `assets` 버킷을 **public으로** 생성

버킷을 public으로 두는 이유는 `lib/asset-store.ts`의 `getAssetUrl()`이 `getPublicUrl()`을 쓰기 때문이다. private으로 만들면 이미지 URL이 전부 깨진다.

대시보드에서 만들거나(Storage → New bucket → 이름 `assets`, Public 체크), 서비스롤 키로 한 줄이면 된다.

```
npx tsx -e "
import {createClient} from '@supabase/supabase-js';
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
s.storage.createBucket('assets', { public: true }).then(r => console.log(r.data ?? r.error));
"
```

파일 크기·mime 제한은 아직 걸지 않았다 — 값 확정은 issue #68에서 논의 중이다.
