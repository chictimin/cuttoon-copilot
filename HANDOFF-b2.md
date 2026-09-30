# 인수인계 — B②(분석·생성) 세션

Claude Code에서 작업하던 내용을 OpenCode에서 이어가기 위한 정리. 2026-08-21 기준.

## 2026-09-30 업데이트 (아래 본문보다 우선)

- **키 전면 교체**: `.env`가 8/18~9/3 공개 레포에 커밋돼 있어 `OPENAI_API_KEY`·`SUPABASE_SERVICE_ROLE_KEY`가 커밋 기록에 노출됨 → 둘 다 폐기하고 새 키로 교체. 예전 키는 동작하지 않음.
- **Supabase 프로젝트**: 비활성으로 일시정지돼 있던 것을 복구함. 데이터(프로젝트 19·세션 20·스토리지 이미지) 유지 확인. `archived_at`(#161) 컬럼도 이미 적용돼 있음.
- `feat/b2`를 main(`5c1afb4`)까지 fast-forward.
- 아래 "커밋 안 된 변경" 1번(말풍선 클릭)과 3번(`scripts/`)은 커밋 완료. `scripts/output/`은 `.gitignore`에 추가. 2번(`COVER_VARIANT_RETRY`) 주석은 새 `.env`에 그대로 옮겨둠 — #113 재개 시 여전히 `off`로 복원 필요.

## 지금 브랜치 상태

- 브랜치: `feat/b2` (origin: `chictimin/cuttoon-copilot`)
- 최근 병합: PR #147 (게이트2 위반 수정, `84ed2b6`) — main에 반영됨

## 커밋 안 된 변경 — 잃어버리지 말 것

### 1. `app/(studio)/editor/[id]/EditorFlow.tsx` — 실제 버그 수정, 아직 커밋 안 함

리허설 중 발견: 데모 콘솔의 iframe 안에서는 말풍선을 **드래그**해야만 대사 편집 모드가 열렸고, **클릭**은 안 먹었다.
아래 화살촉로 클릭 핸들러를 추가해 고쳤다. 재현·수정 확인 완료, 커밋만 안 됨.

```diff
 <div
   draggable
   onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
-  className="absolute max-w-[70%] cursor-move truncate rounded-full bg-white px-3 py-1 text-xs font-medium shadow"
+  onClick={() => {
+    setEditingIndex(i);
+    setDraftCaption(cut.caption.text);
+  }}
+  className="absolute max-w-[70%] cursor-pointer truncate rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-900 shadow"
   style={POSITION_STYLE[cut.caption.position]}
-  title="끌어서 말풍선 위치를 옮길 수 있어요"
+  title="클릭하면 대사를 고칠 수 있어요 · 끌면 위치를 옮길 수 있어요"
 >
```

**커밋 메시지 제안**: `fix(editor): 말풍선 클릭으로도 대사 편집 열리게 — 드래그 전용이라 리허설 중 막힘`

### 2. `.env` — 판정용 설정, 발표 데모 때문에 잠시 꺼둠

```diff
+# #113 P0 게이트 판정 측정 중 임시 설정 — 측정 끝나면 제거할 것 (결정 14)
+# 데모 자산 생성 중 재시도 ON (판정 재개 시 off 복원) — 결정 14
+# COVER_VARIANT_RETRY=off
```

**P0 판정(#113)을 다시 시작하기 전에 `COVER_VARIANT_RETRY=off`의 주석을 풀어야 함.** 지금은 데모 자산을 만들려고 재시도를 켜둔 상태.
⚠️ `.env`에는 `OPENAI_API_KEY`·`SUPABASE_SERVICE_ROLE_KEY` 실키가 들어있음 — 절대 출력·커밋하지 말 것.

### 3. `scripts/` — 아직 git에 add 안 된 새 파일

- `scripts/p0-spike.ts`
- `scripts/output/01-character-sheet.png`, `02-cover-cut.png`, `03-cut2.png`

P0 판정용으로 만든 스파이크 스크립트와 그 산출물로 보임. 필요하면 `.gitignore`에 `scripts/output/`을 넣거나, 커밋할지 결정 필요.

## 열려 있는 이슈 (gh로 확인한 최신 상태)

| 이슈 | 상태 | 내용 |
|---|---|---|
| **#113** | OPEN | P0 게이트1(캐릭터 동일성)·게이트2(말풍선 억제) 판정 — 아직 스크린샷과 함께 기록 안 됨 |
| **#146** | OPEN | 케이스3 게이트2 위반(87%가 그래프로 렌더링) — PR #147로 수정했지만 **재실행해서 통과하는지 재검증 안 됨** |
| **#150** | OPEN | 조연을 프로젝트 마스코트로 고정 — `buildSessionCast` 연결 (#123 잔여분). `preset.schema.json`의 `character_sheet`가 "고정 마스코트 한 명"을 요구하는데 `buildCharacterPrompt`가 `preset.context`를 쓰는 건 계약 위반이라고 지적해둔 상태. **세션 단위 주인공 일관성은 이 이슈로 못 고침** — `cast[].description` + 체인 레이어(PR #148) 쪽 문제라 별도. |
| #156 | OPEN (문서상 완료) | `docs/pipeline.md` B①·B②·B③ 채우기 — PR #158/#160으로 병합됐는데 **이슈 자체가 안 닫혀 있음**. 닫아도 됨. |
| #159 | CLOSED | OpenAI 크레딧 소진(429) — 해결됨 |
| #94 | CLOSED | B② 진행상황 공유 |

## #113 재개 시 순서

1. `.env`의 `COVER_VARIANT_RETRY` 주석 해제해서 `off`로 복원
2. Case 3을 다시 돌려서 PR #147이 실제로 게이트2를 통과시키는지 확인 → #146/#113에 결과 기록
3. Case 2(조연 있음), Case 4를 마저 판정
4. 게이트1(캐릭터 동일성) 판정 결과를 #113에 스크린샷과 함께 기록
5. "이슈134 테스트" 세션에 화살표·체크마크가 보였던 것 — 숫자 없이도 설명장치 문제가 난다는 근거로 #146에 남길지 결정

## 오늘 있었던 일 (참고용)

발표(2026-08-21 14:30, 리브라이블리 영상미팅)를 준비하며 리브라이블리 Instagram(@kriee_official) 레퍼런스로 데모 세션을 새로 만들었다. 저장 직전에 페이지를 벗어나 4컷이 날아갔다가 스토리지에 남은 에셋으로 세션 행을 복구함(`9f46028c-0e76-4ce6-8330-8a7000cf4eaf`). 발표 자료(A팀 PDF 판형에 맞춘 B팀 덱·데모 슬라이드·데모 콘솔·대본)는 로컬 `~/Desktop/발표자료_20260821/`와 Claude 아티팩트에 있음 — 코드 작업과는 무관.

## 시크릿 취급 주의

`.env`를 어떤 도구로 읽든 `sk-`/`sb_secret_` 값은 화면에 그대로 찍지 말 것. 이번 세션에서는 항상 `sed 's/=sk-[A-Za-z0-9_-]*/=<REDACTED>/'`로 마스킹해서 읽었음.
