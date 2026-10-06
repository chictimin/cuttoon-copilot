# 컷툰 제작 AI 코파일럿

기업 연계 프로젝트. 4컷 컷툰 생성 코파일럿.
레퍼런스 이미지와 소재를 넣으면 4컷 컷툰 ZIP이 나온다.

## 실행 환경

- macOS·Windows 권장 — 리눅스는 한글 시스템 폰트 설치 필요(Export 대사가 시스템 폰트에 의존, `docs/pipeline.md` 5-2절)
- Node — CI는 24에서 돈다(`.github/workflows/ci.yml`). `package.json`에 `engines` 지정 없음
- 이미지 생성 모델을 쓸 수 있는 OpenAI 키 필요(유료 호출 발생, 아래 비용 참고)

## 처음 실행

1. `npm install`
2. `cp .env.example .env` — 필수 3값(`OPENAI_API_KEY`·`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`) 채우기. 선택값(`IMAGE_PROVIDER` 등)은 비워두면 기본값
   - 팀원: 팀 채널의 `.env`를 받고 `OPENAI_API_KEY`만 개인 키로 교체
   - 새로 셋업: 본인 OpenAI 키 + 본인 Supabase 프로젝트(Project Settings → API의 Project URL·`service_role` 키)
   - `SUPABASE_SERVICE_ROLE_KEY`는 서버 `.env` 전용 — 공유·커밋 금지(`lib/db/schema.sql` 머리말)
3. Supabase 셋업 — 테이블만 만들고 버킷을 빠뜨리면 업로드와 이미지 읽기가 통째로 실패한다(`Bucket not found`, issue #67)
   1. **테이블** — `lib/db/schema.sql`을 Supabase SQL Editor에서 실행. 여러 번 실행해도 안전하다. 코드 pull 뒤 DB 오류가 나면 먼저 다시 실행한다
   2. **Storage 버킷** — `assets` 버킷을 **public으로** 생성 (`lib/asset-store.ts`의 `getAssetUrl()`이 `getPublicUrl()`을 쓰기 때문이다)
4. `npm run dev` → `http://localhost:3000` — 프로젝트 목록(첫 화면)이 뜨면 정상

선택 변수는 `IMAGE_PROVIDER` — 비우면 `openai`, 개발·QA 비용 절감용 `openai-low`(#190), 로컬 ComfyUI로 그리는 개발 테스트 전용 `comfyui`(#226, `COMFYUI_*` 변수 필요).

## 사용 흐름

골든패스: 온보딩(레퍼런스 업로드 → 스타일 추출 → 스타일 확인·재추출 → 상세 입력 확인 → 마스코트 선택 → 캐릭터 시트 → 프리셋 저장) → 세션(소재 입력 → 브레인스토밍 3턴 → 말투 선택 → 대사 생성·확인 → 표지 3안 → 나머지 3컷 → 저장) → 에디터(대사 수정 · 되돌리기 → Export ZIP).

프리셋 = 프로젝트 그림체·타깃 설정 묶음. 표지 3안 = 1컷 후보 3장 중 고르기.

## 비용·대기

한 바퀴에 이미지 호출 7회(캐릭터 시트 1 + 표지 3 + 나머지 3컷). 단계별 대기 약 40초(시트)·70초(표지 3안)·130초(3컷, E2E 1차 실측). 생성 중 새로고침하면 결과가 사라지니 기다린다. 시험 삼아 돌릴 때는 `IMAGE_PROVIDER=openai-low`(P0 판정·발표·최종 회귀는 `openai`로만).

## 스택

| 영역 | 선택 |
| --- | --- |
| 앱 | Next.js 16 (App Router) · React 19 · TypeScript |
| 컷 생성 | OpenAI Responses API — 텍스트 모델 `gpt-5` + image_generation 도구 (`lib/openai/generate.ts:19`) |
| 캐릭터 시트 | `gpt-image-1` (`lib/openai/extract.ts:213`) |
| 텍스트(브레인스토밍 · 스타일 추출) | `gpt-4o` (`lib/llm/brainstorm.ts:137`, `lib/openai/extract.ts:92`) |
| DB · 스토리지 | Supabase |
| 렌더 합성 | sharp (`lib/render/`) |

## 문서 지도

| 문서 | 보는 때 |
| --- | --- |
| [`PRD.md`](./PRD.md) | 제품 요구사항 · 제약 확인 (정본, 구현보다 우선) |
| [`docs/pipeline.md`](./docs/pipeline.md) | 온보딩→세션→에디터 호출 순서 · 소유 경계 확인 |
| [`docs/operations.md`](./docs/operations.md) | 팀 운영 · 일정 · 소유권 · 현황 확인 |
| `spec/` | 스키마 · 값 목록 · 어휘 사전 확인 (변경은 chictimin 승인) |
| [`docs/gate-evidence/`](./docs/gate-evidence/) | P0 판정 근거 이미지 확인 |
