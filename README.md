# 컷툰 제작 AI 코파일럿

리브라이블리 기업 연계 프로젝트. 4컷 컷툰 생성 코파일럿.

## 스택

| 영역 | 선택 |
| --- | --- |
| 앱 | Next.js (App Router) |
| 언어 | TypeScript |
| 이미지 | Gemini (나노바나나) |
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
│      └─ generate/            이미지 생성 (maxDuration=300)  B①
├─ lib/
│  ├─ llm/                     브레인스토밍 3턴 · 캡션         A①
│  ├─ gemini/
│  │   ├─ generate.ts          컷 생성 (chats 세션 관리)      B①
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
| `app/api/preset/`, `app/api/session/` | A③ |
| `lib/llm/`, `spec/` | A① |
| `app/api/generate/`, `lib/gemini/generate.ts` | B① |
| `lib/gemini/extract.ts` | B② |
| `lib/render/` | B③ |

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
