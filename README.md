# 컷툰 제작 AI 코파일럿

기업 연계 프로젝트. 4컷 컷툰 생성 코파일럿.

## 문서

| 문서 | 담는 것 | 변경 권한 |
| --- | --- | --- |
| [`PRD.md`](./PRD.md) | 제품 요구사항 · 제약 · 제외 기능 · 아키텍처 결정 | chictimin 승인 |
| `README.md` (이 문서) | 스택 · 폴더 소유권 · 브랜치 · git 규칙 | chictimin 승인 |
| `spec/*.schema.json` | 데이터 계약(필드·enum) | A① 승인 |

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

골든 패스 각 단계가 지금 어디까지 됐는지. **2026-08-19 기준, main에 머지된 것만** 센다 — 열려 있는 PR은 포함하지 않는다.

| 단계 | 로직·API | 화면 | 상태 |
| --- | --- | --- | --- |
| 1. 레퍼런스 업로드 | 없음 | 있음 | 막힘 |
| 2. 스타일 추출 | `lib/openai/extract.ts` (실제 호출) | mock 사용 | 반쪽 |
| 3. 프리셋 자동 확정 | `lib/llm/preset-guard.ts` | 있음 | 완료 |
| 4. 프리셋 저장 | `GET·POST /api/preset` | 연결됨 | 완료 |
| 5. 캐릭터 시트 표시 | — | 있음 | 완료 |
| 6. 프로젝트 목록 | `GET /api/preset` (id 없이) | placeholder | 미연결 |
| 7. 소재 입력 | — | 있음 | 있음 |
| 8. 브레인스토밍 3턴 | 없음 | mock | 미구현 |
| 9. 표지컷 3안 | 없음 | mock | 미구현 |
| 10. 4컷 생성 | `POST /api/generate` + 계약 스텁 | mock | 미구현 |
| 11. 대사 수정 · 드래그 | — | 있음(mock) | 반쪽 |
| 12. v2 저장 · 되돌리기 | `/api/session` `/version` `/revert` | 미연결 | 미연결 |
| 13. Export ZIP | `lib/render/`가 빈 폴더 | 없음 | 미착수 |

알아둘 것 세 가지다.

**화면에서 실제 API를 부르는 곳은 온보딩 하나뿐이다.** `OnboardingFlow.tsx`의 `fetch("/api/preset")`가 전부고, 세션·에디터·목록은 mock이나 placeholder다. API가 있어도 화면이 안 붙으면 새로고침에서 사라진다.

**이미지 생성에 실제 모델 호출이 아직 없다.** 라우트와 인터페이스는 들어왔지만(PR #26) `generateCharacterSheet`·`generateCut`이 `asset://stub/...`을 돌려주는 스텁이다. 8·9·10번이 전부 여기 걸려 있어서, 실제 호출이 붙기 전까지 P2도 P3도 시작할 수 없다.

**P0 게이트를 아직 검증하지 못했다.** `PRD.md` 7절이 "P0의 두 게이트가 가장 중요한 판단점"이라고 못 박았는데(캐릭터 4컷 동일성 / 말풍선 억제), 검증할 코드 자체가 없는 상태다.

이 표는 손으로 갱신한다. 단계를 완료하는 PR을 올릴 때 같이 고친다.

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
